// What the amount, exact, percent and shares fields may hold, and how their text becomes numbers — with integer
// maths only (Global Constraints: never parseFloat a money string). `parseAmountInput` (domain/money) is the one
// reader of a whole expense or payment amount; these cover the per-person split values and the field filters.
import { resolveCommas } from '../../domain/money';

/**
 * Digits, commas and one point, at most two decimals after the point (app.js `#ex-amt` input filter): "1.2.3" → "1.23",
 * "100.009" → "100.00". Commas stay as typed; `resolveCommas` decides what they mean when the text is read.
 */
export function cleanDecimal(text: string): string {
  const t = text.replace(/[^\d.,]/g, '');
  const dot = t.indexOf('.');
  return dot < 0 ? t : t.slice(0, dot + 1) + t.slice(dot + 1).replace(/[.,]/g, '').slice(0, 2);
}

/** Whole numbers only (a share count). */
export const cleanWhole = (text: string) => text.replace(/\D/g, '');

/** "12.5" → 1250: minor units for an amount, hundredths for a percent. Null for an empty field (or a lone "."). */
export function hundredths(text: string): number | null {
  const m = /^(\d*)(?:\.(\d{0,2}))?$/.exec(resolveCommas(text));
  if (!m || (!m[1] && !m[2])) return null;
  return Number(m[1] || 0) * 100 + Number((m[2] ?? '').padEnd(2, '0'));
}

/** 144000 → "1440", 39334 → "393.34"; `fixed` always keeps two decimals (400.00, the Settle Up pre-fill). */
export function minorToText(minor: number, fixed = false): string {
  const whole = Math.floor(minor / 100);
  const cents = minor % 100;
  return cents || fixed ? `${whole}.${String(cents).padStart(2, '0')}` : String(whole);
}

/** Why an amount field's text is not a valid amount: nothing above 0 typed, or more than one expense may hold. */
export function amountProblem(text: string): string {
  return /[1-9]/.test(text) ? 'That’s above the limit for one expense' : 'Enter an amount above 0';
}
