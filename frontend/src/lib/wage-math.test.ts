import { describe, it, expect } from 'vitest';
import { cents, convertCents, fromCents, isPercent, isRate, shareCents } from './wage-math';

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

describe('paying in another item', () => {
  it('takes exchange values the server takes', () => {
    expect(isRate('0.7')).toBe(true);
    expect(isRate('1.2345')).toBe(true);
    expect(isRate('0')).toBe(false);
    expect(isRate('1.23456')).toBe(false);
  });

  // Same cases as the server's tests.
  it('matches the server', () => {
    expect(convertCents(30000, '0.7', true)).toBe(21000);
    expect(convertCents(25000, '0.01', false)).toBe(200);
  });
});
