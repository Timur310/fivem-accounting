'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { storageApi, apiErrorMessage } from '@/lib/api-client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Segmented } from '@/components/ui/segmented';
import { Skeleton } from '@/components/ui/skeleton';
import { SearchableSelect } from '@/components/ui/searchable-select';
import { ItemIcon } from '@/components/item-icon';
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { useToast } from '@/hooks/use-toast';
import { useTranslation } from '@/providers/i18n-provider';
import { formatDate } from '@/lib/format';
import { cn } from '@/lib/utils';
import { cents, fullness, plainNumber } from '@/lib/storage-layout';
import { KIND_ICON } from '@/components/storage/room-grid';
import { ArrowLeftRight, ClipboardCheck, Minus, Plus, Square, Trash2 } from 'lucide-react';
import type { ItemType, StorageContainer, StorageContent } from '@/lib/api-types';

const COUNT = /^\d{1,13}(\.\d{1,2})?$/;
const OTHER = '__other__';

/**
 * One container, opened: what is in it, how full it is, and — for somebody
 * holding `update_storage` — adding, taking, moving and correcting counts.
 *
 * Plus and minus change by one, which is most trips to a bench. Anything else
 * goes through a line's own row: an amount, then Add, Take or "It is exactly
 * this" for a correction after counting.
 */
export function ContainerPanel({
  factionId,
  roomId,
  container,
  containers,
  items,
  canUpdate,
  onClose,
}: {
  factionId: string;
  roomId: string;
  container: StorageContainer;
  /** Every container in the room, for Move. */
  containers: StorageContainer[];
  items: ItemType[];
  canUpdate: boolean;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<'contents' | 'history'>('contents');
  const [open, setOpen] = useState<string | null>(null);
  const [adding, setAdding] = useState({ item: '', label: '', quantity: '' });

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ['storage-room', factionId, roomId] });
    void queryClient.invalidateQueries({ queryKey: ['storage-search', factionId] });
    void queryClient.invalidateQueries({ queryKey: ['storage-compare', factionId] });
    void queryClient.invalidateQueries({ queryKey: ['storage-history', factionId] });
    void queryClient.invalidateQueries({ queryKey: ['storage-rooms', factionId] });
  };
  const fail = (err: unknown) =>
    toast({ title: t('common.failed'), description: apiErrorMessage(err), variant: 'destructive' });

  const history = useQuery({
    queryKey: ['storage-history', factionId, container.id],
    queryFn: () => storageApi.history(factionId, container.id),
    enabled: tab === 'history',
  });

  const change = useMutation({
    mutationFn: (v: { id: string; delta?: string; quantity?: string; minQuantity?: string | null; maxQuantity?: string | null }) =>
      storageApi.changeContent(factionId, v.id, v),
    onSuccess: invalidate,
    onError: fail,
  });
  const remove = useMutation({
    mutationFn: (id: string) => storageApi.removeContent(factionId, id),
    onSuccess: () => { setOpen(null); invalidate(); },
    onError: fail,
  });
  const move = useMutation({
    mutationFn: (v: { id: string; to: string; amount: string }) => storageApi.moveContent(factionId, v.id, v.to, v.amount),
    onSuccess: () => { setOpen(null); invalidate(); toast({ title: t('storage.moved') }); },
    onError: fail,
  });
  const add = useMutation({
    mutationFn: () => storageApi.addContent(factionId, container.id, {
      ...(adding.item && adding.item !== OTHER ? { itemTypeId: adding.item } : { label: adding.label.trim() }),
      quantity: adding.quantity.trim(),
    }),
    onSuccess: () => { setAdding({ item: '', label: '', quantity: '' }); invalidate(); },
    onError: fail,
  });
  const check = useMutation({
    mutationFn: () => storageApi.markChecked(factionId, container.id),
    onSuccess: () => { invalidate(); toast({ title: t('storage.checkedDone') }); },
    onError: fail,
  });

  const Icon = KIND_ICON[container.kind] ?? Square;
  const total = container.contents.reduce((s, c) => s + cents(c.quantity), 0);
  const fill = fullness(container.contents, container.capacity);
  const itemById = new Map(items.map((i) => [i.id, i]));
  const canAdd = COUNT.test(adding.quantity.trim()) && cents(adding.quantity) > 0
    && (adding.item && adding.item !== OTHER ? true : adding.label.trim().length > 0);

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Icon className="h-5 w-5" style={container.color ? { color: container.color } : undefined} />
            {container.name}
          </DialogTitle>
          <DialogDescription className="flex flex-wrap items-center gap-1.5">
            <span>{t(`storage.kind.${container.kind}` as never)}</span>
            {container.tags.map((tag) => <Badge key={tag} variant="outline" className="text-[10px]">{tag}</Badge>)}
          </DialogDescription>
        </DialogHeader>

        {/* How full, and when it was last counted. */}
        <div className="space-y-1.5">
          <div className="flex items-baseline justify-between text-xs text-zinc-400">
            <span>
              {container.capacity
                ? t('storage.filled', { count: plainNumber((total / 100).toFixed(2)), capacity: plainNumber(container.capacity) })
                : t('storage.unitsNoLimit', { count: plainNumber((total / 100).toFixed(2)) })}
            </span>
            {container.checkedAt && (
              <span>{t('storage.lastChecked', { date: formatDate(container.checkedAt), name: container.checkedByName ?? '' })}</span>
            )}
          </div>
          {fill !== null && (
            <div className="h-1.5 overflow-hidden rounded-full bg-zinc-800">
              <div
                className={cn('h-full rounded-full', fill > 1 ? 'bg-red-500' : fill >= 0.9 ? 'bg-red-400' : fill >= 0.7 ? 'bg-amber-400' : 'bg-emerald-400')}
                style={{ width: `${Math.min(1, fill) * 100}%` }}
              />
            </div>
          )}
          {container.notes && <p className="whitespace-pre-wrap text-xs text-zinc-500">{container.notes}</p>}
        </div>

        <Segmented
          label={t('storage.panel')}
          value={tab}
          onChange={setTab}
          options={[
            { value: 'contents', label: t('storage.contents') },
            { value: 'history', label: t('storage.history') },
          ]}
        />

        {tab === 'contents' ? (
          <div className="space-y-2">
            {container.contents.length === 0 && (
              <p className="py-4 text-center text-sm text-zinc-500">{t('storage.emptyContainer')}</p>
            )}
            {container.contents.map((line) => (
              <ContentRow
                key={line.id}
                line={line}
                item={line.itemTypeId ? itemById.get(line.itemTypeId) : undefined}
                expanded={open === line.id}
                onToggle={() => setOpen(open === line.id ? null : line.id)}
                canUpdate={canUpdate}
                others={containers.filter((c) => c.id !== container.id)}
                busy={change.isPending || move.isPending || remove.isPending}
                onChange={(v) => change.mutate({ id: line.id, ...v })}
                onMove={(to, amount) => move.mutate({ id: line.id, to, amount })}
                onRemove={() => remove.mutate(line.id)}
              />
            ))}

            {canUpdate && (
              <div className="space-y-2 rounded-md border border-dashed border-zinc-800 p-3">
                <p className="text-xs font-medium text-zinc-400">{t('storage.addItem')}</p>
                <div className="flex flex-wrap gap-2">
                  <SearchableSelect
                    className="min-w-[10rem] flex-1"
                    size="sm"
                    value={adding.item}
                    placeholder={t('storage.pickItem')}
                    onValueChange={(item) => setAdding((a) => ({ ...a, item }))}
                    options={[
                      ...items.map((i) => ({
                        value: i.id,
                        label: i.name,
                        icon: <ItemIcon src={i.imageUrl} icon={i.icon} category={i.category} className="size-4" />,
                      })),
                      { value: OTHER, label: t('storage.otherItem') },
                    ]}
                    aria-label={t('storage.pickItem')}
                  />
                  {adding.item === OTHER && (
                    <Input
                      className="min-w-[8rem] flex-1"
                      value={adding.label}
                      maxLength={100}
                      placeholder={t('storage.itemName')}
                      onChange={(e) => setAdding((a) => ({ ...a, label: e.target.value }))}
                    />
                  )}
                  <Input
                    className="w-24"
                    inputMode="decimal"
                    value={adding.quantity}
                    placeholder={t('storage.quantity')}
                    onChange={(e) => setAdding((a) => ({ ...a, quantity: e.target.value }))}
                    onKeyDown={(e) => e.key === 'Enter' && canAdd && add.mutate()}
                  />
                  <Button size="sm" onClick={() => add.mutate()} disabled={!canAdd || add.isPending}>
                    <Plus className="mr-1 h-3.5 w-3.5" />{t('storage.add')}
                  </Button>
                </div>
              </div>
            )}

            {canUpdate && container.contents.length > 0 && (
              <Button variant="outline" size="sm" className="w-full" onClick={() => check.mutate()} disabled={check.isPending}>
                <ClipboardCheck className="mr-1.5 h-4 w-4" />{t('storage.markChecked')}
              </Button>
            )}
          </div>
        ) : history.isLoading ? (
          <Skeleton className="h-32 w-full" />
        ) : (history.data?.history.length ?? 0) === 0 ? (
          <p className="py-4 text-center text-sm text-zinc-500">{t('storage.noHistory')}</p>
        ) : (
          <ul className="divide-y divide-zinc-800/70 text-sm">
            {history.data!.history.map((h) => (
              <li key={h.id} className="flex items-baseline justify-between gap-3 py-2">
                <span className="min-w-0 text-zinc-300">
                  <span className="font-medium text-zinc-100">{h.userName}</span>{' '}
                  {h.kind === 'move'
                    ? t(h.toContainerId === container.id ? 'storage.h.movedIn' : 'storage.h.movedOut', {
                      amount: plainNumber(h.amount), label: h.label,
                      other: h.toContainerId === container.id ? h.containerName : h.toContainerName ?? '',
                    })
                    : t(`storage.h.${h.kind}` as never, {
                      amount: plainNumber(h.amount), label: h.label, before: plainNumber(h.before ?? '0'),
                    })}
                </span>
                <span className="shrink-0 text-[11px] text-zinc-500">{formatDate(h.createdAt)}</span>
              </li>
            ))}
          </ul>
        )}
      </DialogContent>
    </Dialog>
  );
}

function ContentRow({
  line, item, expanded, onToggle, canUpdate, others, busy, onChange, onMove, onRemove,
}: {
  line: StorageContent;
  item?: ItemType;
  expanded: boolean;
  onToggle: () => void;
  canUpdate: boolean;
  others: StorageContainer[];
  busy: boolean;
  onChange: (v: { delta?: string; quantity?: string; minQuantity?: string | null; maxQuantity?: string | null }) => void;
  onMove: (to: string, amount: string) => void;
  onRemove: () => void;
}) {
  const { t } = useTranslation();
  const [amount, setAmount] = useState('');
  const [min, setMin] = useState(line.minQuantity ? plainNumber(line.minQuantity) : '');
  const [max, setMax] = useState(line.maxQuantity ? plainNumber(line.maxQuantity) : '');
  const [to, setTo] = useState('');

  const low = line.minQuantity !== null && cents(line.quantity) < cents(line.minQuantity);
  const validAmount = COUNT.test(amount.trim()) && cents(amount) > 0;
  const limitOk = (v: string) => v.trim() === '' || COUNT.test(v.trim());

  return (
    <div className={cn('rounded-md border px-3 py-2', low ? 'border-red-500/40 bg-red-500/5' : 'border-zinc-800')}>
      <div className="flex items-center gap-2">
        <button type="button" onClick={onToggle} className="flex min-w-0 flex-1 items-center gap-2 text-left">
          <ItemIcon src={item?.imageUrl} icon={item?.icon} category={item?.category} className="size-5" />
          <span className="truncate text-sm text-zinc-100">{line.label}</span>
          {low && <Badge className="bg-red-500/15 text-[10px] text-red-300">{t('storage.low')}</Badge>}
        </button>
        {canUpdate && (
          <Button size="icon-xs" variant="ghost" disabled={busy || cents(line.quantity) < 100} onClick={() => onChange({ delta: '-1' })} aria-label={t('storage.takeOne')}>
            <Minus className="h-3.5 w-3.5" />
          </Button>
        )}
        <span className={cn('min-w-[3ch] text-right text-sm font-medium tabular-nums', low ? 'text-red-300' : 'text-zinc-100')}>
          {plainNumber(line.quantity)}
        </span>
        {canUpdate && (
          <Button size="icon-xs" variant="ghost" disabled={busy} onClick={() => onChange({ delta: '1' })} aria-label={t('storage.addOne')}>
            <Plus className="h-3.5 w-3.5" />
          </Button>
        )}
      </div>
      {(line.minQuantity || line.maxQuantity) && !expanded && (
        <p className="mt-0.5 pl-7 text-[11px] text-zinc-500">
          {[line.minQuantity && t('storage.minShort', { n: plainNumber(line.minQuantity) }),
            line.maxQuantity && t('storage.maxShort', { n: plainNumber(line.maxQuantity) })].filter(Boolean).join(' · ')}
        </p>
      )}

      {expanded && canUpdate && (
        <div className="mt-3 space-y-3 border-t border-zinc-800 pt-3">
          <div className="flex flex-wrap items-center gap-2">
            <Input className="h-8 w-24" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder={t('storage.amount')} />
            <Button size="sm" variant="outline" disabled={!validAmount || busy} onClick={() => { onChange({ delta: amount.trim() }); setAmount(''); }}>
              {t('storage.add')}
            </Button>
            <Button size="sm" variant="outline" disabled={!validAmount || busy} onClick={() => { onChange({ delta: `-${amount.trim()}` }); setAmount(''); }}>
              {t('storage.take')}
            </Button>
            <Button size="sm" variant="ghost" disabled={!COUNT.test(amount.trim()) || busy} onClick={() => { onChange({ quantity: amount.trim() }); setAmount(''); }}>
              {t('storage.setExactly')}
            </Button>
          </div>

          {others.length > 0 && (
            <div className="flex flex-wrap items-center gap-2">
              <ArrowLeftRight className="h-4 w-4 text-zinc-500" />
              <SearchableSelect
                className="min-w-[9rem] flex-1"
                size="sm"
                value={to}
                placeholder={t('storage.moveTo')}
                onValueChange={setTo}
                options={others.map((c) => ({ value: c.id, label: c.name }))}
                aria-label={t('storage.moveTo')}
              />
              <Button size="sm" variant="outline" disabled={!to || !validAmount || busy} onClick={() => onMove(to, amount.trim())}>
                {t('storage.move')}
              </Button>
            </div>
          )}

          <div className="flex flex-wrap items-end gap-2">
            <label className="space-y-1 text-[11px] text-zinc-500">
              <span>{t('storage.min')}</span>
              <Input className={cn('h-8 w-20', !limitOk(min) && 'border-red-500/60')} inputMode="decimal" value={min} onChange={(e) => setMin(e.target.value)} />
            </label>
            <label className="space-y-1 text-[11px] text-zinc-500">
              <span>{t('storage.max')}</span>
              <Input className={cn('h-8 w-20', !limitOk(max) && 'border-red-500/60')} inputMode="decimal" value={max} onChange={(e) => setMax(e.target.value)} />
            </label>
            <Button
              size="sm"
              variant="ghost"
              disabled={!limitOk(min) || !limitOk(max) || busy}
              onClick={() => onChange({ minQuantity: min.trim() || null, maxQuantity: max.trim() || null })}
            >
              {t('storage.saveLimits')}
            </Button>
            <Button size="sm" variant="ghost" className="ml-auto text-red-400" disabled={busy} onClick={onRemove}>
              <Trash2 className="mr-1 h-3.5 w-3.5" />{t('common.remove')}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
