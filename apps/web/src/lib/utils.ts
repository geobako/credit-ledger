import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export const cn = (...inputs: ClassValue[]) => twMerge(clsx(inputs));

const relative = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });
const UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ['day', 86_400_000],
  ['hour', 3_600_000],
  ['minute', 60_000],
  ['second', 1000],
];

export function timeAgo(iso: string | Date): string {
  const delta = new Date(iso).getTime() - Date.now();
  for (const [unit, ms] of UNITS) {
    if (Math.abs(delta) >= ms || unit === 'second') {
      return relative.format(Math.round(delta / ms), unit);
    }
  }
  return '';
}

const dateTime = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
});
export const formatDateTime = (iso: string | Date) => dateTime.format(new Date(iso));

export const shortId = (id: string) => id.slice(0, 8);

/** "INSUFFICIENT_CREDIT" → "Insufficient credit" */
export const humanize = (code: string) =>
  code.charAt(0) + code.slice(1).toLowerCase().replace(/_/g, ' ');
