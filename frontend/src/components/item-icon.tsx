'use client';

import { Package } from 'lucide-react';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { cn } from '@/lib/utils';

/**
 * The icon for an item type, shown wherever items are listed.
 *
 * Built on Avatar rather than a bare <img> for its fallback behaviour: the
 * image lives on someone else's host, so a dead link has to degrade into the
 * placeholder instead of a broken-image glyph. The placeholder also renders
 * when no image is set, which keeps rows in a mixed list aligned.
 *
 * Decorative on purpose — the item's name is always rendered next to it, so an
 * alt text here would only make a screen reader say it twice.
 *
 * next/image is deliberately not used: these URLs are arbitrary and
 * admin-supplied, so there is no host list to configure up front.
 */
export function ItemIcon({ src, className }: { src?: string | null; className?: string }) {
  return (
    <Avatar className={cn('size-6 shrink-0 rounded-md', className)} aria-hidden="true">
      {src ? <AvatarImage src={src} alt="" className="object-contain" /> : null}
      <AvatarFallback className="rounded-md">
        <Package className="size-3.5 opacity-50" />
      </AvatarFallback>
    </Avatar>
  );
}
