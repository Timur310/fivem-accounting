'use client';

import type { LucideIcon } from 'lucide-react';
import { AlertCircle, Lock } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { useTranslation } from '@/providers/i18n-provider';

/**
 * The one empty state: soft icon, one line, optional hint. Card-level panels
 * use the tall variant; inline table rows use the compact one.
 */
export function EmptyState({
  icon: Icon,
  title,
  hint,
  compact = false,
}: {
  icon: LucideIcon;
  title: string;
  hint?: string;
  compact?: boolean;
}) {
  if (compact) {
    return (
      <div className="text-center py-8 text-sm text-zinc-600">
        <Icon className="h-6 w-6 mx-auto mb-2 opacity-40" />
        <p>{title}</p>
        {hint && <p className="text-xs mt-1">{hint}</p>}
      </div>
    );
  }
  return (
    <div className="p-12 text-center text-zinc-600">
      <Icon className={cn('h-8 w-8 mx-auto mb-2 opacity-30')} />
      <p className="text-sm">{title}</p>
      {hint && <p className="text-xs mt-1">{hint}</p>}
    </div>
  );
}

/** The one list skeleton: rows that match a table/list rhythm. */
export function ListSkeleton({ rows = 5, height = 'h-12' }: { rows?: number; height?: string }) {
  return (
    <div className="p-6 space-y-3" aria-busy="true">
      {[...Array(rows)].map((_, i) => (
        <div key={i} className={`${height} w-full rounded-md bg-[var(--fill-2)] animate-pulse`} />
      ))}
    </div>
  );
}

/**
 * The one load-failure state, and the counterpart to `EmptyState`.
 *
 * A list whose request failed must never fall through to "nothing here yet".
 * The two say opposite things about the same screen, and a member who reads
 * a dropped connection as an empty ledger concludes their entries are gone.
 *
 * A 403 gets its own wording: that is not a failure to retry, it is a
 * permission the reader does not hold, and offering "Retry" on it only
 * teaches people to keep pressing a button that cannot work.
 */
export function ErrorState({
  error,
  onRetry,
  compact = false,
}: {
  error: unknown;
  onRetry?: () => void;
  compact?: boolean;
}) {
  const { t } = useTranslation();
  const status =
    error && typeof error === 'object' && 'response' in error
      ? (error as { response?: { status?: number } }).response?.status
      : undefined;
  const forbidden = status === 403;

  const Icon = forbidden ? Lock : AlertCircle;
  const title = forbidden ? t('error.forbiddenTitle') : t('error.loadTitle');
  const hint = forbidden ? t('error.forbiddenHint') : t('error.loadHint');

  return (
    <div
      role="alert"
      className={cn('text-center text-zinc-500', compact ? 'py-8 text-sm' : 'p-12')}
    >
      <Icon
        className={cn('mx-auto mb-2 opacity-40', compact ? 'h-6 w-6' : 'h-8 w-8')}
        aria-hidden="true"
      />
      <p className={cn(compact ? '' : 'text-sm', 'text-zinc-400')}>{title}</p>
      <p className="text-xs mt-1">{hint}</p>
      {!forbidden && onRetry && (
        <Button variant="outline" size="sm" className="mt-3 h-7 text-xs" onClick={onRetry}>
          {t('error.retry')}
        </Button>
      )}
    </div>
  );
}
