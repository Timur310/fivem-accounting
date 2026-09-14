'use client';

import { Crown, Star, ChevronUp } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import type { FactionRank } from '@/lib/api-types';

/**
 * A member's rank, with insignia.
 *
 * The roster already drew a crown for the top rank and a star for the second,
 * and nothing at all below that — so in a faction with six ranks, four of them
 * rendered as plain text and the hierarchy stopped being visible exactly where
 * most of the roster sits. Ranks are the most roleplay-flavoured thing in the
 * app; they should look like something.
 *
 * Insignia are derived from position in the hierarchy, not from the name, so a
 * faction that calls its ranks Capo and Soldato gets the same treatment as one
 * using Sergeant and Private. Beyond the top two it is chevrons — three for
 * the next rank down, then two, then one, then none. A pip count that keeps
 * climbing for a twenty-rank faction would be noise.
 */
interface Props {
  rank: string | null;
  /** The faction's hierarchy, lowest `level` first. */
  ranks: FactionRank[];
  className?: string;
  /** Muted styling for dense tables, where the badge is not the subject. */
  subtle?: boolean;
}

/** Chevrons for the ranks below the top two, thinning out as they descend. */
function chevronCount(index: number): number {
  if (index === 2) return 3;
  if (index === 3) return 2;
  if (index === 4) return 1;
  return 0;
}

export function RankBadge({ rank, ranks, className, subtle = false }: Props) {
  if (!rank) return null;

  const index = ranks.findIndex((r) => r.name === rank);

  // A rank the faction has since renamed or deleted still sits on members
  // until somebody reassigns them. It gets the name and no insignia rather
  // than disappearing — the member really does hold it.
  const chevrons = index < 0 ? 0 : chevronCount(index);

  return (
    <Badge
      variant="outline"
      className={cn(
        'text-meta gap-1',
        subtle ? 'text-zinc-400' : 'text-brand',
        className,
      )}
      style={subtle ? undefined : { borderColor: 'var(--brand-color-medium)' }}
      title={rank}
    >
      {index === 0 && <Crown className="h-3 w-3 text-[var(--medal-gold)]" aria-hidden />}
      {index === 1 && <Star className="h-3 w-3 text-[var(--medal-silver)]" aria-hidden />}
      {chevrons > 0 && (
        // Overlapped rather than spaced, so three chevrons read as one insignia
        // instead of three separate icons.
        <span className="flex -space-x-1.5" aria-hidden>
          {Array.from({ length: chevrons }).map((_, i) => (
            <ChevronUp key={i} className="h-3 w-3 opacity-70" />
          ))}
        </span>
      )}
      {rank}
    </Badge>
  );
}
