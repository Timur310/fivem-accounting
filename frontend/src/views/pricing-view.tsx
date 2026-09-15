'use client';

import { useEffect, useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { pricingApi, itemTypesApi, apiErrorMessage } from '@/lib/api-client';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState, ErrorState } from '@/components/ui/empty-state';
import { SearchableSelect } from '@/components/ui/searchable-select';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { useToast } from '@/hooks/use-toast';
import { useTranslation } from '@/providers/i18n-provider';
import { formatAmount } from '@/lib/format';
import { cn } from '@/lib/utils';
import {
  Calculator, Tags, Handshake, Plus, Trash2, Pencil, Copy, TriangleAlert,
} from 'lucide-react';
import type {
  ProductPrice, Counterparty, QuantityBreak, Quote, QuoteLineInput,
} from '@/lib/api-types';

type Tab = 'calculator' | 'prices' | 'partners';

/** One row of the basket, before it has been priced. */
interface BasketLine {
  key: string;
  itemTypeId: string;
  quantity: string;
  addonIds: string[];
}

let lineSeq = 0;
const newLine = (): BasketLine => ({
  key: `line-${(lineSeq += 1)}`,
  itemTypeId: '',
  quantity: '1',
  addonIds: [],
});

/**
 * The price calculator, and the list it reads.
 *
 * Asked for as "somewhere to look up what a gun costs so nobody has to do the
 * maths". What makes it worth more than a pinned Discord message is the
 * arithmetic underneath: add-ons, the buyer's own discount, and the bulk
 * ladder, applied together and totalled the same way every time.
 *
 * **No total on this screen is computed here.** Every figure comes from the
 * server, which does it in integers. Working it out a second time in the
 * browser is how the number the seller reads out and the number the books
 * record start to differ by a dollar — and one dollar is enough for a buyer to
 * argue and an accountant to lose an evening.
 */
export function PricingView({
  factionId,
  canManage,
}: {
  factionId: string;
  canManage: boolean;
}) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [tab, setTab] = useState<Tab>('calculator');
  const [lines, setLines] = useState<BasketLine[]>([newLine()]);
  const [partyId, setPartyId] = useState<string>('');

  const bookQuery = useQuery({
    queryKey: ['price-book', factionId],
    queryFn: () => pricingApi.book(factionId),
  });

  const prices = useMemo(() => bookQuery.data?.prices ?? [], [bookQuery.data]);
  const parties = useMemo(() => bookQuery.data?.parties ?? [], [bookQuery.data]);
  const breaks = useMemo(() => bookQuery.data?.breaks ?? [], [bookQuery.data]);
  const priceByItem = useMemo(
    () => new Map(prices.map((p) => [p.itemTypeId, p])),
    [prices],
  );

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['price-book', factionId] });

  // Only lines with an item and a positive quantity are worth sending; the
  // rest are half-filled rows the seller is still typing into.
  const payload: QuoteLineInput[] = useMemo(
    () => lines
      .filter((l) => l.itemTypeId && Number(l.quantity) > 0)
      .map((l) => ({
        itemTypeId: l.itemTypeId,
        quantity: l.quantity,
        ...(l.addonIds.length > 0 ? { addonIds: l.addonIds } : {}),
      })),
    [lines],
  );

  const quoteQuery = useQuery({
    queryKey: ['quote', factionId, partyId, payload],
    queryFn: () => pricingApi.quote(factionId, {
      lines: payload,
      ...(partyId ? { counterpartyId: partyId } : {}),
    }),
    enabled: payload.length > 0,
    // A quote is a pure function of the basket and the price list. Refetching
    // it because the window regained focus only makes the totals flicker.
    refetchOnWindowFocus: false,
    retry: false,
  });

  const quote = payload.length > 0 ? quoteQuery.data : undefined;

  const setLine = (key: string, patch: Partial<BasketLine>) =>
    setLines((rows) => rows.map((r) => (r.key === key ? { ...r, ...patch } : r)));

  const copyToClipboard = async () => {
    if (!quote) return;
    try {
      await navigator.clipboard.writeText(quoteAsText(quote, t('pricing.copy.total')));
      toast({ title: t('pricing.copied') });
    } catch {
      toast({ title: t('pricing.copyFailed'), variant: 'destructive' });
    }
  };

  const tabs: { id: Tab; label: string; icon: typeof Calculator }[] = [
    { id: 'calculator', label: t('pricing.tab.calculator'), icon: Calculator },
    { id: 'prices', label: t('pricing.tab.prices'), icon: Tags },
    { id: 'partners', label: t('pricing.tab.partners'), icon: Handshake },
  ];

  if (bookQuery.isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }
  if (bookQuery.isError) {
    return <ErrorState error={bookQuery.error} onRetry={() => void bookQuery.refetch()} />;
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-medium tracking-tight text-zinc-100">{t('pricing.title')}</h1>
        <p className="text-meta text-zinc-500 mt-1 max-w-2xl">{t('pricing.subtitle')}</p>
      </div>

      <div className="flex gap-1 border-b border-[var(--line-2)]">
        {tabs.map((item) => (
          <button
            key={item.id}
            onClick={() => setTab(item.id)}
            className={cn(
              'px-3 py-2 text-sm font-medium -mb-px border-b-2 transition-colors flex items-center gap-2',
              tab === item.id
                ? 'border-[var(--brand-color,#6366f1)] text-brand'
                : 'border-transparent text-zinc-500 hover:text-zinc-200',
            )}
          >
            <item.icon className="h-4 w-4" />
            {item.label}
          </button>
        ))}
      </div>

      {tab === 'calculator' && (
        prices.filter((p) => p.isActive).length === 0 ? (
          <EmptyState
            icon={Tags}
            title={t('pricing.noPrices')}
            hint={canManage ? t('pricing.noPricesHint') : t('pricing.noPricesHintMember')}
          />
        ) : (
          <div className="grid gap-4 lg:grid-cols-[1fr_320px] items-start">
            <div className="space-y-3">
              <div className="max-w-sm space-y-1.5">
                <Label>{t('pricing.buyer')}</Label>
                <SearchableSelect
                  value={partyId}
                  onValueChange={setPartyId}
                  options={[
                    { value: '', label: t('pricing.walkIn'), hint: t('pricing.noDiscount') },
                    ...parties
                      .filter((p) => p.isActive)
                      .map((p) => ({
                        value: p.id,
                        label: p.name,
                        hint: `−${p.discountPercent}%`,
                      })),
                  ]}
                />
              </div>

              {lines.map((line) => {
                const price = priceByItem.get(line.itemTypeId);
                return (
                  <Card key={line.key}>
                    <CardContent className="p-3 space-y-3">
                      <div className="flex flex-wrap items-end gap-2">
                        <div className="flex-1 min-w-[180px] space-y-1.5">
                          <Label>{t('pricing.item')}</Label>
                          <SearchableSelect
                            value={line.itemTypeId}
                            onValueChange={(v) => setLine(line.key, { itemTypeId: v, addonIds: [] })}
                            options={prices
                              .filter((p) => p.isActive)
                              .map((p) => ({
                                value: p.itemTypeId,
                                label: p.itemTypeName,
                                hint: p.unitPrice,
                                icon: p.icon ? <span>{p.icon}</span> : undefined,
                              }))}
                          />
                        </div>
                        <div className="w-28 space-y-1.5">
                          <Label>{t('pricing.quantity')}</Label>
                          <Input
                            inputMode="decimal"
                            value={line.quantity}
                            onChange={(e) => setLine(line.key, { quantity: e.target.value })}
                          />
                        </div>
                        <Button
                          variant="outline"
                          size="sm"
                          aria-label={t('common.delete')}
                          disabled={lines.length === 1}
                          onClick={() => setLines((rows) => rows.filter((r) => r.key !== line.key))}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>

                      {/* Add-ons are per product, so they only appear once one
                          is chosen — and only when it actually has any. */}
                      {price && price.addons.filter((a) => a.isActive).length > 0 && (
                        <div className="flex flex-wrap gap-2">
                          {price.addons.filter((a) => a.isActive).map((addon) => {
                            const on = line.addonIds.includes(addon.id);
                            return (
                              <button
                                key={addon.id}
                                type="button"
                                onClick={() => setLine(line.key, {
                                  addonIds: on
                                    ? line.addonIds.filter((x) => x !== addon.id)
                                    : [...line.addonIds, addon.id],
                                })}
                                className={cn(
                                  'rounded-md border px-2.5 py-1 text-xs transition-colors',
                                  on
                                    ? 'border-[var(--brand-color,#6366f1)] bg-[var(--brand-color,#6366f1)]/15 text-brand'
                                    : 'border-[var(--line-2)] text-zinc-400 hover:text-zinc-200',
                                )}
                              >
                                {addon.name} +{addon.price}
                              </button>
                            );
                          })}
                        </div>
                      )}
                    </CardContent>
                  </Card>
                );
              })}

              <Button variant="outline" size="sm" onClick={() => setLines((r) => [...r, newLine()])}>
                <Plus className="h-4 w-4" /> {t('pricing.addLine')}
              </Button>
            </div>

            <Card className="lg:sticky lg:top-4">
              <CardContent className="p-4 space-y-3">
                {quoteQuery.isError && (
                  <p className="text-sm text-red-300">{apiErrorMessage(quoteQuery.error)}</p>
                )}

                {!quote && !quoteQuery.isError && (
                  <p className="text-meta text-zinc-500">{t('pricing.pickSomething')}</p>
                )}

                {quote && (
                  <>
                    <div className="space-y-2">
                      {quote.lines.map((line, i) => (
                        <div key={i} className="flex justify-between gap-3 text-sm">
                          <span className="min-w-0 truncate text-zinc-300">
                            {line.quantity} × {line.itemTypeName}
                          </span>
                          <span className={cn('tabular-nums shrink-0', line.belowFloor && 'text-red-300')}>
                            {formatAmount(line.total, quote.currency.unit, quote.currency.isCurrency)}
                          </span>
                        </div>
                      ))}
                    </div>

                    <div className="border-t border-[var(--line-2)] pt-3 space-y-1.5 text-sm">
                      <Row
                        label={t('pricing.subtotal')}
                        value={formatAmount(quote.subtotal, quote.currency.unit, quote.currency.isCurrency)}
                      />
                      {quote.discountTotal !== '0.00' && (
                        <Row
                          label={quote.counterparty
                            ? t('pricing.discountFor', { name: quote.counterparty.name })
                            : t('pricing.discount')}
                          value={`−${formatAmount(quote.discountTotal, quote.currency.unit, quote.currency.isCurrency)}`}
                          className="text-emerald-300"
                        />
                      )}
                      <div className="flex justify-between gap-3 pt-1.5 border-t border-[var(--line-2)]">
                        <span className="font-medium">{t('pricing.total')}</span>
                        <span className="font-medium tabular-nums">
                          {formatAmount(quote.total, quote.currency.unit, quote.currency.isCurrency)}
                        </span>
                      </div>
                    </div>

                    {quote.belowFloor && (
                      <p className="flex gap-2 text-xs text-red-300">
                        <TriangleAlert className="h-4 w-4 shrink-0" />
                        {t('pricing.belowFloor')}
                      </p>
                    )}

                    <Button className="w-full" onClick={() => void copyToClipboard()}>
                      <Copy className="h-4 w-4" /> {t('pricing.copyForDiscord')}
                    </Button>
                  </>
                )}
              </CardContent>
            </Card>
          </div>
        )
      )}

      {tab === 'prices' && (
        <PricesTab
          factionId={factionId}
          canManage={canManage}
          prices={prices}
          breaks={breaks}
          onChanged={invalidate}
        />
      )}

      {tab === 'partners' && (
        <PartnersTab
          factionId={factionId}
          canManage={canManage}
          parties={parties}
          onChanged={invalidate}
        />
      )}
    </div>
  );
}

function Row({ label, value, className }: { label: string; value: string; className?: string }) {
  return (
    <div className={cn('flex justify-between gap-3', className)}>
      <span className="text-zinc-400">{label}</span>
      <span className="tabular-nums">{value}</span>
    </div>
  );
}

/**
 * The quote as a block of text to paste into Discord.
 *
 * Plain text, not a code block: Discord renders a code block in a monospace
 * font nobody reads on a phone, and the buyer is usually on a phone.
 */
function quoteAsText(quote: Quote, totalLabel: string): string {
  const money = (v: string) => formatAmount(v, quote.currency.unit, quote.currency.isCurrency);
  const lines = quote.lines.map((l) => {
    const addons = l.addons.length > 0 ? ` (${l.addons.map((a) => a.name).join(', ')})` : '';
    return `• ${l.quantity} × ${l.itemTypeName}${addons} — ${money(l.total)}`;
  });
  if (quote.counterparty && quote.discountTotal !== '0.00') {
    lines.push(`• ${quote.counterparty.name}: −${money(quote.discountTotal)}`);
  }
  lines.push(`**${totalLabel}: ${money(quote.total)}**`);
  return lines.join('\n');
}

// ── Prices tab ────────────────────────────────────────

function PricesTab({
  factionId, canManage, prices, breaks, onChanged,
}: {
  factionId: string;
  canManage: boolean;
  prices: ProductPrice[];
  breaks: QuantityBreak[];
  onChanged: () => void;
}) {
  const { t } = useTranslation();
  const { toast } = useToast();

  const [editing, setEditing] = useState<ProductPrice | 'new' | null>(null);
  const [deleting, setDeleting] = useState<ProductPrice | null>(null);
  const [addonFor, setAddonFor] = useState<ProductPrice | null>(null);

  const itemTypesQuery = useQuery({
    queryKey: ['item-types', factionId],
    queryFn: () => itemTypesApi.list(factionId),
    enabled: canManage,
  });
  const itemTypes = itemTypesQuery.data ?? [];

  const remove = useMutation({
    mutationFn: (id: string) => pricingApi.removePrice(factionId, id),
    onSuccess: () => { setDeleting(null); onChanged(); },
    onError: (e) => toast({ title: apiErrorMessage(e), variant: 'destructive' }),
  });

  if (prices.length === 0) {
    return (
      <div className="space-y-4">
        {canManage && (
          <Button onClick={() => setEditing('new')}>
            <Plus className="h-4 w-4" /> {t('pricing.newPrice')}
          </Button>
        )}
        <EmptyState
          icon={Tags}
          title={t('pricing.noPrices')}
          hint={canManage ? t('pricing.noPricesHint') : t('pricing.noPricesHintMember')}
        />
        {editing && (
          <PriceDialog
            factionId={factionId}
            price={editing === 'new' ? null : editing}
            itemTypes={itemTypes}
            taken={prices.map((p) => p.itemTypeId)}
            onClose={() => setEditing(null)}
            onSaved={() => { setEditing(null); onChanged(); }}
          />
        )}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {canManage && (
        <Button onClick={() => setEditing('new')}>
          <Plus className="h-4 w-4" /> {t('pricing.newPrice')}
        </Button>
      )}

      <div className="space-y-2">
        {prices.map((price) => (
          <Card key={price.id} className={cn(!price.isActive && 'opacity-60')}>
            <CardContent className="p-4 flex flex-wrap items-start justify-between gap-4">
              <div className="min-w-0 space-y-1.5">
                <div className="flex items-center gap-2 flex-wrap">
                  {price.icon && <span>{price.icon}</span>}
                  <span className="font-medium">{price.itemTypeName}</span>
                  <span className="tabular-nums text-zinc-300">{price.unitPrice}</span>
                  {price.floorPrice && (
                    <Badge variant="outline" className="text-micro">
                      {t('pricing.floorShort', { amount: price.floorPrice })}
                    </Badge>
                  )}
                  {!price.isActive && (
                    <Badge variant="outline" className="text-micro">{t('pricing.retired')}</Badge>
                  )}
                </div>
                {price.addons.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {price.addons.map((a) => (
                      <Badge key={a.id} variant="secondary" className="text-micro">
                        {a.name} +{a.price}
                      </Badge>
                    ))}
                  </div>
                )}
                {price.note && <p className="text-meta text-zinc-500">{price.note}</p>}
              </div>
              {canManage && (
                <div className="flex gap-2 shrink-0">
                  <Button variant="outline" size="sm" onClick={() => setAddonFor(price)}>
                    <Plus className="h-3.5 w-3.5" /> {t('pricing.addons')}
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => setEditing(price)}>
                    <Pencil className="h-3.5 w-3.5" />
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => setDeleting(price)}>
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>
        ))}
      </div>

      <BreaksSection
        factionId={factionId}
        canManage={canManage}
        breaks={breaks}
        prices={prices}
        onChanged={onChanged}
      />

      {editing && (
        <PriceDialog
          factionId={factionId}
          price={editing === 'new' ? null : editing}
          itemTypes={itemTypes}
          taken={prices.map((p) => p.itemTypeId)}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); onChanged(); }}
        />
      )}

      {addonFor && (
        <AddonsDialog
          factionId={factionId}
          price={addonFor}
          onClose={() => setAddonFor(null)}
          onChanged={onChanged}
        />
      )}

      <AlertDialog open={!!deleting} onOpenChange={(open) => !open && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t('pricing.deletePriceConfirm', { name: deleting?.itemTypeName ?? '' })}
            </AlertDialogTitle>
            <AlertDialogDescription>{t('pricing.deletePriceBody')}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deleting && remove.mutate(deleting.id)}
              disabled={remove.isPending}
            >
              {t('common.delete')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function PriceDialog({
  factionId, price, itemTypes, taken, onClose, onSaved,
}: {
  factionId: string;
  price: ProductPrice | null;
  itemTypes: { id: string; name: string; unit: string; isCurrency: boolean; icon?: string | null }[];
  taken: string[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const { t } = useTranslation();
  const { toast } = useToast();

  const [itemTypeId, setItemTypeId] = useState(price?.itemTypeId ?? '');
  const [unitPrice, setUnitPrice] = useState(price?.unitPrice ?? '');
  const [currencyId, setCurrencyId] = useState(price?.currencyItemTypeId ?? '');
  const [floorPrice, setFloorPrice] = useState(price?.floorPrice ?? '');
  const [note, setNote] = useState(price?.note ?? '');
  const [isActive, setIsActive] = useState(price?.isActive ?? true);

  const currencies = itemTypes.filter((i) => i.isCurrency);

  // A faction with exactly one currency should not have to pick it.
  useEffect(() => {
    if (!currencyId && currencies.length === 1) setCurrencyId(currencies[0]!.id);
  }, [currencyId, currencies]);

  const save = useMutation({
    mutationFn: () => {
      const body = {
        unitPrice,
        currencyItemTypeId: currencyId,
        floorPrice: floorPrice.trim() === '' ? null : floorPrice.trim(),
        note: note.trim() === '' ? null : note.trim(),
        isActive,
      };
      return price
        ? pricingApi.updatePrice(factionId, price.id, body)
        : pricingApi.createPrice(factionId, { ...body, itemTypeId });
    },
    onSuccess: onSaved,
    onError: (e) => toast({ title: apiErrorMessage(e), variant: 'destructive' }),
  });

  const valid = (price || itemTypeId) && unitPrice.trim() !== '' && currencyId;

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{price ? t('pricing.editPrice') : t('pricing.newPrice')}</DialogTitle>
          <DialogDescription>{t('pricing.priceDialogHint')}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {!price && (
            <div className="space-y-1.5">
              <Label>{t('pricing.item')}</Label>
              <SearchableSelect
                value={itemTypeId}
                onValueChange={setItemTypeId}
                options={itemTypes
                  .filter((i) => !i.isCurrency && !taken.includes(i.id))
                  .map((i) => ({ value: i.id, label: i.name, hint: i.unit }))}
              />
            </div>
          )}

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>{t('pricing.unitPrice')}</Label>
              <Input inputMode="decimal" value={unitPrice} onChange={(e) => setUnitPrice(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>{t('pricing.currency')}</Label>
              <SearchableSelect
                value={currencyId}
                onValueChange={setCurrencyId}
                options={currencies.map((c) => ({ value: c.id, label: c.name, hint: c.unit }))}
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>{t('pricing.floor')}</Label>
            <Input
              inputMode="decimal"
              value={floorPrice}
              placeholder={t('pricing.floorPlaceholder')}
              onChange={(e) => setFloorPrice(e.target.value)}
            />
            <p className="text-meta text-zinc-500">{t('pricing.floorHint')}</p>
          </div>

          <div className="space-y-1.5">
            <Label>{t('pricing.note')}</Label>
            <Input value={note} onChange={(e) => setNote(e.target.value)} />
          </div>

          {price && (
            <label className="flex items-center gap-2 text-sm text-zinc-300">
              <input
                type="checkbox"
                checked={!isActive}
                onChange={(e) => setIsActive(!e.target.checked)}
              />
              {t('pricing.retire')}
            </label>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>{t('common.cancel')}</Button>
          <Button disabled={!valid || save.isPending} onClick={() => save.mutate()}>
            {t('common.save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function AddonsDialog({
  factionId, price, onClose, onChanged,
}: {
  factionId: string;
  price: ProductPrice;
  onClose: () => void;
  onChanged: () => void;
}) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const [name, setName] = useState('');
  const [amount, setAmount] = useState('');

  const add = useMutation({
    mutationFn: () => pricingApi.createAddon(factionId, price.id, { name: name.trim(), price: amount }),
    onSuccess: () => { setName(''); setAmount(''); onChanged(); },
    onError: (e) => toast({ title: apiErrorMessage(e), variant: 'destructive' }),
  });

  const remove = useMutation({
    mutationFn: (id: string) => pricingApi.removeAddon(factionId, id),
    onSuccess: onChanged,
    onError: (e) => toast({ title: apiErrorMessage(e), variant: 'destructive' }),
  });

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('pricing.addonsFor', { name: price.itemTypeName })}</DialogTitle>
          <DialogDescription>{t('pricing.addonsHint')}</DialogDescription>
        </DialogHeader>

        <div className="space-y-2">
          {price.addons.length === 0 && (
            <p className="text-meta text-zinc-500">{t('pricing.noAddons')}</p>
          )}
          {price.addons.map((addon) => (
            <div key={addon.id} className="flex items-center justify-between gap-3 text-sm">
              <span>{addon.name}</span>
              <div className="flex items-center gap-2">
                <span className="tabular-nums text-zinc-400">+{addon.price}</span>
                <Button
                  variant="outline"
                  size="sm"
                  aria-label={t('common.delete')}
                  onClick={() => remove.mutate(addon.id)}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
          ))}
        </div>

        <div className="flex flex-wrap items-end gap-2 border-t border-[var(--line-2)] pt-4">
          <div className="flex-1 min-w-[140px] space-y-1.5">
            <Label>{t('pricing.addonName')}</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="w-32 space-y-1.5">
            <Label>{t('pricing.addonPrice')}</Label>
            <Input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
          </div>
          <Button
            disabled={!name.trim() || !amount.trim() || add.isPending}
            onClick={() => add.mutate()}
          >
            <Plus className="h-4 w-4" /> {t('pricing.add')}
          </Button>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>{t('common.close')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function BreaksSection({
  factionId, canManage, breaks, prices, onChanged,
}: {
  factionId: string;
  canManage: boolean;
  breaks: QuantityBreak[];
  prices: ProductPrice[];
  onChanged: () => void;
}) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const [itemTypeId, setItemTypeId] = useState('');
  const [minQuantity, setMinQuantity] = useState('');
  const [percent, setPercent] = useState('');

  const nameOf = (id: string | null) =>
    id === null
      ? t('pricing.allItems')
      : prices.find((p) => p.itemTypeId === id)?.itemTypeName ?? id;

  const add = useMutation({
    mutationFn: () => pricingApi.createBreak(factionId, {
      itemTypeId: itemTypeId || null,
      minQuantity,
      discountPercent: percent,
    }),
    onSuccess: () => { setMinQuantity(''); setPercent(''); onChanged(); },
    onError: (e) => toast({ title: apiErrorMessage(e), variant: 'destructive' }),
  });

  const remove = useMutation({
    mutationFn: (id: string) => pricingApi.removeBreak(factionId, id),
    onSuccess: onChanged,
    onError: (e) => toast({ title: apiErrorMessage(e), variant: 'destructive' }),
  });

  return (
    <div className="space-y-3">
      <div>
        <h2 className="text-sm font-medium text-zinc-200">{t('pricing.breaks')}</h2>
        <p className="text-meta text-zinc-500">{t('pricing.breaksHint')}</p>
      </div>

      {breaks.length === 0 ? (
        <p className="text-meta text-zinc-500">{t('pricing.noBreaks')}</p>
      ) : (
        <div className="space-y-1.5">
          {breaks.map((rung) => (
            <div
              key={rung.id}
              className="flex items-center justify-between gap-3 text-sm rounded-md border border-[var(--line-2)] px-3 py-2"
            >
              <span className="text-zinc-300">
                {t('pricing.rung', {
                  quantity: rung.minQuantity,
                  item: nameOf(rung.itemTypeId),
                  percent: rung.discountPercent,
                })}
              </span>
              {canManage && (
                <Button
                  variant="outline"
                  size="sm"
                  aria-label={t('common.delete')}
                  onClick={() => remove.mutate(rung.id)}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              )}
            </div>
          ))}
        </div>
      )}

      {canManage && (
        <div className="flex flex-wrap items-end gap-2">
          <div className="w-52 space-y-1.5">
            <Label>{t('pricing.appliesTo')}</Label>
            <SearchableSelect
              value={itemTypeId}
              onValueChange={setItemTypeId}
              options={[
                { value: '', label: t('pricing.allItems') },
                ...prices.map((p) => ({ value: p.itemTypeId, label: p.itemTypeName })),
              ]}
            />
          </div>
          <div className="w-28 space-y-1.5">
            <Label>{t('pricing.fromQuantity')}</Label>
            <Input inputMode="decimal" value={minQuantity} onChange={(e) => setMinQuantity(e.target.value)} />
          </div>
          <div className="w-28 space-y-1.5">
            <Label>{t('pricing.percentOff')}</Label>
            <Input inputMode="decimal" value={percent} onChange={(e) => setPercent(e.target.value)} />
          </div>
          <Button
            disabled={!minQuantity.trim() || !percent.trim() || add.isPending}
            onClick={() => add.mutate()}
          >
            <Plus className="h-4 w-4" /> {t('pricing.add')}
          </Button>
        </div>
      )}
    </div>
  );
}

// ── Partners tab ──────────────────────────────────────

function PartnersTab({
  factionId, canManage, parties, onChanged,
}: {
  factionId: string;
  canManage: boolean;
  parties: Counterparty[];
  onChanged: () => void;
}) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const [editing, setEditing] = useState<Counterparty | 'new' | null>(null);
  const [deleting, setDeleting] = useState<Counterparty | null>(null);

  const remove = useMutation({
    mutationFn: (id: string) => pricingApi.removeParty(factionId, id),
    onSuccess: () => { setDeleting(null); onChanged(); },
    onError: (e) => toast({ title: apiErrorMessage(e), variant: 'destructive' }),
  });

  return (
    <div className="space-y-4">
      {canManage && (
        <Button onClick={() => setEditing('new')}>
          <Plus className="h-4 w-4" /> {t('pricing.newPartner')}
        </Button>
      )}

      {parties.length === 0 ? (
        <EmptyState
          icon={Handshake}
          title={t('pricing.noPartners')}
          hint={t('pricing.noPartnersHint')}
        />
      ) : (
        <div className="space-y-2">
          {parties.map((party) => (
            <Card key={party.id} className={cn(!party.isActive && 'opacity-60')}>
              <CardContent className="p-4 flex flex-wrap items-center justify-between gap-4">
                <div className="min-w-0 space-y-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    {party.icon && <span>{party.icon}</span>}
                    <span className="font-medium">{party.name}</span>
                    <Badge variant="secondary" className="text-micro tabular-nums">
                      −{party.discountPercent}%
                    </Badge>
                    {!party.isActive && (
                      <Badge variant="outline" className="text-micro">{t('pricing.inactive')}</Badge>
                    )}
                  </div>
                  {party.note && <p className="text-meta text-zinc-500">{party.note}</p>}
                </div>
                {canManage && (
                  <div className="flex gap-2 shrink-0">
                    <Button variant="outline" size="sm" onClick={() => setEditing(party)}>
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                    <Button variant="outline" size="sm" onClick={() => setDeleting(party)}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {editing && (
        <PartnerDialog
          factionId={factionId}
          party={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); onChanged(); }}
        />
      )}

      <AlertDialog open={!!deleting} onOpenChange={(open) => !open && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t('pricing.deletePartnerConfirm', { name: deleting?.name ?? '' })}
            </AlertDialogTitle>
            <AlertDialogDescription>{t('pricing.deletePartnerBody')}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deleting && remove.mutate(deleting.id)}
              disabled={remove.isPending}
            >
              {t('common.delete')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function PartnerDialog({
  factionId, party, onClose, onSaved,
}: {
  factionId: string;
  party: Counterparty | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const [name, setName] = useState(party?.name ?? '');
  const [percent, setPercent] = useState(party?.discountPercent ?? '0');
  const [note, setNote] = useState(party?.note ?? '');
  const [isActive, setIsActive] = useState(party?.isActive ?? true);

  const save = useMutation({
    mutationFn: () => {
      const body = {
        name: name.trim(),
        discountPercent: percent.trim() === '' ? '0' : percent.trim(),
        note: note.trim() === '' ? null : note.trim(),
        isActive,
      };
      return party
        ? pricingApi.updateParty(factionId, party.id, body)
        : pricingApi.createParty(factionId, body);
    },
    onSuccess: onSaved,
    onError: (e) => toast({ title: apiErrorMessage(e), variant: 'destructive' }),
  });

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{party ? t('pricing.editPartner') : t('pricing.newPartner')}</DialogTitle>
          <DialogDescription>{t('pricing.partnerDialogHint')}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label>{t('pricing.partnerName')}</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>{t('pricing.percentOff')}</Label>
            <Input inputMode="decimal" value={percent} onChange={(e) => setPercent(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>{t('pricing.note')}</Label>
            <Input value={note} onChange={(e) => setNote(e.target.value)} />
          </div>
          {party && (
            <label className="flex items-center gap-2 text-sm text-zinc-300">
              <input
                type="checkbox"
                checked={!isActive}
                onChange={(e) => setIsActive(!e.target.checked)}
              />
              {t('pricing.deactivate')}
            </label>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>{t('common.cancel')}</Button>
          <Button disabled={!name.trim() || save.isPending} onClick={() => save.mutate()}>
            {t('common.save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
