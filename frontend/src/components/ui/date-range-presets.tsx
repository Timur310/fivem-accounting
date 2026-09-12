'use client';

import { Button } from '@/components/ui/button';
import { useTranslation } from '@/providers/i18n-provider';
import { todayLocalDateString } from '@/lib/format';

export type DatePreset = 'today' | 'week' | 'month';

/**
 * Resolve a preset to a `from`/`to` pair in **local** calendar time.
 *
 * Local, never UTC — the same rule as every other date in the interface
 * (§9.3). "Today" computed in UTC is yesterday for a Hungarian player at one
 * in the morning, which is exactly when a roleplay session ends.
 */
export function resolvePreset(preset: DatePreset): { from: string; to: string } {
  const now = new Date();
  const today = todayLocalDateString(now);

  if (preset === 'today') return { from: today, to: today };

  if (preset === 'week') {
    // Weeks start Monday, matching how quota periods are defined.
    const day = now.getDay();
    const monday = new Date(now);
    monday.setDate(now.getDate() - (day === 0 ? 6 : day - 1));
    return { from: todayLocalDateString(monday), to: today };
  }

  return { from: todayLocalDateString(new Date(now.getFullYear(), now.getMonth(), 1)), to: today };
}

/**
 * Today / this week / this month, as three buttons.
 *
 * Typing two dates into two pickers to answer "what did we take in today" is
 * the kind of friction that stops people asking. Clicking the active preset
 * again clears it, so the pair is a toggle rather than a trap.
 */
export function DateRangePresets({
  active,
  onApply,
  onClear,
  className,
}: {
  active: DatePreset | null;
  onApply: (preset: DatePreset, range: { from: string; to: string }) => void;
  onClear: () => void;
  className?: string;
}) {
  const { t } = useTranslation();

  const presets: { value: DatePreset; label: string }[] = [
    { value: 'today', label: t('entries.today') },
    { value: 'week', label: t('entries.thisWeek') },
    { value: 'month', label: t('entries.thisMonth') },
  ];

  return (
    <div className={`flex flex-wrap items-center gap-1.5 ${className ?? ''}`}>
      {presets.map((p) => (
        <Button
          key={p.value}
          variant="outline"
          size="sm"
          aria-pressed={active === p.value}
          className={`h-7 px-2.5 text-xs ${
            active === p.value ? 'border-primary text-primary bg-primary/10' : 'text-zinc-400'
          }`}
          onClick={() => (active === p.value ? onClear() : onApply(p.value, resolvePreset(p.value)))}
        >
          {p.label}
        </Button>
      ))}
    </div>
  );
}
