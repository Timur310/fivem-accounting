'use client';

import { useEffect, useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { operationsApi, membersApi, itemTypesApi, apiErrorMessage } from '@/lib/api-client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState, ErrorState } from '@/components/ui/empty-state';
import { SearchableSelect } from '@/components/ui/searchable-select';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { useToast } from '@/hooks/use-toast';
import { useTranslation } from '@/providers/i18n-provider';
import { formatAmount, formatDateTime, displayName } from '@/lib/format';
import { Crosshair, Plus, Star, Trash2, Undo2, Users } from 'lucide-react';
import { OPERATION_KINDS, OPERATION_KIND_KEYS } from '@/lib/api-types';
import type {
  Operation, OperationCredit, OperationKind, OperationSplit, OperationSplitInput,
} from '@/lib/api-types';

/** A row in the crew list: who, how many shares, and how the night went. */
interface CrewRow {
  userId: string;
  share: number;
  /** 1 to 5, or null for not rated — which is most of the time. */
  rating: number | null;
  ratingNote: string;
}

/**
 * Five stars, clicked to set and clicked again to clear.
 *
 * Clearing matters more than it sounds: rating somebody is optional, and a
 * control you cannot take back turns a misclick into a permanent two out of
 * five on a record other people read.
 */
function RatingStars({
  value,
  onChange,
  label,
}: {
  value: number | null;
  onChange: (value: number | null) => void;
  label: string;
}) {
  return (
    <div className="flex items-center gap-0.5" role="group" aria-label={label}>
      {[1, 2, 3, 4, 5].map((star) => (
        <button
          key={star}
          type="button"
          onClick={() => onChange(value === star ? null : star)}
          aria-label={`${label}: ${star}`}
          aria-pressed={value !== null && star <= value}
          className="p-0.5 text-zinc-600 transition-colors hover:text-amber-300"
        >
          <Star
            className={`h-4 w-4 ${value !== null && star <= value ? 'fill-amber-400 text-amber-400' : ''}`}
          />
        </button>
      ))}
    </div>
  );
}

/** A row in the haul list. Quantity stays a string — it is money. */
interface LootRow {
  itemTypeId: string;
  quantity: string;
}

/** The datetime-local value for a moment, in the browser's own timezone. */
function localInputValue(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/**
 * Jobs the crew ran together.
 *
 * The screen exists to replace one conversation. Four people come back from a
 * bank with cash and gold, and then spend ten minutes in Discord working out
 * who logs what — and getting it wrong, because four people rounding by hand
 * never add up to the haul. Here it is one form: who was there, what came
 * back, what the faction takes off the top. The split is worked out by the
 * server and shown before anybody agrees to it.
 *
 * Reading is open to every member. `log_operations` is what it takes to write
 * one down, and `manage_operations` to take one back out again.
 */
export function OperationsView({
  factionId,
  canLog,
  canManage,
}: {
  factionId: string;
  canLog: boolean;
  canManage: boolean;
}) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [reverting, setReverting] = useState<Operation | null>(null);

  const query = useQuery({
    queryKey: ['operations', factionId],
    queryFn: () => operationsApi.list(factionId),
  });

  const members = useQuery({
    queryKey: ['members', factionId],
    queryFn: () => membersApi.list(factionId),
  });

  const revert = useMutation({
    mutationFn: (id: string) => operationsApi.revert(factionId, id),
    onSuccess: () => {
      // The split wrote ordinary entries, so the treasury and every board that
      // reads them are stale the moment one is taken back out.
      void queryClient.invalidateQueries({ queryKey: ['operations', factionId] });
      void queryClient.invalidateQueries({ queryKey: ['entries'] });
      void queryClient.invalidateQueries({ queryKey: ['treasury'] });
      void queryClient.invalidateQueries({ queryKey: ['dashboard'] });
      setReverting(null);
      toast({ title: t('operations.revertedToast') });
    },
    onError: (err) => {
      toast({ title: t('operations.revertFailed'), description: apiErrorMessage(err), variant: 'destructive' });
    },
  });

  const operations = query.data?.operations ?? [];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-zinc-100">{t('operations.title')}</h1>
          <p className="mt-1 max-w-2xl text-sm text-zinc-400">{t('operations.subtitle')}</p>
        </div>
        {canLog && (
          <Button onClick={() => setDialogOpen(true)}>
            <Plus className="mr-2 h-4 w-4" />
            {t('operations.log')}
          </Button>
        )}
      </div>

      {query.isLoading && (
        <div className="space-y-3">
          <Skeleton className="h-28 w-full" />
          <Skeleton className="h-28 w-full" />
        </div>
      )}

      {query.isError && <ErrorState error={query.error} onRetry={() => void query.refetch()} />}

      {query.isSuccess && operations.length === 0 && (
        <EmptyState
          icon={Crosshair}
          title={t('operations.empty')}
          hint={t('operations.emptyHint')}
        />
      )}

      <div className="space-y-3">
        {operations.map((operation) => (
          <OperationCard
            key={operation.id}
            operation={operation}
            canManage={canManage}
            onRevert={() => setReverting(operation)}
          />
        ))}
      </div>

      {dialogOpen && (
        <LogOperationDialog
          factionId={factionId}
          members={members.data ?? []}
          onClose={() => setDialogOpen(false)}
        />
      )}

      <AlertDialog open={!!reverting} onOpenChange={(open) => !open && setReverting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('operations.revertTitle')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('operations.revertBody').replace('{name}', reverting?.name ?? '')}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => reverting && revert.mutate(reverting.id)}
              disabled={revert.isPending}
            >
              {t('operations.revert')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

/**
 * One job, as a card.
 *
 * The crew and the haul are the two things anybody scrolling this list is
 * looking for, so they are side by side and everything else is a line of
 * muted text above them.
 */
function OperationCard({
  operation,
  canManage,
  onRevert,
}: {
  operation: Operation;
  canManage: boolean;
  onRevert: () => void;
}) {
  const { t } = useTranslation();
  const reverted = !!operation.revertedAt;

  // What each person was actually credited with, read off the ledger rows the
  // split wrote rather than recomputed here — if the two ever disagreed, the
  // ledger is the one that is true.
  const byMember = useMemo(() => {
    const totals = new Map<string, Map<string, number>>();
    for (const move of operation.movements) {
      if (move.role !== 'share') continue;
      const line = totals.get(move.userId) ?? new Map<string, number>();
      line.set(move.itemTypeId, (line.get(move.itemTypeId) ?? 0) + Number(move.quantity));
      totals.set(move.userId, line);
    }
    return totals;
  }, [operation.movements]);

  /** How this item's numbers are written — `$` in front, `pcs` after. */
  const amountOf = (itemTypeId: string, value: number | string) => {
    const line = operation.loot.find((l) => l.itemTypeId === itemTypeId);
    return formatAmount(value, line?.unit ?? '', line?.isCurrency);
  };

  return (
    <div
      className={`rounded-lg border border-[var(--line-2)] bg-[var(--surface-1)] p-4 ${reverted ? 'opacity-60' : ''}`}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-lg font-medium text-zinc-100">{operation.name}</h2>
            <Badge variant="outline">{t(OPERATION_KIND_KEYS[operation.kind])}</Badge>
            {reverted && <Badge variant="outline">{t('operations.revertedBadge')}</Badge>}
          </div>
          <p className="mt-1 text-xs text-zinc-500">
            {formatDateTime(operation.occurredAt)}
            {operation.location ? ` · ${operation.location}` : ''}
            {` · ${t('operations.loggedBy').replace('{name}', operation.loggedByName)}`}
          </p>
        </div>
        {canManage && !reverted && (
          <Button variant="outline" size="sm" onClick={onRevert}>
            <Undo2 className="mr-2 h-4 w-4" />
            {t('operations.revert')}
          </Button>
        )}
      </div>

      <div className="mt-4 grid gap-4 md:grid-cols-2">
        <div>
          <p className="text-xs uppercase tracking-wide text-zinc-500">{t('operations.haul')}</p>
          {operation.loot.length === 0 ? (
            <p className="mt-2 text-sm text-zinc-500">{t('operations.nothingTaken')}</p>
          ) : (
            <ul className="mt-2 space-y-1 text-sm text-zinc-200">
              {operation.loot.map((line) => (
                <li key={line.id}>
                  {formatAmount(line.quantity, line.unit, line.isCurrency)} · {line.itemTypeName}
                </li>
              ))}
            </ul>
          )}
          {/* One line or the other: "credited to the faction" already says
              the cut was all of it, and printing 100% underneath is the same
              fact twice. */}
          {operation.creditTo === 'faction' ? (
            <p className="mt-2 text-xs text-zinc-500">{t('operations.creditedToFaction')}</p>
          ) : Number(operation.factionCutPercent) > 0 ? (
            <p className="mt-2 text-xs text-zinc-500">
              {t('operations.cutTaken').replace('{percent}', operation.factionCutPercent)}
            </p>
          ) : null}
        </div>

        <div>
          <p className="text-xs uppercase tracking-wide text-zinc-500">
            {t('operations.crew')} ({operation.crew.length})
          </p>
          <ul className="mt-2 space-y-1 text-sm text-zinc-200">
            {operation.crew.map((member) => {
              const totals = byMember.get(member.userId);
              return (
                <li key={member.userId} className="flex flex-wrap justify-between gap-2">
                  <span>
                    {member.name}
                    {member.share !== 1 && operation.creditTo === 'crew' && (
                      <span className="ml-1 text-xs text-zinc-500">
                        ×{member.share}
                      </span>
                    )}
                    {member.rating !== null && (
                      <span
                        className="ml-2 text-xs text-amber-400"
                        title={member.ratingNote ?? undefined}
                      >
                        {'★'.repeat(member.rating)}
                        <span className="text-zinc-700">{'★'.repeat(5 - member.rating)}</span>
                      </span>
                    )}
                    {member.ratingNote && (
                      <span className="ml-2 text-xs text-zinc-500">{member.ratingNote}</span>
                    )}
                  </span>
                  <span className="text-zinc-400">
                    {totals
                      ? [...totals.entries()]
                          .map(([itemTypeId, amount]) => amountOf(itemTypeId, amount))
                          .join(' · ')
                      : '—'}
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      </div>

      {operation.notes && <p className="mt-4 text-sm text-zinc-400">{operation.notes}</p>}
    </div>
  );
}

/** The form: who was there, what came back, and what each of them gets. */
function LogOperationDialog({
  factionId,
  members,
  onClose,
}: {
  factionId: string;
  members: { userId: string; username: string; inGameName: string | null }[];
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [name, setName] = useState('');
  const [kind, setKind] = useState<OperationKind>('bank');
  const [location, setLocation] = useState('');
  const [occurredAt, setOccurredAt] = useState(() => localInputValue(new Date()));
  const [notes, setNotes] = useState('');
  const [cut, setCut] = useState('0');
  const [creditTo, setCreditTo] = useState<OperationCredit>('crew');
  const [crew, setCrew] = useState<CrewRow[]>([]);
  const [loot, setLoot] = useState<LootRow[]>([{ itemTypeId: '', quantity: '' }]);
  const [split, setSplit] = useState<OperationSplit | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);

  const itemTypes = useQuery({
    queryKey: ['itemTypes', factionId],
    queryFn: () => itemTypesApi.list(factionId),
  });

  const memberName = (userId: string) => {
    const member = members.find((m) => m.userId === userId);
    return member ? displayName(member) : userId;
  };

  const filledLoot = loot.filter((l) => l.itemTypeId && /^\d+(\.\d{1,2})?$/.test(l.quantity) && Number(l.quantity) > 0);
  // A crew and a name is the whole requirement. Plenty of jobs are worth
  // recording and take nothing — that was the first thing people said about
  // this screen — so the haul no longer holds the form shut.
  const ready = crew.length > 0;
  const splitting = filledLoot.length > 0 && creditTo === 'crew';

  const input: OperationSplitInput = useMemo(() => ({
    participants: crew.map((c) => ({
      userId: c.userId,
      share: c.share,
      rating: c.rating,
      ratingNote: c.ratingNote.trim() || null,
    })),
    loot: filledLoot.map((l) => ({ itemTypeId: l.itemTypeId, quantity: l.quantity })),
    creditTo,
    factionCutPercent: cut || '0',
  }), [crew, JSON.stringify(filledLoot), cut, creditTo]);

  /**
   * The preview comes from the server, on a short delay.
   *
   * Working the split out in the browser would be the same arithmetic written
   * twice, and the version people agree to on screen has to be the version
   * that gets written — so the numbers below are the server's, computed by the
   * same function the save uses.
   */
  useEffect(() => {
    if (!splitting) {
      setSplit(null);
      setPreviewError(null);
      return;
    }
    let cancelled = false;
    const timer = setTimeout(() => {
      operationsApi.preview(factionId, input)
        .then((data) => {
          if (cancelled) return;
          setSplit(data);
          setPreviewError(null);
        })
        .catch((err) => {
          if (cancelled) return;
          setSplit(null);
          setPreviewError(apiErrorMessage(err));
        });
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [factionId, input, splitting]);

  const save = useMutation({
    mutationFn: () => operationsApi.create(factionId, {
      ...input,
      name: name.trim(),
      kind,
      location: location.trim() || null,
      occurredAt: new Date(occurredAt).toISOString(),
      notes: notes.trim() || null,
    }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['operations', factionId] });
      void queryClient.invalidateQueries({ queryKey: ['entries'] });
      void queryClient.invalidateQueries({ queryKey: ['treasury'] });
      void queryClient.invalidateQueries({ queryKey: ['dashboard'] });
      toast({ title: t('operations.savedToast') });
      onClose();
    },
    onError: (err) => {
      toast({ title: t('operations.saveFailed'), description: apiErrorMessage(err), variant: 'destructive' });
    },
  });

  const available = members.filter((m) => !crew.some((c) => c.userId === m.userId));

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>{t('operations.dialogTitle')}</DialogTitle>
          <DialogDescription>{t('operations.dialogDescription')}</DialogDescription>
        </DialogHeader>

        <div className="space-y-5">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="op-name">{t('operations.name')}</Label>
              <Input
                id="op-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={t('operations.namePlaceholder')}
              />
            </div>
            <div className="space-y-2">
              <Label>{t('operations.kind')}</Label>
              <SearchableSelect
                value={kind}
                onValueChange={(v) => setKind(v as OperationKind)}
                options={OPERATION_KINDS.map((k) => ({ value: k, label: t(OPERATION_KIND_KEYS[k]) }))}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="op-location">{t('operations.location')}</Label>
              <Input
                id="op-location"
                value={location}
                onChange={(e) => setLocation(e.target.value)}
                placeholder={t('operations.locationPlaceholder')}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="op-when">{t('operations.when')}</Label>
              <Input
                id="op-when"
                type="datetime-local"
                value={occurredAt}
                onChange={(e) => setOccurredAt(e.target.value)}
              />
            </div>
          </div>

          {/* ── the crew ── */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label>{t('operations.crew')}</Label>
              <span className="text-xs text-zinc-500">{t('operations.shareHint')}</span>
            </div>

            <div className="space-y-2">
              {crew.map((row) => (
                <div
                  key={row.userId}
                  className="rounded-lg border border-[var(--line-1)] p-2 space-y-2"
                >
                  <div className="flex items-center gap-2">
                    <div className="flex-1 truncate text-sm text-zinc-200">
                      {memberName(row.userId)}
                    </div>
                    {/* Only when the shares actually decide something. */}
                    {splitting && (
                      <Input
                        type="number"
                        min={1}
                        max={999}
                        className="w-20"
                        value={row.share}
                        onChange={(e) => setCrew((prev) => prev.map((c) =>
                          c.userId === row.userId
                            ? { ...c, share: Math.max(1, Math.min(999, Number(e.target.value) || 1)) }
                            : c))}
                        aria-label={t('operations.share')}
                      />
                    )}
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => setCrew((prev) => prev.filter((c) => c.userId !== row.userId))}
                      aria-label={t('common.remove')}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <RatingStars
                      value={row.rating}
                      label={`${t('operations.rating')} — ${memberName(row.userId)}`}
                      onChange={(rating) => setCrew((prev) => prev.map((c) =>
                        c.userId === row.userId ? { ...c, rating } : c))}
                    />
                    <Input
                      className="h-8 flex-1 min-w-[10rem] text-sm"
                      value={row.ratingNote}
                      onChange={(e) => setCrew((prev) => prev.map((c) =>
                        c.userId === row.userId ? { ...c, ratingNote: e.target.value } : c))}
                      placeholder={t('operations.ratingNotePlaceholder')}
                      aria-label={`${t('operations.ratingNote')} — ${memberName(row.userId)}`}
                    />
                  </div>
                </div>
              ))}
            </div>

            <SearchableSelect
              value=""
              onValueChange={(userId) => setCrew((prev) =>
                [...prev, { userId, share: 1, rating: null, ratingNote: '' }])}
              options={available.map((m) => ({ value: m.userId, label: displayName(m) }))}
              placeholder={t('operations.addMember')}
              searchPlaceholder={t('operations.searchMember')}
              emptyMessage={t('operations.noMembersLeft')}
            />
          </div>

          {/* ── the haul ── */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label>{t('operations.haul')}</Label>
              <span className="text-xs text-zinc-500">{t('operations.haulOptional')}</span>
            </div>
            {loot.map((row, index) => (
              <div key={index} className="flex items-center gap-2">
                <SearchableSelect
                  className="flex-1"
                  value={row.itemTypeId}
                  onValueChange={(itemTypeId) => setLoot((prev) =>
                    prev.map((l, i) => (i === index ? { ...l, itemTypeId } : l)))}
                  options={(itemTypes.data ?? []).map((item) => ({
                    value: item.id,
                    label: item.name,
                    hint: item.unit,
                  }))}
                  placeholder={t('operations.item')}
                />
                <Input
                  className="w-40"
                  inputMode="decimal"
                  value={row.quantity}
                  onChange={(e) => setLoot((prev) =>
                    prev.map((l, i) => (i === index ? { ...l, quantity: e.target.value } : l)))}
                  placeholder={t('operations.quantity')}
                  aria-label={t('operations.quantity')}
                />
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => setLoot((prev) => prev.filter((_, i) => i !== index))}
                  disabled={loot.length === 1}
                  aria-label={t('common.remove')}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            ))}
            <Button
              variant="outline"
              size="sm"
              onClick={() => setLoot((prev) => [...prev, { itemTypeId: '', quantity: '' }])}
            >
              <Plus className="mr-2 h-4 w-4" />
              {t('operations.addLine')}
            </Button>
          </div>

          {/* ── where the haul goes ──
              Only once there is one. A crew that took nothing has nothing to
              decide here, and the question on screen would be the same
              question this form was criticised for asking. */}
          {filledLoot.length > 0 && (
            <div className="space-y-2">
              <Label>{t('operations.creditTo')}</Label>
              <div className="grid gap-2 sm:grid-cols-2">
                {(['crew', 'faction'] as const).map((option) => (
                  <button
                    key={option}
                    type="button"
                    onClick={() => setCreditTo(option)}
                    className={`rounded-lg border p-3 text-left transition-colors ${
                      creditTo === option
                        ? 'border-[var(--line-2)] bg-[var(--fill-1)]'
                        : 'border-[var(--line-1)] opacity-70 hover:opacity-100'
                    }`}
                  >
                    <span className="block text-sm text-zinc-200">
                      {t(option === 'crew' ? 'operations.creditCrew' : 'operations.creditFaction')}
                    </span>
                    <span className="block text-xs text-zinc-500">
                      {t(option === 'crew' ? 'operations.creditCrewHint' : 'operations.creditFactionHint')}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="grid gap-4 sm:grid-cols-2">
            {splitting && (
              <div className="space-y-2">
                <Label htmlFor="op-cut">{t('operations.factionCut')}</Label>
                <Input
                  id="op-cut"
                  inputMode="decimal"
                  value={cut}
                  onChange={(e) => setCut(e.target.value)}
                />
                <p className="text-xs text-zinc-500">{t('operations.factionCutHint')}</p>
              </div>
            )}
            <div className="space-y-2">
              <Label htmlFor="op-notes">{t('operations.notes')}</Label>
              <Textarea
                id="op-notes"
                rows={3}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
              />
            </div>
          </div>

          {/* ── what everybody walks away with ── */}
          {splitting && (
          <div className="rounded-lg border border-[var(--line-2)] bg-[var(--surface-2)] p-4">
            <div className="flex items-center gap-2">
              <Users className="h-4 w-4 text-zinc-400" />
              <p className="text-sm font-medium text-zinc-200">{t('operations.splitTitle')}</p>
            </div>

            {!split && !previewError && (
              <p className="mt-2 text-sm text-zinc-500">{t('operations.splitHint')}</p>
            )}
            {previewError && <p className="mt-2 text-sm text-red-400">{previewError}</p>}

            {split && (
              <div className="mt-3 space-y-3">
                {split.lines.map((line) => (
                  <div key={line.itemTypeId}>
                    <p className="text-xs uppercase tracking-wide text-zinc-500">
                      {line.itemTypeName} · {formatAmount(line.quantity, line.unit ?? '', line.isCurrency)}
                    </p>
                    <ul className="mt-1 space-y-0.5 text-sm">
                      {Number(line.factionCut) > 0 && (
                        <li className="flex justify-between text-zinc-400">
                          <span>{t('operations.factionShare')}</span>
                          <span>{formatAmount(line.factionCut, line.unit ?? '', line.isCurrency)}</span>
                        </li>
                      )}
                      {line.shares.map((share) => (
                        <li key={share.userId} className="flex justify-between text-zinc-200">
                          <span>{memberName(share.userId)}</span>
                          <span>{formatAmount(share.quantity, line.unit ?? '', line.isCurrency)}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            )}
          </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>{t('common.cancel')}</Button>
          <Button
            onClick={() => save.mutate()}
            disabled={!ready || !name.trim() || save.isPending}
          >
            {t('operations.save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
