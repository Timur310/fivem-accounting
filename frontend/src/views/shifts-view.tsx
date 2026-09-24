'use client';

import { useEffect, useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { shiftsApi, membersApi, apiErrorMessage } from '@/lib/api-client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState, ErrorState } from '@/components/ui/empty-state';
import { Textarea } from '@/components/ui/textarea';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import {
  SearchableSelect, type SearchableSelectOption,
} from '@/components/ui/searchable-select';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { useToast } from '@/hooks/use-toast';
import { useTranslation } from '@/providers/i18n-provider';
import { formatDateTime, displayName } from '@/lib/format';
import {
  CalendarDays, ChevronLeft, ChevronRight, Clock, Pencil, Play, Plus, Square, Trash2, Users,
} from 'lucide-react';
import { useAppStore } from '@/lib/store';
import type { Shift, ShiftKind } from '@/lib/api-types';

interface Props {
  factionId: string;
  /** May clock themselves in and out, and record their own missed shifts. */
  canLog: boolean;
  /** May read the whole rota rather than only their own hours. */
  canViewAll: boolean;
  /** May correct and remove anybody's shift. */
  canManage: boolean;
}

/** `1h 45m`, which is how anybody talks about a shift. */
function hoursAndMinutes(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}

/** The local day a moment falls on, as `YYYY-MM-DD`. */
function dayKey(value: string | Date): string {
  const d = value instanceof Date ? value : new Date(value);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Just the clock part of an instant: `19:30`. */
function timeOnly(value: string): string {
  const d = new Date(value);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** An ISO instant as the value a `datetime-local` input expects. */
function toLocalInput(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/**
 * The shifts screen: a clock, a month, and the hours they add up to.
 *
 * Built around one button. Somebody starting work should be able to open this
 * and be clocked in without reading anything, and everything else on the
 * screen — the calendar, the rota, the totals — is there for the conversation
 * afterwards about who actually turned up.
 */
export function ShiftsView({ factionId, canLog, canViewAll, canManage }: Props) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const user = useAppStore((s) => s.user);

  const [month, setMonth] = useState(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1);
  });
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  const [memberFilter, setMemberFilter] = useState('');
  const [editing, setEditing] = useState<Shift | null>(null);
  const [adding, setAdding] = useState(false);
  const [removing, setRemoving] = useState<Shift | null>(null);

  // What the clock-in form is holding before anybody has clocked in.
  const [position, setPosition] = useState('');
  const [location, setLocation] = useState('');
  const [breakMinutes, setBreakMinutes] = useState('0');
  // Faction work by default, because that is what most people clocking in are
  // doing — the side job is the deliberate choice, not the other way round.
  const [kind, setKind] = useState<ShiftKind>('faction');

  const monthStart = dayKey(new Date(month.getFullYear(), month.getMonth(), 1));
  const monthEnd = dayKey(new Date(month.getFullYear(), month.getMonth() + 1, 0));

  const list = useQuery({
    queryKey: ['shifts', factionId, monthStart, memberFilter],
    queryFn: () => shiftsApi.list(factionId, {
      from: monthStart,
      to: monthEnd,
      userId: memberFilter || undefined,
    }),
  });

  const onDuty = useQuery({
    queryKey: ['shifts-on-duty', factionId],
    // Somebody else clocking in is worth noticing without a reload, and this
    // is the one query on the screen where the answer changes on its own.
    refetchInterval: 60_000,
    queryFn: () => shiftsApi.onDuty(factionId),
  });

  const summary = useQuery({
    queryKey: ['shifts-summary', factionId, monthStart, memberFilter],
    queryFn: () => shiftsApi.summary(factionId, {
      from: monthStart,
      to: monthEnd,
      userId: memberFilter || undefined,
    }),
  });

  const positions = useQuery({
    queryKey: ['shift-positions', factionId],
    queryFn: () => shiftsApi.positions(factionId),
    staleTime: 5 * 60 * 1000,
  });

  const members = useQuery({
    queryKey: ['members', factionId],
    queryFn: () => membersApi.list(factionId),
    enabled: canViewAll,
  });

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ['shifts', factionId] });
    void queryClient.invalidateQueries({ queryKey: ['shifts-on-duty', factionId] });
    void queryClient.invalidateQueries({ queryKey: ['shifts-summary', factionId] });
    void queryClient.invalidateQueries({ queryKey: ['shift-positions', factionId] });
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
    mutationFn: () => shiftsApi.clockOut(factionId, {
      breakMinutes: Math.max(0, Number(breakMinutes) || 0),
    }),
    onSuccess: (shift) => {
      invalidate();
      setBreakMinutes('0');
      toast({
        title: t('shifts.clockedOut'),
        description: shift.workedMinutes !== null
          ? t('shifts.workedToast').replace('{time}', hoursAndMinutes(shift.workedMinutes))
          : undefined,
      });
    },
    onError: fail,
  });

  const remove = useMutation({
    mutationFn: (id: string) => shiftsApi.remove(factionId, id),
    onSuccess: () => {
      invalidate();
      setRemoving(null);
      toast({ title: t('shifts.removed') });
    },
    onError: fail,
  });

  const mine = onDuty.data?.mine ?? null;
  const shifts = list.data?.shifts ?? [];

  // One pass over the month, so the calendar and the day list read the same
  // rows rather than filtering the array once per cell.
  const byDay = useMemo(() => {
    const map = new Map<string, Shift[]>();
    for (const shift of shifts) {
      const key = dayKey(shift.startedAt);
      const bucket = map.get(key) ?? [];
      bucket.push(shift);
      map.set(key, bucket);
    }
    return map;
  }, [shifts]);

  const memberOptions = useMemo<SearchableSelectOption[]>(() => [
    { value: '', label: t('shifts.everyone') },
    ...(members.data ?? []).map((m) => ({
      value: m.userId,
      label: displayName({ username: m.username, inGameName: m.inGameName }),
    })),
  ], [members.data, t]);

  const dayShifts = selectedDay ? (byDay.get(selectedDay) ?? []) : shifts;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-zinc-100">{t('shifts.title')}</h1>
          <p className="mt-1 max-w-2xl text-sm text-zinc-400">{t('shifts.subtitle')}</p>
        </div>
        {canLog && (
          <Button variant="outline" onClick={() => setAdding(true)}>
            <Plus className="mr-2 h-4 w-4" />
            {t('shifts.addManual')}
          </Button>
        )}
      </div>

      {/* ── The clock ───────────────────────────────── */}
      {canLog && (
        <Card>
          <CardContent className="py-4">
            {mine ? (
              <div className="flex flex-wrap items-center justify-between gap-4">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="relative flex h-2 w-2">
                      <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
                      <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
                    </span>
                    <span className="text-sm font-medium text-zinc-100">{t('shifts.onDutySince')
                      .replace('{time}', formatDateTime(mine.startedAt))}</span>
                  </div>
                  <p className="mt-1 text-xs text-zinc-500">
                    {[mine.position, mine.location].filter(Boolean).join(' · ') || t('shifts.noPosition')}
                  </p>
                  <Elapsed since={mine.startedAt} />
                </div>

                <div className="flex flex-wrap items-end gap-2">
                  <div className="space-y-1">
                    <Label htmlFor="break-minutes" className="text-xs">{t('shifts.breakMinutes')}</Label>
                    <Input
                      id="break-minutes"
                      type="number"
                      min={0}
                      className="w-24"
                      value={breakMinutes}
                      onChange={(e) => setBreakMinutes(e.target.value)}
                    />
                  </div>
                  <Button
                    onClick={() => clockOut.mutate()}
                    disabled={clockOut.isPending}
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
      )}

      {/* ── Who else is working ─────────────────────── */}
      {canViewAll && (onDuty.data?.onDuty.length ?? 0) > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="flex items-center gap-1.5 text-xs uppercase tracking-wide text-zinc-500">
            <Users className="h-3.5 w-3.5" />
            {t('shifts.onDutyNow')}
          </span>
          {onDuty.data!.onDuty.map((shift) => (
            <Badge key={shift.id} variant="outline" className="gap-1.5 py-1">
              <Avatar className="h-4 w-4">
                <AvatarImage src={shift.avatarUrl ?? undefined} alt="" />
                <AvatarFallback className="text-[7px]">{shift.userName.slice(0, 2).toUpperCase()}</AvatarFallback>
              </Avatar>
              {shift.userName}
              <span className="text-zinc-500">{timeOnly(shift.startedAt)}</span>
            </Badge>
          ))}
        </div>
      )}

      {/* ── The month ───────────────────────────────── */}
      <Card>
        <CardContent className="space-y-3 py-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-1">
              <Button
                variant="ghost"
                size="icon"
                aria-label={t('shifts.previousMonth')}
                onClick={() => {
                  setSelectedDay(null);
                  setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1));
                }}
              >
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <span className="min-w-[9rem] text-center text-sm font-medium text-zinc-200">
                {month.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}
              </span>
              <Button
                variant="ghost"
                size="icon"
                aria-label={t('shifts.nextMonth')}
                onClick={() => {
                  setSelectedDay(null);
                  setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1));
                }}
              >
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {summary.data && (
                <span className="text-xs text-zinc-400">
                  {t('shifts.monthTotal').replace('{time}', hoursAndMinutes(summary.data.totalMinutes))}
                </span>
              )}
              {canViewAll && (
                <SearchableSelect
                  className="w-[170px]"
                  size="sm"
                  aria-label={t('shifts.filterByMember')}
                  value={memberFilter}
                  onValueChange={setMemberFilter}
                  options={memberOptions}
                  placeholder={t('shifts.everyone')}
                />
              )}
            </div>
          </div>

          {list.isLoading ? (
            <Skeleton className="h-64 w-full" />
          ) : list.isError ? (
            <ErrorState error={list.error} onRetry={() => void list.refetch()} />
          ) : (
            <MonthGrid
              month={month}
              byDay={byDay}
              selectedDay={selectedDay}
              onSelect={(day) => setSelectedDay(day === selectedDay ? null : day)}
            />
          )}
        </CardContent>
      </Card>

      {/* ── Hours per member ────────────────────────── */}
      {canViewAll && (summary.data?.members.length ?? 0) > 0 && (
        <Card>
          <CardContent className="py-4">
            <p className="text-xs uppercase tracking-wide text-zinc-500">{t('shifts.hoursThisMonth')}</p>
            <div className="mt-3 space-y-2">
              {summary.data!.members.map((row) => (
                <div key={row.userId} className="flex items-center gap-3">
                  <Avatar className="h-6 w-6">
                    <AvatarImage src={row.avatarUrl ?? undefined} alt="" />
                    <AvatarFallback className="text-[8px]">{row.userName.slice(0, 2).toUpperCase()}</AvatarFallback>
                  </Avatar>
                  <span className="min-w-0 flex-1 truncate text-sm text-zinc-200">{row.userName}</span>
                  <span className="text-xs text-zinc-500">
                    {t('shifts.shiftCount').replace('{count}', String(row.shiftCount))}
                  </span>
                  <span className="w-20 text-right text-sm tabular-nums text-zinc-100">
                    {hoursAndMinutes(row.minutes)}
                  </span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* ── The shifts themselves ───────────────────── */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-medium text-zinc-300">
            {selectedDay
              ? t('shifts.shiftsOn').replace('{day}', selectedDay)
              : t('shifts.allThisMonth')}
          </h2>
          {selectedDay && (
            <Button variant="ghost" size="sm" onClick={() => setSelectedDay(null)}>
              {t('shifts.clearDay')}
            </Button>
          )}
        </div>

        {dayShifts.length === 0 ? (
          <EmptyState icon={CalendarDays} title={t('shifts.empty')} hint={t('shifts.emptyHint')} />
        ) : (
          dayShifts.map((shift) => (
            <ShiftRow
              key={shift.id}
              shift={shift}
              // Your own, or anybody's with manage_shifts. Reading somebody
              // else's rota does not come with a pencil on it.
              canEdit={canManage || (canLog && shift.userId === user?.id)}
              onEdit={() => setEditing(shift)}
              onRemove={() => setRemoving(shift)}
            />
          ))
        )}
      </div>

      {(editing || adding) && (
        <ShiftDialog
          factionId={factionId}
          shift={editing}
          members={canManage ? memberOptions.filter((o) => o.value) : []}
          positions={positions.data?.positions ?? []}
          onClose={() => { setEditing(null); setAdding(false); }}
          onSaved={() => { invalidate(); setEditing(null); setAdding(false); }}
        />
      )}

      <AlertDialog open={!!removing} onOpenChange={(open) => !open && setRemoving(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('shifts.removeTitle')}</AlertDialogTitle>
            <AlertDialogDescription>{t('shifts.removeBody')}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => removing && remove.mutate(removing.id)}
              disabled={remove.isPending}
              className="bg-red-600 text-white hover:bg-red-500"
            >
              {t('common.delete')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

/**
 * How long the open shift has been running, counted on screen.
 *
 * The server never sends a length for a shift that has not finished — a number
 * that changes while you look at it does not belong in a stored total — but
 * the person watching the clock wants exactly that number, so it is counted
 * here and nowhere else.
 */
function Elapsed({ since }: { since: string }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, []);
  const minutes = Math.max(0, Math.floor((now - new Date(since).getTime()) / 60_000));
  return (
    <p className="mt-2 flex items-center gap-1.5 text-2xl font-semibold tabular-nums text-zinc-100">
      <Clock className="h-5 w-5 text-zinc-500" />
      {hoursAndMinutes(minutes)}
    </p>
  );
}

/** The month as a grid, each day carrying what was worked on it. */
function MonthGrid({
  month,
  byDay,
  selectedDay,
  onSelect,
}: {
  month: Date;
  byDay: Map<string, Shift[]>;
  selectedDay: string | null;
  onSelect: (day: string) => void;
}) {
  const { t } = useTranslation();
  const first = new Date(month.getFullYear(), month.getMonth(), 1);
  const daysInMonth = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
  // Monday-first, which is how a rota is read everywhere this app is used.
  const leading = (first.getDay() + 6) % 7;
  const today = dayKey(new Date());

  const cells: (string | null)[] = [
    ...Array<null>(leading).fill(null),
    ...Array.from({ length: daysInMonth }, (_, i) =>
      dayKey(new Date(month.getFullYear(), month.getMonth(), i + 1))),
  ];

  const weekdays = useMemo(() => {
    // Rendered from a real week so the labels follow the interface language.
    const monday = new Date(2024, 0, 1);
    return Array.from({ length: 7 }, (_, i) => {
      const d = new Date(monday);
      d.setDate(monday.getDate() + i);
      return d.toLocaleDateString(undefined, { weekday: 'short' });
    });
  }, []);

  return (
    <div>
      <div className="grid grid-cols-7 gap-1 pb-1">
        {weekdays.map((label) => (
          <div key={label} className="text-center text-[10px] uppercase tracking-wide text-zinc-600">
            {label}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-1">
        {cells.map((day, index) => {
          if (!day) return <div key={`pad-${index}`} />;
          const dayShifts = byDay.get(day) ?? [];
          const minutes = dayShifts.reduce((a, s) => a + (s.workedMinutes ?? 0), 0);
          const running = dayShifts.some((s) => !s.endedAt);
          const isToday = day === today;
          const isSelected = day === selectedDay;

          return (
            <button
              key={day}
              type="button"
              onClick={() => onSelect(day)}
              aria-pressed={isSelected}
              aria-label={`${day}${minutes ? ` — ${hoursAndMinutes(minutes)}` : ''}`}
              className={`flex min-h-[4.25rem] flex-col items-start rounded-md border p-1.5 text-left transition-colors ${
                isSelected
                  ? 'border-[var(--brand-color-light)] bg-[var(--fill-3)]'
                  : dayShifts.length > 0
                    ? 'border-[var(--line-2)] bg-[var(--fill-1)] hover:bg-[var(--fill-2)]'
                    : 'border-[var(--line-1)] hover:bg-[var(--fill-1)]'
              }`}
            >
              <span className={`text-xs tabular-nums ${isToday ? 'font-semibold text-brand' : 'text-zinc-500'}`}>
                {Number(day.slice(-2))}
              </span>
              {minutes > 0 && (
                <span className="mt-1 text-xs font-medium text-zinc-100">{hoursAndMinutes(minutes)}</span>
              )}
              {dayShifts.length > 0 && (
                <span className="text-[10px] text-zinc-500">
                  {running
                    ? t('shifts.stillRunning')
                    : t('shifts.shiftCount').replace('{count}', String(dayShifts.length))}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function ShiftRow({
  shift,
  canEdit,
  onEdit,
  onRemove,
}: {
  shift: Shift;
  canEdit: boolean;
  onEdit: () => void;
  onRemove: () => void;
}) {
  const { t } = useTranslation();
  const running = !shift.endedAt;

  return (
    <div className="flex flex-wrap items-center gap-3 rounded-lg border border-[var(--line-2)] bg-[var(--surface-1)] p-3">
      <Avatar className="h-7 w-7">
        <AvatarImage src={shift.avatarUrl ?? undefined} alt="" />
        <AvatarFallback className="text-[9px]">{shift.userName.slice(0, 2).toUpperCase()}</AvatarFallback>
      </Avatar>

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="truncate text-sm text-zinc-100">{shift.userName}</span>
          {shift.position && <Badge variant="outline" className="text-[10px]">{shift.position}</Badge>}
          {/* A side job counted silently in a faction's hours would be a
              quietly wrong number, so it always says which it is. */}
          {shift.kind === 'side' && (
            <Badge variant="outline" className="border-sky-500/30 bg-sky-500/10 text-[10px] text-sky-300">
              {t('shifts.kindSide')}
            </Badge>
          )}
          {running && (
            <Badge variant="outline" className="border-emerald-500/30 bg-emerald-500/10 text-[10px] text-emerald-400">
              {t('shifts.onDuty')}
            </Badge>
          )}
          {/* A timesheet somebody else corrected is a different thing from one
              that was clocked, and the person whose hours they are should be
              able to tell which they are looking at. */}
          {shift.editedBy && (
            <Badge variant="outline" className="text-[10px] text-zinc-500">{t('shifts.edited')}</Badge>
          )}
        </div>
        <p className="mt-0.5 text-xs text-zinc-500">
          {timeOnly(shift.startedAt)} – {shift.endedAt ? timeOnly(shift.endedAt) : '…'}
          {shift.location ? ` · ${shift.location}` : ''}
          {shift.breakMinutes > 0
            ? ` · ${t('shifts.breakOf').replace('{minutes}', String(shift.breakMinutes))}`
            : ''}
        </p>
        {shift.notes && <p className="mt-1 text-xs text-zinc-400">{shift.notes}</p>}
      </div>

      <span className="text-sm tabular-nums text-zinc-200">
        {shift.workedMinutes === null ? '—' : hoursAndMinutes(shift.workedMinutes)}
      </span>

      {canEdit && (
        <div className="flex gap-0.5">
          <Button variant="ghost" size="icon" onClick={onEdit} aria-label={t('common.edit')}>
            <Pencil className="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="icon" onClick={onRemove} aria-label={t('common.delete')}>
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      )}
    </div>
  );
}

/** Writing or correcting a whole shift, times and all. */
function ShiftDialog({
  factionId,
  shift,
  members,
  positions,
  onClose,
  onSaved,
}: {
  factionId: string;
  shift: Shift | null;
  members: SearchableSelectOption[];
  positions: string[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const { t } = useTranslation();
  const { toast } = useToast();

  const [userId, setUserId] = useState(shift?.userId ?? '');
  const [kind, setKind] = useState<ShiftKind>(shift?.kind ?? 'faction');
  const [position, setPosition] = useState(shift?.position ?? '');
  const [location, setLocation] = useState(shift?.location ?? '');
  const [notes, setNotes] = useState(shift?.notes ?? '');
  const [startedAt, setStartedAt] = useState(
    toLocalInput(shift?.startedAt ?? new Date(Date.now() - 3_600_000).toISOString()),
  );
  const [endedAt, setEndedAt] = useState(toLocalInput(shift?.endedAt ?? new Date().toISOString()));
  const [breakMinutes, setBreakMinutes] = useState(String(shift?.breakMinutes ?? 0));

  const save = useMutation({
    mutationFn: () => {
      const body = {
        kind,
        position: position.trim() || null,
        location: location.trim() || null,
        notes: notes.trim() || null,
        startedAt: new Date(startedAt).toISOString(),
        endedAt: new Date(endedAt).toISOString(),
        breakMinutes: Math.max(0, Number(breakMinutes) || 0),
      };
      return shift
        ? shiftsApi.update(factionId, shift.id, body)
        : shiftsApi.create(factionId, { ...body, userId: userId || undefined });
    },
    onSuccess: () => {
      toast({ title: t('shifts.saved') });
      onSaved();
    },
    onError: (err) =>
      toast({ title: t('shifts.failed'), description: apiErrorMessage(err), variant: 'destructive' }),
  });

  const valid = !!startedAt && !!endedAt && new Date(endedAt) > new Date(startedAt);

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{shift ? t('shifts.editTitle') : t('shifts.addTitle')}</DialogTitle>
          <DialogDescription>{t('shifts.addHint')}</DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          {!shift && members.length > 0 && (
            <div className="space-y-1">
              <Label>{t('shifts.member')}</Label>
              <SearchableSelect
                value={userId}
                onValueChange={setUserId}
                options={members}
                placeholder={t('shifts.myself')}
              />
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label htmlFor="dialog-started">{t('shifts.startedAt')}</Label>
              <Input
                id="dialog-started"
                type="datetime-local"
                value={startedAt}
                onChange={(e) => setStartedAt(e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="dialog-ended">{t('shifts.endedAt')}</Label>
              <Input
                id="dialog-ended"
                type="datetime-local"
                value={endedAt}
                onChange={(e) => setEndedAt(e.target.value)}
              />
            </div>
          </div>

          <div className="space-y-1">
            <Label>{t('shifts.forWhom')}</Label>
            <div className="flex rounded-lg border border-[var(--line-2)] p-0.5" role="tablist" aria-label={t('shifts.forWhom')}>
              {(['faction', 'side'] as const).map((value) => (
                <button
                  key={value}
                  role="tab"
                  type="button"
                  aria-selected={kind === value}
                  onClick={() => setKind(value)}
                  className={`h-8 flex-1 rounded-md px-3 text-xs font-medium transition-colors ${
                    kind === value ? 'bg-[var(--fill-4)] text-zinc-100' : 'text-zinc-500 hover:text-zinc-300'
                  }`}
                >
                  {t(value === 'faction' ? 'shifts.kindFaction' : 'shifts.kindSide')}
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label htmlFor="dialog-position">{t('shifts.position')}</Label>
              <Input
                id="dialog-position"
                list="shift-positions-dialog"
                value={position}
                onChange={(e) => setPosition(e.target.value)}
              />
              <datalist id="shift-positions-dialog">
                {positions.map((p) => <option key={p} value={p} />)}
              </datalist>
            </div>
            <div className="space-y-1">
              <Label htmlFor="dialog-break">{t('shifts.breakMinutes')}</Label>
              <Input
                id="dialog-break"
                type="number"
                min={0}
                value={breakMinutes}
                onChange={(e) => setBreakMinutes(e.target.value)}
              />
            </div>
          </div>

          <div className="space-y-1">
            <Label htmlFor="dialog-location">{t('shifts.location')}</Label>
            <Input
              id="dialog-location"
              value={location}
              onChange={(e) => setLocation(e.target.value)}
            />
          </div>

          <div className="space-y-1">
            <Label htmlFor="dialog-notes">{t('shifts.notes')}</Label>
            <Textarea
              id="dialog-notes"
              rows={2}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>{t('common.cancel')}</Button>
          <Button onClick={() => save.mutate()} disabled={!valid || save.isPending}>
            {t('common.save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
