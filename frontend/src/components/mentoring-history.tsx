'use client';

import { useQuery } from '@tanstack/react-query';
import { mentoringApi } from '@/lib/api-client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { useTranslation } from '@/providers/i18n-provider';
import { useAppStore } from '@/lib/store';
import { formatDate } from '@/lib/format';
import { GraduationCap } from 'lucide-react';
import { OutcomeBadge } from '@/views/mentoring-view';

/**
 * A member's mentorships, on their profile — leadership only, like the
 * mentor's notes themselves. Opens the mentoring page for the details.
 */
export function MentoringHistory({ factionId, userId }: { factionId: string; userId: string }) {
  const { t } = useTranslation();
  const setCurrentView = useAppStore((s) => s.setCurrentView);
  const history = useQuery({
    queryKey: ['mentoring-history', factionId, userId],
    queryFn: () => mentoringApi.history(factionId, userId),
  });
  const rows = history.data?.mentorships ?? [];

  if (!history.isLoading && rows.length === 0) return null;

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-1.5 text-xs font-normal uppercase tracking-wider text-zinc-500">
          <GraduationCap className="h-3.5 w-3.5" />
          {t('mentoring.history')}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {history.isLoading ? (
          <Skeleton className="h-12 w-full" />
        ) : rows.map((m) => (
          <button
            key={m.id}
            type="button"
            onClick={() => setCurrentView('mentoring')}
            className="flex w-full items-center justify-between gap-3 rounded-md border border-zinc-800 px-3 py-2 text-left hover:border-zinc-700"
          >
            <span className="min-w-0 text-sm text-zinc-300">
              {t('mentoring.mentoredBy', { name: m.mentorName })}
              <span className="block text-[11px] text-zinc-500">
                {formatDate(m.startedAt)}{m.endedAt ? ` – ${formatDate(m.endedAt)}` : ''}
                {m.points > 0 && ` · ${t('mentoring.pointsShort', { count: m.points })}`}
              </span>
            </span>
            <OutcomeBadge status={m.status} />
          </button>
        ))}
      </CardContent>
    </Card>
  );
}
