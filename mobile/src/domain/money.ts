import type { Currency } from './types';

export const CURRENCY_INFO: Record<Currency, { symbol: string; locale: string; name: string }> = {
  INR: { symbol: '₹', locale: 'en-IN', name: 'Indian rupee' },
  USD: { symbol: '$', locale: 'en-US', name: 'US dollar' },
  EUR: { symbol: '€', locale: 'en-IE', name: 'Euro' },
  GBP: { symbol: '£', locale: 'en-GB', name: 'British pound' },
  AED: { symbol: 'AED', locale: 'en-AE', name: 'UAE dirham' },
  SGD: { symbol: 'S$', locale: 'en-SG', name: 'Singapore dollar' },
  AUD: { symbol: 'A$', locale: 'en-AU', name: 'Australian dollar' },
  CAD: { symbol: 'C$', locale: 'en-CA', name: 'Canadian dollar' },
};

// Building an Intl.NumberFormat is slow on Hermes and lists format dozens of amounts.
const formats = new Map<string, Intl.NumberFormat>();
function numberFormat(locale: string, digits: number) {
  const key = `${locale}/${digits}`;
  let f = formats.get(key);
  if (!f) {
    f = new Intl.NumberFormat(locale, { minimumFractionDigits: digits, maximumFractionDigits: digits });
    formats.set(key, f);
  }
  return f;
}

/** `₹1,23,456.50`, `$123,456.50`. Shows the magnitude; `signed` prefixes a dash on negatives. */
export function formatMoney(
  minor: number,
  currency: Currency,
  opts: { compact?: boolean; signed?: boolean } = {},
): string {
  const { symbol, locale } = CURRENCY_INFO[currency];
  const abs = Math.abs(minor);
  const digits = opts.compact && abs % 100 === 0 ? 0 : 2;
  const sym = symbol.length > 1 ? `${symbol} ` : symbol;
  return `${minor < 0 && opts.signed ? '–' : ''}${sym}${numberFormat(locale, digits).format(abs / 100)}`;
}

const MAX_MINOR = 999_999_999;

/** What a user typed into an amount field, as minor units. Null unless 0 < amount <= 9,999,999.99 with at most 2 decimals. */
export function parseAmountInput(text: string): number | null {
  const m = /^(\d*)(?:\.(\d{0,2}))?$/.exec(text.trim());
  if (!m || (!m[1] && !m[2])) return null;
  const minor = Number(m[1] || 0) * 100 + Number((m[2] ?? '').padEnd(2, '0'));
  return minor > 0 && minor <= MAX_MINOR ? minor : null;
}

/** A server decimal string such as `-100.10` as integer minor units, without going through a float. Throws if malformed. */
export function parseMoneyString(s: string): number {
  const m = /^([+-])?(\d+)(?:\.(\d{1,2}))?$/.exec(s.trim());
  if (!m) throw new Error(`Invalid money string: "${s}"`);
  const minor = Number(m[2]) * 100 + Number((m[3] ?? '').padEnd(2, '0'));
  return m[1] === '-' && minor !== 0 ? -minor : minor;
}
