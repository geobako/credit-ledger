import { describe, expect, it } from 'vitest';
import { formatMoney, parseAmount, ratio, toDecimalString } from './money';

describe('money', () => {
  it('formats minor units exactly', () => {
    expect(formatMoney({ amount: '123456', currency: 'USD' })).toBe('$1,234.56');
    expect(formatMoney('5')).toBe('$0.05');
    expect(formatMoney('-250')).toBe('-$2.50');
  });

  it('keeps precision beyond the float range', () => {
    expect(toDecimalString('900719925474099301')).toBe('9007199254740993.01');
  });

  it('parses user input without floats', () => {
    expect(parseAmount('12')).toBe(1200n);
    expect(parseAmount('12.5')).toBe(1250n);
    expect(parseAmount('$1,250.07')).toBe(125007n);
    expect(parseAmount('0.1')).toBe(10n);
    expect(parseAmount('1.234')).toBeNull();
    expect(parseAmount('-3')).toBeNull();
    expect(parseAmount('abc')).toBeNull();
  });

  it('computes display ratios safely', () => {
    expect(ratio(25n, 100n)).toBe(0.25);
    expect(ratio(5n, 0n)).toBe(0);
    expect(ratio(500n, 100n)).toBe(1);
  });
});
