'use client';

import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { factionsApi, apiErrorMessage } from '@/lib/api-client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { useToast } from '@/hooks/use-toast';
import { useTranslation } from '@/providers/i18n-provider';
import { AlertTriangle, Check, RotateCcw, X } from 'lucide-react';

/**
 * Superadmin only: empty a faction's treasury, on the faction's request.
 *
 * Says plainly what goes and what stays, and will not send anything until the
 * faction's name has been typed exactly — the server checks the same name, so
 * a typo or the wrong faction's page cannot empty a treasury. There is no undo
 * and no backup, by choice, and the dialog says that too.
 */
export function TreasuryResetCard({ factionId, factionName }: { factionId: string; factionName: string }) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState('');

  const reset = useMutation({
    mutationFn: () => factionsApi.resetTreasury(factionId, typed.trim()),
    onSuccess: (result) => {
      // Every screen that read the old numbers is wrong now.
      void queryClient.invalidateQueries();
      const r = result.removed;
      toast({
        title: t('admin.reset.done', { name: factionName }),
        description: t('admin.reset.doneDetail', {
          entries: r.entries ?? 0, payouts: r.payouts ?? 0, expenses: r.expenses ?? 0,
          jobs: (r.crafts ?? 0) + (r.sales ?? 0) + (r.operations ?? 0),
        }),
      });
      setOpen(false);
      setTyped('');
    },
    onError: (err) => toast({ title: t('common.failed'), description: apiErrorMessage(err), variant: 'destructive' }),
  });

  const matches = typed.trim() === factionName;
  const goes = ['entries', 'payouts', 'expenses', 'checks', 'jobs', 'storage'] as const;
  const stays = ['itemTypes', 'recipes', 'prices', 'members', 'other'] as const;

  return (
    <Card className="border-red-500/30">
      <CardContent className="flex flex-wrap items-center gap-4 py-5">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-red-500/10 text-red-300">
          <RotateCcw className="h-5 w-5" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-zinc-100">{t('admin.reset.title')}</p>
          <p className="text-xs text-zinc-500">{t('admin.reset.hint')}</p>
        </div>
        <Button variant="outline" className="border-red-500/40 text-red-300 hover:bg-red-500/10" onClick={() => setOpen(true)}>
          {t('admin.reset.button')}
        </Button>
      </CardContent>

      <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) setTyped(''); }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-red-200">
              <AlertTriangle className="h-5 w-5" />{t('admin.reset.confirmTitle', { name: factionName })}
            </DialogTitle>
            <DialogDescription>{t('admin.reset.confirmBody')}</DialogDescription>
          </DialogHeader>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-lg border border-red-500/30 bg-red-500/5 p-3">
              <p className="mb-2 text-[11px] font-medium uppercase tracking-wider text-red-300">{t('admin.reset.goes')}</p>
              <ul className="space-y-1 text-xs text-zinc-300">
                {goes.map((k) => (
                  <li key={k} className="flex gap-1.5"><X className="mt-0.5 h-3 w-3 shrink-0 text-red-400" />{t(`admin.reset.goes.${k}` as never)}</li>
                ))}
              </ul>
            </div>
            <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-3">
              <p className="mb-2 text-[11px] font-medium uppercase tracking-wider text-emerald-300">{t('admin.reset.stays')}</p>
              <ul className="space-y-1 text-xs text-zinc-300">
                {stays.map((k) => (
                  <li key={k} className="flex gap-1.5"><Check className="mt-0.5 h-3 w-3 shrink-0 text-emerald-400" />{t(`admin.reset.stays.${k}` as never)}</li>
                ))}
              </ul>
            </div>
          </div>

          <div className="space-y-1.5">
            <p className="text-xs text-zinc-400">{t('admin.reset.typeName', { name: factionName })}</p>
            <Input value={typed} onChange={(e) => setTyped(e.target.value)} placeholder={factionName} autoComplete="off" aria-label={t('admin.reset.typeName', { name: factionName })} />
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>{t('common.cancel')}</Button>
            <Button className="bg-red-600 text-white hover:bg-red-500" disabled={!matches || reset.isPending} onClick={() => reset.mutate()}>
              {t('admin.reset.confirm')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
