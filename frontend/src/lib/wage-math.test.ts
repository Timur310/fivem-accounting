import { describe, it, expect } from 'vitest';
import { cents, fromCents, isPercent, shareCents } from './wage-math';

describe('wage arithmetic', () => {
  it('reads and writes cents exactly', () => {
    expect(cents('1234.5')).toBe(123450);
    expect(fromCents(123405)).toBe('1234.05');
  });

  it('takes percentages the server takes', () => {
    expect(isPercent('30')).toBe(true);
    expect(isPercent('12.5')).toBe(true);
    expect(isPercent('100')).toBe(true);
    expect(isPercent('100.01')).toBe(false);
    expect(isPercent('-5')).toBe(false);
    expect(isPercent('')).toBe(false);
  });

  // Same cases as the server's tests, so the screen and the payout agree.
  it('matches the server', () => {
    expect(shareCents('1000.00', '30', true)).toBe(30000);
    expect(shareCents('0.05', '10', true)).toBe(1);
    expect(shareCents('7', '50', false)).toBe(300);
    expect(shareCents('1000', 'abc', true)).toBe(0);
  });
});
