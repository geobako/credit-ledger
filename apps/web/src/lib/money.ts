/**
 * Client-side money helpers. Amounts travel as strings of integer minor units and are only
 * ever handled as bigint or decimal strings here: never as JS numbers.
 */
export interface Money {
  amount: string;
  currency: string;
}

const formatters = new Map<string, Intl.NumberFormat>();

function formatter(currency: string, compact: boolean) {
  const key = `${currency}:${compact}`;
  let f = formatters.get(key);
  if (!f) {
    f = new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency,
      ...(compact ? { notation: 'compact', maximumFractionDigits: 1 } : {}),
    });
    formatters.set(key, f);
  }
  return f;
}

/** "123456" → "1234.56": an exact decimal string. */
export function toDecimalString(minor: bigint | string): string {
  const value = BigInt(minor);
  const negative = value < 0n;
  const abs = negative ? -value : value;
  const units = abs / 100n;
  const cents = (abs % 100n).toString().padStart(2, '0');
  return `${negative ? '-' : ''}${units}.${cents}`;
}

/**
 * Formats minor units as currency. Intl formats decimal *strings* exactly (no float
 * rounding), so precision survives even beyond Number.MAX_SAFE_INTEGER.
 */
export function formatMoney(
  money: Money | bigint | string | null | undefined,
  { currency = 'USD', compact = false }: { currency?: string; compact?: boolean } = {},
): string {
  if (money === null || money === undefined) return '—';
  const minor = typeof money === 'object' ? money.amount : money;
  const cur = typeof money === 'object' ? money.currency : currency;
  return formatter(cur, compact).format(
    toDecimalString(minor) as unknown as number, // Intl accepts exact decimal strings
  );
}

const AMOUNT_INPUT = /^\s*\$?\s*(\d{1,13})(?:\.(\d{0,2}))?\s*$/;

/** Parses user input like "12", "12.5" or "$1,250.00" into minor units, or null if invalid. */
export function parseAmount(input: string): bigint | null {
  const match = AMOUNT_INPUT.exec(input.replace(/,/g, ''));
  if (!match) return null;
  const units = BigInt(match[1]!);
  const cents = BigInt((match[2] ?? '').padEnd(2, '0'));
  return units * 100n + cents;
}

export const minor = (money: Money | null | undefined): bigint => BigInt(money?.amount ?? '0');

/** Share of `part` in `whole` as a 0–1 ratio for drawing (display only, never for money). */
export function ratio(part: bigint, whole: bigint): number {
  if (whole <= 0n) return 0;
  const clamped = part < 0n ? 0n : part > whole ? whole : part;
  return Number((clamped * 10_000n) / whole) / 10_000;
}
