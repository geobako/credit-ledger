import fc from 'fast-check';
import { CurrencyMismatchError, InvalidMoneyError, Money } from './money';

const anyMinor = fc.bigInt({ min: -(10n ** 15n), max: 10n ** 15n });
const anyMoney = anyMinor.map((minor) => Money.of(minor));

describe('Money', () => {
  describe('construction', () => {
    it('builds from bigint and integer strings', () => {
      expect(Money.of(12550n).minor).toBe(12550n);
      expect(Money.of('-42').minor).toBe(-42n);
    });

    it('refuses JS numbers', () => {
      expect(() => Money.of(10 as unknown as bigint)).toThrow(InvalidMoneyError);
    });

    it.each(['1.5', '1e3', '', ' 1', '0x10', 'abc'])(
      'rejects non-integer minor string %p',
      (raw) => {
        expect(() => Money.of(raw)).toThrow(InvalidMoneyError);
      },
    );

    it('rejects unsupported currencies', () => {
      expect(() => Money.of(1n, 'EUR' as never)).toThrow(InvalidMoneyError);
    });
  });

  describe('fromDecimal', () => {
    it.each([
      ['125.5', 12550n],
      ['125.50', 12550n],
      ['0.01', 1n],
      ['7', 700n],
      ['-3.20', -320n],
    ])('parses %p', (input, minor) => {
      expect(Money.fromDecimal(input).minor).toBe(minor);
    });

    it.each(['1.234', '1.', '.5', '1,00', '+1', 'NaN', 'Infinity'])(
      'rejects %p rather than rounding',
      (input) => {
        expect(() => Money.fromDecimal(input)).toThrow(InvalidMoneyError);
      },
    );
  });

  describe('arithmetic', () => {
    it('is exact beyond Number.MAX_SAFE_INTEGER', () => {
      const big = Money.of('9007199254740993');
      expect(big.add(Money.of(1n)).toJSON().amount).toBe('9007199254740994');
    });

    it('rejects mixing currencies', () => {
      const usd = Money.of(1n);
      const fake = Object.assign(Object.create(Money.prototype) as Money, {
        minor: 1n,
        currency: 'EUR',
      });
      expect(() => usd.add(fake)).toThrow(CurrencyMismatchError);
    });

    it('applies basis points rounding toward zero', () => {
      expect(Money.of(10_001n).applyBasisPoints(5_000).minor).toBe(5_000n);
      expect(Money.of(-10_001n).applyBasisPoints(5_000).minor).toBe(-5_000n);
      expect(Money.of(12_345n).applyBasisPoints(10_000).minor).toBe(12_345n);
      expect(() => Money.of(1n).applyBasisPoints(1.5)).toThrow(InvalidMoneyError);
    });
  });

  describe('formatting', () => {
    it.each([
      [0n, '0.00'],
      [5n, '0.05'],
      [-5n, '-0.05'],
      [123456n, '1234.56'],
    ])('%p → %p', (minor, decimal) => {
      expect(Money.of(minor).toDecimal()).toBe(decimal);
    });

    it('serialises amounts as strings', () => {
      expect(JSON.parse(JSON.stringify({ m: Money.of(100n) }))).toEqual({
        m: { amount: '100', currency: 'USD' },
      });
    });
  });

  describe('properties', () => {
    it('add/subtract are inverse', () => {
      fc.assert(fc.property(anyMoney, anyMoney, (a, b) => a.add(b).subtract(b).equals(a)));
    });

    it('addition is commutative and associative', () => {
      fc.assert(
        fc.property(anyMoney, anyMoney, anyMoney, (a, b, c) => {
          return (
            a.add(b).equals(b.add(a)) &&
            a
              .add(b)
              .add(c)
              .equals(a.add(b.add(c)))
          );
        }),
      );
    });

    it('decimal round-trips exactly', () => {
      fc.assert(fc.property(anyMoney, (m) => Money.fromDecimal(m.toDecimal()).equals(m)));
    });

    it('JSON round-trips exactly', () => {
      fc.assert(fc.property(anyMoney, (m) => Money.fromJSON(m.toJSON()).equals(m)));
    });

    it('a basis-point share never exceeds the whole for rates <= 100%', () => {
      fc.assert(
        fc.property(
          fc.bigInt({ min: 0n, max: 10n ** 15n }),
          fc.integer({ min: 0, max: 10_000 }),
          (minor, bps) => Money.of(minor).applyBasisPoints(bps).lte(Money.of(minor)),
        ),
      );
    });
  });
});
