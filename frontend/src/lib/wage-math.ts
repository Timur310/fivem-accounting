/**
 * The wages screen's arithmetic, the same as the server's (backend
 * lib/commission.ts) so the numbers on screen are the numbers paid.
 *
 * Whole cents as plain numbers rather than BigInt, which this build target
 * does not have: a billion in cents times a percentage in hundredths is still
 * well inside what a double holds exactly. The server repeats the sum in
 * BigInt when paying, and it is the one that counts.
 */

/** "1234.56" as 123456. */
export function cents(amount: string): number {
  const [whole = '0', fraction = ''] = amount.trim().split('.');
  return Number(whole) * 100 + Number((fraction + '00').slice(0, 2));
}

/** 123456 as "1234.56". */
export function fromCents(value: number): string {
  const whole = Math.floor(value / 100);
  const rest = String(value % 100).padStart(2, '0');
  return `${whole}.${rest}`;
}

/** Is this something the server will take as a percentage? */
export function isPercent(value: string): boolean {
  return /^\d{1,3}(\.\d{1,2})?$/.test(value.trim()) && cents(value) <= 10_000;
}

/**
 * A member's share, in cents: money to the nearest cent (half up), counted
 * goods down to a whole one. An invalid percentage is a share of nothing.
 */
export function shareCents(brought: string, percent: string, isCurrency: boolean): number {
  if (!isPercent(percent)) return 0;
  const total = cents(brought);
  const bp = cents(percent);
  if (!isCurrency) return Math.floor((total * bp) / 1_000_000) * 100;
  return Math.floor((total * bp * 2 + 10_000) / 20_000);
}

/** Is this something the server will take as an exchange value (up to 4 decimals, above 0)? */
export function isRate(value: string): boolean {
  return /^\d{1,9}(\.\d{1,4})?$/.test(value.trim()) && rateUnits(value) > 0;
}

/** "0.7" as 7000 ten-thousandths. */
export function rateUnits(rate: string): number {
  const [whole = '0', fraction = ''] = rate.trim().split('.');
  return Number(whole) * 10_000 + Number((fraction + '0000').slice(0, 4));
}

/**
 * A share in cents of the brought item, as cents of the item it is paid in:
 * money to the cent (half up), counted goods down to a whole one. The same as
 * the server's convertShare.
 */
export function convertCents(share: number, rate: string, payIsCurrency: boolean): number {
  if (!isRate(rate)) return 0;
  const r = rateUnits(rate);
  if (!payIsCurrency) return Math.floor((share * r) / 1_000_000) * 100;
  return Math.floor((share * r * 2 + 10_000) / 20_000);
}
