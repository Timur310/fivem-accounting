'use client';

import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { formatDateTime, formatDate, displayName } from '@/lib/format';
import { useTranslation } from '@/providers/i18n-provider';
import type { TranslationKey } from '@/lib/i18n';
import type { Strike, StrikeEffectiveStatus } from '@/lib/api-types';

const SEVERITY_COLORS: Record<string, string> = {
  warning: 'border-amber-500/30 bg-amber-500/10 text-amber-400',
  minor: 'border-orange-500/30 bg-orange-500/10 text-orange-400',
  major: 'border-red-500/30 bg-red-500/10 text-red-400',
};

const SEVERITY_KEYS: Record<string, TranslationKey> = {
  warning: 'strikes.severity.warning',
  minor: 'strikes.severity.minor',
  major: 'strikes.severity.major',
};

const STATUS_COLORS: Record<StrikeEffectiveStatus, string> = {
  active: 'text-amber-400',
  appealed: 'text-blue-400',
  revoked: 'text-zinc-500',
  expired: 'text-zinc-600',
};

const STATUS_KEYS: Record<string, TranslationKey> = {
  active: 'strikes.status.active',
  appealed: 'strikes.status.appealed',
  revoked: 'strikes.status.revoked',
  expired: 'strikes.status.expired',
};

/**
 * One strike, with the reason in full.
 *
 * The lists show the reason clipped — to one line in the table, two on the
 * profile, and on a phone the table dropped it altogether. That is fine for
 * scanning and useless for the person it was written about: the reason *is*
 * the strike, and somebody who has been given one was reading the first
 * twenty words of why. Anything longer had nowhere to be read in full.
 *
 * So both lists open this, and it is the one place the whole text lives,
 * wrapped as it was typed rather than squeezed into a column.
 */
export function StrikeDetailDialog({
  strike,
  onClose,
}: {
  strike: Strike | null;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  if (!strike) return null;

  const issuer = displayName({
    username: strike.issuerUsername,
    inGameName: strike.issuerInGameName,
  });

  return (
    <Dialog open={!!strike} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{t('strikes.detailTitle')}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <Badge className={`text-micro border ${SEVERITY_COLORS[strike.severity] ?? ''}`} variant="outline">
              {SEVERITY_KEYS[strike.severity] ? t(SEVERITY_KEYS[strike.severity]) : strike.severity}
            </Badge>
            <span className={`text-xs font-medium ${STATUS_COLORS[strike.effectiveStatus] ?? 'text-zinc-400'}`}>
              {STATUS_KEYS[strike.effectiveStatus]
                ? t(STATUS_KEYS[strike.effectiveStatus])
                : strike.effectiveStatus}
            </span>
            {strike.expiresAt && strike.effectiveStatus === 'active' && (
              <span className="text-micro text-zinc-600">
                {t('strikes.expiresOn', { date: formatDate(strike.expiresAt) })}
              </span>
            )}
          </div>

          {/* The whole point of the dialog. Wrapped as typed, scrollable when
              somebody writes an essay, and never clipped. */}
          <div>
            <p className="text-xs uppercase tracking-wide text-zinc-500">{t('strikes.reason')}</p>
            <p className="mt-1 max-h-[45vh] overflow-y-auto whitespace-pre-wrap break-words text-sm leading-relaxed text-zinc-200">
              {strike.reason}
            </p>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-[var(--line-1)] pt-3">
            <div className="flex items-center gap-2">
              <Avatar className="h-6 w-6">
                <AvatarImage src={strike.issuerAvatarUrl ?? undefined} alt="" />
                <AvatarFallback className="text-[8px]">{issuer.slice(0, 2).toUpperCase()}</AvatarFallback>
              </Avatar>
              <span className="text-xs text-zinc-400">
                {t('strikes.issuedBy').replace('{name}', issuer)}
              </span>
            </div>
            <span className="text-xs tabular-nums text-zinc-600">{formatDateTime(strike.createdAt)}</span>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
