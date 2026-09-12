'use client';

import { Package } from 'lucide-react';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { cn } from '@/lib/utils';
import { CATEGORY_TILE } from '@/lib/item-category';
import type { ItemCategory } from '@/lib/api-types';

/**
 * The icon for an item type, shown wherever items are listed.
 *
 * Three ways to render, in order: an admin-supplied image, an emoji, or the
 * package placeholder. The image wins when both are set — a faction that went
 * to the trouble of hosting artwork should not have it hidden by an emoji
 * picked earlier.
 *
 * Built on Avatar rather than a bare <img> for its fallback behaviour: the
 * image lives on someone else's host, so a dead link has to degrade into the
 * placeholder instead of a broken-image glyph. The placeholder also renders
 * when nothing is set, which keeps rows in a mixed list aligned.
 *
 * `category` only tints the tile behind the glyph. It never colours a number —
 * see the note in lib/item-category.ts.
 *
 * Decorative on purpose — the item's name is always rendered next to it, so an
 * alt text here would only make a screen reader say it twice.
 *
 * next/image is deliberately not used: these URLs are arbitrary and
 * admin-supplied, so there is no host list to configure up front.
 */
export function ItemIcon({
  src,
  icon,
  category = 'other',
  className,
}: {
  src?: string | null;
  icon?: string | null;
  category?: ItemCategory | null;
  className?: string;
}) {
  const tile = CATEGORY_TILE[(category ?? 'other') as ItemCategory] ?? CATEGORY_TILE.other;

  return (
    <Avatar className={cn('size-6 shrink-0 rounded-md', className)} aria-hidden="true">
      {src ? <AvatarImage src={src} alt="" className="object-contain" /> : null}
      <AvatarFallback className={cn('rounded-md', tile)}>
        {icon ? (
          // leading-none keeps the glyph centred in the tile: emoji carry their
          // own line box and drift downward at default line height.
          <span className="text-[0.8em] leading-none">{icon}</span>
        ) : (
          <Package className="size-3.5 opacity-50" />
        )}
      </AvatarFallback>
    </Avatar>
  );
}
