/**
 * Amount formatting.
 *
 * Item types carry two hints: a `unit` string and an `isCurrency` flag. Money
 * reads as a prefixed symbol with two decimals ("$1,000.00"); countable goods
 * read as a whole number followed by the unit ("30 pcs"). Without the flag
 * everything was formatted as money, which produced "pcs30.00" for ammunition.
 */

/** Format a number as an amount of the given item type. */
export function formatAmount(
  value: number | string,
  unit: string,
  isCurrency: boolean | undefined,
): string {
  const n = typeof value === 'string' ? Number(value) : value;
  if (!Number.isFinite(n)) return '—';

  if (isCurrency) {
    return `${unit}${n.toLocaleString('en-US', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })}`;
  }

  // Counts are whole things. Keep decimals only when the value actually has
  // them, so "2.5 kg" survives while "30 pcs" does not become "30.00 pcs".
  const hasFraction = Math.abs(n % 1) > 1e-9;
  const formatted = n.toLocaleString('en-US', {
    minimumFractionDigits: 0,
    maximumFractionDigits: hasFraction ? 2 : 0,
  });
  return unit ? `${formatted} ${unit}` : formatted;
}

/**
 * Format a signed amount, always showing the sign.
 * Used where inflow and outflow sit side by side.
 */
export function formatSignedAmount(
  value: number,
  unit: string,
  isCurrency: boolean | undefined,
): string {
  const sign = value < 0 ? '-' : '+';
  return `${sign}${formatAmount(Math.abs(value), unit, isCurrency)}`;
}
