'use client';

import { useEffect, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { shiftsApi, apiErrorMessage } from '@/lib/api-client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent } from '@/components/ui/card';
import { useToast } from '@/hooks/use-toast';
import { useTranslation } from '@/providers/i18n-provider';
import { formatDateTime } from '@/lib/format';
import { AlertTriangle, Clock, Coffee, Minus, Play, Square } from 'lucide-react';
import type { Shift, ShiftKind } from '@/lib/api-types';

/** `1h 45m`, which is how anybody talks about a shift. */
export function hoursAndMinutes(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}

/** An ISO instant as the value a `datetime-local` input expects. */
export function toLocalInput(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/**
 * Where a forgotten shift most likely ended: eight hours in, or now if that is
 * sooner. Only a starting guess for the field — the person corrects it — but a
 * guess that the server will accept, which "now" stops being after a day.
 */
export function likelyEnd(startedAt: string): string {
  const eightHours = new Date(startedAt).getTime() + 8 * 3_600_000;
  return new Date(Math.min(Date.now(), eightHours)).toISOString();
}

/** Every query a clock action makes stale. */
export function shiftQueryKeys(factionId: string) {
  return [
    ['shifts', factionId],
    ['shifts-on-duty', factionId],
    ['shifts-summary', factionId],
    ['shift-positions', factionId],
  ] as const;
}

/**
 * The clock: clock in, take a break, clock out.
 *
 * Shared by the shifts screen and the member's home screen, because the whole
 * point of the home screen is that the one thing you came to do is on it.
 *
 * Breaks are added as they happen rather than typed at the end. The first
 * version had a box next to the clock-out button, which meant reconstructing
 * a forty-minute gap from memory at the end of the night — and a reload
 * emptied it. Each tap here is saved on the shift straight away.
 */
export function ShiftClock({ factionId }: { factionId: string }) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [position, setPosition] = useState('');
  const [location, setLocation] = useState('');
  // Faction work by default, because that is what most people clocking in are
  // doing — the side job is the deliberate choice, not the other way round.
  const [kind, setKind] = useState<ShiftKind>('faction');
  const [forgottenEnd, setForgottenEnd] = useState('');

  const onDuty = useQuery({
    queryKey: ['shifts-on-duty', factionId],
    refetchInterval: 60_000,
    queryFn: () => shiftsApi.onDuty(factionId),
  });

  const positions = useQuery({
    queryKey: ['shift-positions', factionId],
    queryFn: () => shiftsApi.positions(factionId),
    staleTime: 5 * 60 * 1000,
  });

  const mine = onDuty.data?.mine ?? null;

  // A forgotten shift gets a sensible end time in the field as soon as it is
  // recognised as one, rather than an empty input the person has to fill.
  useEffect(() => {
    if (mine?.stale) setForgottenEnd(toLocalInput(likelyEnd(mine.startedAt)));
  }, [mine?.id, mine?.stale, mine?.startedAt]);

  const invalidate = () => {
    for (const key of shiftQueryKeys(factionId)) {
      void queryClient.invalidateQueries({ queryKey: key });
    }
  };

  const fail = (err: unknown) =>
    toast({ title: t('shifts.failed'), description: apiErrorMessage(err), variant: 'destructive' });

  const clockIn = useMutation({
    mutationFn: () => shiftsApi.clockIn(factionId, {
      kind,
      position: position.trim() || null,
      location: location.trim() || null,
    }),
    onSuccess: () => {
      invalidate();
      toast({ title: t('shifts.clockedIn') });
    },
    onError: fail,
  });

  const clockOut = useMutation({
    // The break is already on the shift, so nothing is sent for it. A
    // forgotten shift sends the end time the person gave instead of now.
    mutationFn: () => shiftsApi.clockOut(factionId, mine?.stale && forgottenEnd
      ? { endedAt: new Date(forgottenEnd).toISOString() }
      : {}),
    onSuccess: (shift) => {
      invalidate();
      toast({
        title: t('shifts.clockedOut'),
        description: shift.workedMinutes !== null
          ? t('shifts.workedToast').replace('{time}', hoursAndMinutes(shift.workedMinutes))
          : undefined,
      });
    },
    onError: fail,
  });

  const setBreak = useMutation({
    mutationFn: (minutes: number) =>
      shiftsApi.update(factionId, mine!.id, { breakMinutes: minutes }),
    onSuccess: () => invalidate(),
    onError: fail,
  });

  return (
    <Card>
      <CardContent className="py-4">
        {mine ? (
          <div className="space-y-4">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="relative flex h-2 w-2">
                    {!mine.stale && (
                      <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
                    )}
                    <span className={`relative inline-flex h-2 w-2 rounded-full ${mine.stale ? 'bg-amber-500' : 'bg-emerald-500'}`} />
                  </span>
                  <span className="text-sm font-medium text-zinc-100">
                    {t('shifts.onDutySince').replace('{time}', formatDateTime(mine.startedAt))}
                  </span>
                </div>
                <p className="mt-1 text-xs text-zinc-500">
                  {[mine.position, mine.location].filter(Boolean).join(' · ') || t('shifts.noPosition')}
                </p>
                <Elapsed shift={mine} />
              </div>

              {/* Breaks as they happen, saved on the shift with each tap. */}
              <div className="space-y-1">
                <p className="flex items-center gap-1.5 text-xs text-zinc-500">
                  <Coffee className="h-3.5 w-3.5" />
                  {mine.breakMinutes > 0
                    ? t('shifts.breakSoFar').replace('{time}', hoursAndMinutes(mine.breakMinutes))
                    : t('shifts.noBreakYet')}
                </p>
                <div className="flex gap-1">
                  <Button
                    variant="outline"
                    size="sm"
                    aria-label={t('shifts.breakLess')}
                    disabled={setBreak.isPending || mine.breakMinutes === 0}
                    onClick={() => setBreak.mutate(Math.max(0, mine.breakMinutes - 15))}
                  >
                    <Minus className="h-3.5 w-3.5" />
                  </Button>
                  {[15, 30].map((minutes) => (
                    <Button
                      key={minutes}
                      variant="outline"
                      size="sm"
                      disabled={setBreak.isPending}
                      onClick={() => setBreak.mutate(mine.breakMinutes + minutes)}
                    >
                      +{minutes}m
                    </Button>
                  ))}
                </div>
              </div>
            </div>

            {/* A shift left open overnight. Clocking out "now" would claim the
                whole gap as worked, and past a day the server refuses it —
                so the question is asked instead of guessed. */}
            {mine.stale && (
              <div className="flex flex-wrap items-end gap-3 rounded-lg border border-amber-500/30 bg-amber-500/5 p-3">
                <div className="min-w-0 flex-1">
                  <p className="flex items-center gap-1.5 text-sm text-amber-300">
                    <AlertTriangle className="h-4 w-4" />
                    {t('shifts.forgotTitle')}
                  </p>
                  <p className="mt-0.5 text-xs text-zinc-400">{t('shifts.forgotHint')}</p>
                </div>
                <div className="space-y-1">
                  <Label htmlFor="forgotten-end" className="text-xs">{t('shifts.endedAt')}</Label>
                  <Input
                    id="forgotten-end"
                    type="datetime-local"
                    value={forgottenEnd}
                    onChange={(e) => setForgottenEnd(e.target.value)}
                  />
                </div>
              </div>
            )}

            <div className="flex justify-end">
              <Button
                onClick={() => clockOut.mutate()}
                disabled={clockOut.isPending || (mine.stale && !forgottenEnd)}
                className="bg-red-600 text-white hover:bg-red-500"
              >
                <Square className="mr-2 h-4 w-4" />
                {t('shifts.clockOut')}
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex flex-wrap items-end gap-3">
            <div className="space-y-1">
              <Label className="text-xs">{t('shifts.forWhom')}</Label>
              <div className="flex rounded-lg border border-[var(--line-2)] p-0.5" role="tablist" aria-label={t('shifts.forWhom')}>
                {(['faction', 'side'] as const).map((value) => (
                  <button
                    key={value}
                    role="tab"
                    type="button"
                    aria-selected={kind === value}
                    onClick={() => setKind(value)}
                    className={`h-8 rounded-md px-3 text-xs font-medium transition-colors ${
                      kind === value ? 'bg-[var(--fill-4)] text-zinc-100' : 'text-zinc-500 hover:text-zinc-300'
                    }`}
                  >
                    {t(value === 'faction' ? 'shifts.kindFaction' : 'shifts.kindSide')}
                  </button>
                ))}
              </div>
            </div>
            <div className="min-w-[10rem] flex-1 space-y-1">
              <Label htmlFor="shift-position" className="text-xs">{t('shifts.position')}</Label>
              <Input
                id="shift-position"
                list="shift-positions"
                value={position}
                onChange={(e) => setPosition(e.target.value)}
                placeholder={t('shifts.positionPlaceholder')}
              />
              {/* Whatever this faction has typed before, so a list of job
                  titles appears without anybody configuring one. */}
              <datalist id="shift-positions">
                {(positions.data?.positions ?? []).map((p) => <option key={p} value={p} />)}
              </datalist>
            </div>
            <div className="min-w-[10rem] flex-1 space-y-1">
              <Label htmlFor="shift-location" className="text-xs">{t('shifts.location')}</Label>
              <Input
                id="shift-location"
                value={location}
                onChange={(e) => setLocation(e.target.value)}
                placeholder={t('shifts.locationPlaceholder')}
              />
            </div>
            <Button onClick={() => clockIn.mutate()} disabled={clockIn.isPending}>
              <Play className="mr-2 h-4 w-4" />
              {t('shifts.clockIn')}
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/**
 * How long the open shift has been worked, counted on screen, break taken off.
 *
 * The server never sends a length for an unfinished shift — a number that
 * changes while you look at it does not belong in a stored total — but the
 * person watching the clock wants exactly that number, so it is counted here.
 */
function Elapsed({ shift }: { shift: Shift }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, []);
  const gross = Math.floor((now - new Date(shift.startedAt).getTime()) / 60_000);
  const minutes = Math.max(0, gross - shift.breakMinutes);
  return (
    <p className="mt-2 flex items-center gap-1.5 text-2xl font-semibold tabular-nums text-zinc-100">
      <Clock className="h-5 w-5 text-zinc-500" />
      {hoursAndMinutes(minutes)}
    </p>
  );
}
