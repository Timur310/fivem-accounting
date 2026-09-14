'use client';

import { formatAmount } from '@/lib/format';

/**
 * Echoes a raw amount input back, formatted.
 *
 * FiveM money is big, and a bare number input shows it unbroken: `1500000` and
 * `150000` are one keystroke and one glance apart, and the mistake is only
 * visible after the entry is in the ledger. Reading `$1,500,000` under the
 * field as you type is the cheapest possible guard against logging ten times
 * what you meant.
 *
 * Renders nothing until there is a real number to show, so an untouched form
 * stays quiet and the line does not flash in and out while the field is empty.
 */
export function AmountPreview({
  value,
  unit,
  isCurrency,
  className,
}: {
  value: string;
  unit?: string;
  isCurrency?: boolean;
  className?: string;
}) {
  const trimmed = value.trim();
  if (!trimmed) return null;

  const n = Number(trimmed);
  if (!Number.isFinite(n) || n <= 0) return null;

  return (
    <p
      // Polite rather than assertive: it should reach a screen reader after
      // the keystroke settles, not interrupt every character.
      aria-live="polite"
      className={`text-meta tabular-nums text-zinc-500 ${className ?? ''}`}
    >
      {formatAmount(n, unit ?? '', isCurrency)}
    </p>
  );
}
