'use client';

import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { useTranslation } from '@/providers/i18n-provider';
import { ICON_CHOICES, CATEGORY_TILE, CATEGORY_LABELS } from '@/lib/item-category';
import { ITEM_CATEGORIES, type ItemCategory } from '@/lib/api-types';
import { cn } from '@/lib/utils';

/**
 * Pick an emoji and a category for an item type.
 *
 * A curated palette rather than a full emoji-picker dependency: this is a
 * ledger for a crime roleplay server, and the glyphs its factions actually
 * need fit on one panel. Anything outside the set can still be pasted into the
 * image URL field's sibling by hand — the set is a shortcut, not a
 * restriction.
 */
export function IconCategoryPicker({
  icon,
  onIconChange,
  category,
  onCategoryChange,
}: {
  icon: string;
  onIconChange: (icon: string) => void;
  category: ItemCategory;
  onCategoryChange: (category: ItemCategory) => void;
}) {
  const { t } = useTranslation();

  return (
    <div className="space-y-3">
      <div className="space-y-1.5">
        <Label className="text-xs text-zinc-500">{t('itemTypes.category')}</Label>
        <div className="flex flex-wrap gap-1.5">
          {ITEM_CATEGORIES.map((c) => (
            <button
              key={c}
              type="button"
              aria-pressed={category === c}
              onClick={() => onCategoryChange(c)}
              className={cn(
                'h-7 rounded-md border px-2.5 text-xs transition-colors',
                category === c
                  ? `border-transparent ${CATEGORY_TILE[c]}`
                  : 'border-[var(--line-2)] text-zinc-400 hover:text-zinc-200',
              )}
            >
              {t(CATEGORY_LABELS[c])}
            </button>
          ))}
        </div>
      </div>

      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <Label className="text-xs text-zinc-500">{t('itemTypes.icon')}</Label>
          {icon && (
            <Button
              variant="ghost"
              size="sm"
              className="h-6 px-1.5 text-meta text-zinc-500 hover:text-zinc-200"
              onClick={() => onIconChange('')}
            >
              {t('itemTypes.iconNone')}
            </Button>
          )}
        </div>
        <div className="space-y-2 rounded-md border border-[var(--line-1)] p-2">
          {ICON_CHOICES.map((group) => (
            <div key={group.group}>
              <p className="mb-1 text-micro uppercase tracking-wider text-zinc-600">{t(group.group)}</p>
              <div className="flex flex-wrap gap-1">
                {group.icons.map((glyph) => (
                  <button
                    key={glyph}
                    type="button"
                    aria-pressed={icon === glyph}
                    aria-label={glyph}
                    onClick={() => onIconChange(icon === glyph ? '' : glyph)}
                    className={cn(
                      'flex h-8 w-8 items-center justify-center rounded-md border text-base leading-none transition-colors',
                      icon === glyph
                        ? 'border-primary bg-primary/10'
                        : 'border-transparent hover:bg-[var(--fill-2)]',
                    )}
                  >
                    {glyph}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
        <p className="text-meta text-zinc-600">{t('itemTypes.iconHint')}</p>
      </div>
    </div>
  );
}
