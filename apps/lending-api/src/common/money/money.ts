import { DomainError } from '../errors/domain-error';

export const CURRENCIES = ['USD'] as const;
export type Currency = (typeof CURRENCIES)[number];

const MINOR_UNIT_DIGITS: Record<Currency, number> = { USD: 2 };
const INTEGER = /^-?\d+$/;

export class InvalidMoneyError extends DomainError {
  readonly code = 'INVALID_MONEY';
}

export class CurrencyMismatchError extends DomainError {
  readonly code = 'CURRENCY_MISMATCH';
}

export interface MoneyJson {
  /** Integer minor units (cents) as a string — JSON numbers lose precision above 2^53. */
  amount: string;
  currency: Currency;
}

/**
 * An immutable amount of money in integer minor units (cents).
 *
 * Floats are never involved: values are bigint end to end, parsing is strict (no
 * silent rounding), and the only rounding operation is explicit and documented.
 */
export class Money {
  private constructor(
    readonly minor: bigint,
    readonly currency: Currency,
  ) {}

  static of(minor: bigint | string, currency: Currency = 'USD'): Money {
    assertCurrency(currency);
    if (typeof minor === 'string') {
      if (!INTEGER.test(minor)) {
        throw new InvalidMoneyError(`"${minor}" is not an integer amount of minor units`);
      }
      return new Money(BigInt(minor), currency);
    }
    if (typeof minor !== 'bigint') {
      throw new InvalidMoneyError(
        'money must be built from bigint or an integer string, never a number',
      );
    }
    return new Money(minor, currency);
  }

  static zero(currency: Currency = 'USD'): Money {
    return Money.of(0n, currency);
  }

  /** Parses a major-unit decimal string ("125.50"). Rejects anything more precise than the currency allows. */
  static fromDecimal(value: string, currency: Currency = 'USD'): Money {
    assertCurrency(currency);
    const digits = MINOR_UNIT_DIGITS[currency];
    const match = new RegExp(`^(-)?(\\d+)(?:\\.(\\d{1,${digits}}))?$`).exec(value);
    if (!match) {
      throw new InvalidMoneyError(`"${value}" is not a valid ${currency} amount`);
    }
    const [, sign, whole, fraction = ''] = match;
    const minor = BigInt(`${whole}${fraction.padEnd(digits, '0')}`);
    return new Money(sign ? -minor : minor, currency);
  }

  static fromJSON(json: MoneyJson): Money {
    return Money.of(json.amount, json.currency);
  }

  add(other: Money): Money {
    this.assertSameCurrency(other);
    return new Money(this.minor + other.minor, this.currency);
  }

  subtract(other: Money): Money {
    this.assertSameCurrency(other);
    return new Money(this.minor - other.minor, this.currency);
  }

  negate(): Money {
    return new Money(-this.minor, this.currency);
  }

  /**
   * Multiplies by a rate in basis points (10_000 = 100%), rounding toward zero.
   * Used to derive a credit limit from collateral: rounding down never grants
   * credit that isn't fully covered by the deposit.
   */
  applyBasisPoints(bps: number): Money {
    if (!Number.isSafeInteger(bps) || bps < 0) {
      throw new InvalidMoneyError(`basis points must be a non-negative integer, got ${bps}`);
    }
    return new Money((this.minor * BigInt(bps)) / 10_000n, this.currency);
  }

  compare(other: Money): -1 | 0 | 1 {
    this.assertSameCurrency(other);
    return this.minor < other.minor ? -1 : this.minor > other.minor ? 1 : 0;
  }

  equals(other: Money): boolean {
    return this.currency === other.currency && this.minor === other.minor;
  }

  gt(other: Money) {
    return this.compare(other) > 0;
  }
  gte(other: Money) {
    return this.compare(other) >= 0;
  }
  lt(other: Money) {
    return this.compare(other) < 0;
  }
  lte(other: Money) {
    return this.compare(other) <= 0;
  }

  min(other: Money): Money {
    return this.lte(other) ? this : other;
  }

  max(other: Money): Money {
    return this.gte(other) ? this : other;
  }

  isZero() {
    return this.minor === 0n;
  }
  isPositive() {
    return this.minor > 0n;
  }
  isNegative() {
    return this.minor < 0n;
  }

  /** "-1234.50" — exact, for display and logs. */
  toDecimal(): string {
    const digits = MINOR_UNIT_DIGITS[this.currency];
    const abs = this.minor < 0n ? -this.minor : this.minor;
    const raw = abs.toString().padStart(digits + 1, '0');
    const decimal = `${raw.slice(0, -digits)}.${raw.slice(-digits)}`;
    return this.minor < 0n ? `-${decimal}` : decimal;
  }

  toJSON(): MoneyJson {
    return { amount: this.minor.toString(), currency: this.currency };
  }

  toString(): string {
    return `${this.toDecimal()} ${this.currency}`;
  }

  private assertSameCurrency(other: Money) {
    if (other.currency !== this.currency) {
      throw new CurrencyMismatchError(
        `cannot combine ${String(this.currency)} with ${String(other.currency)}`,
      );
    }
  }
}

function assertCurrency(currency: string): asserts currency is Currency {
  if (!(CURRENCIES as readonly string[]).includes(currency)) {
    throw new InvalidMoneyError(`unsupported currency "${currency}"`);
  }
}
