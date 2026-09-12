'use client';

import { ArrowDown, ArrowUp, ChevronsUpDown } from 'lucide-react';
import { TableHead } from '@/components/ui/table';
import { cn } from '@/lib/utils';

export type SortDir = 'asc' | 'desc';
export type SortState = { sort: string; dir: SortDir };

/**
 * A clickable column header.
 *
 * The sort itself runs on the server — these lists are paginated, and
 * reordering the page in hand would produce "the biggest of page three"
 * dressed up as "the biggest". This component only reports the intent.
 *
 * Clicking the active column flips direction; clicking a different one moves
 * to it in its natural starting direction: newest-first for dates and
 * largest-first for amounts, because that is what someone asking for either
 * almost always wants to see first.
 */
export function SortableHeader({
  field,
  state,
  onChange,
  children,
  align = 'left',
  defaultDir = 'desc',
  className,
}: {
  field: string;
  state: SortState;
  onChange: (next: SortState) => void;
  children: React.ReactNode;
  align?: 'left' | 'right';
  defaultDir?: SortDir;
  className?: string;
}) {
  const active = state.sort === field;
  const Icon = !active ? ChevronsUpDown : state.dir === 'asc' ? ArrowUp : ArrowDown;

  return (
    <TableHead
      className={cn('text-zinc-500 p-0', className)}
      aria-sort={active ? (state.dir === 'asc' ? 'ascending' : 'descending') : 'none'}
    >
      <button
        type="button"
        onClick={() =>
          onChange(
            active
              ? { sort: field, dir: state.dir === 'asc' ? 'desc' : 'asc' }
              : { sort: field, dir: defaultDir },
          )
        }
        className={cn(
          'flex w-full items-center gap-1 px-2 py-2 text-left transition-colors hover:text-zinc-200',
          align === 'right' && 'justify-end',
          active && 'text-zinc-200',
        )}
      >
        {align === 'right' && (
          <Icon className={cn('h-3 w-3 shrink-0', active ? 'opacity-100' : 'opacity-30')} aria-hidden="true" />
        )}
        <span className="truncate">{children}</span>
        {align === 'left' && (
          <Icon className={cn('h-3 w-3 shrink-0', active ? 'opacity-100' : 'opacity-30')} aria-hidden="true" />
        )}
      </button>
    </TableHead>
  );
}
