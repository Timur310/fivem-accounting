'use client';

import type { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

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
        <div key={i} className={`${height} w-full rounded-md bg-white/[0.04] animate-pulse`} />
      ))}
    </div>
  );
}
