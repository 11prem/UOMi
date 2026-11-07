import { formatMoney } from './money';
import type { Currency, SplitType } from './types';

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
const num = (x: number | null) => (x != null && Number.isFinite(x) ? x : 0);
const floors = (total: number, weights: number[], denom: number) =>
  weights.map((w) => Math.floor((total * w) / denom)); // integer maths: no float drift at the unit boundary

/** Splits `total` by `weights` (summing to `denom`), handing leftover units out one at a time in row order, never to a 0 weight. */
function distribute(total: number, weights: number[], denom: number): number[] {
  const out = floors(total, weights, denom);
  for (let i = 0, left = total - sum(out); left > 0; i = (i + 1) % out.length) {
    if (weights[i] > 0) {
      out[i]++;
      left--;
    }
  }
  return out;
}

/**
 * What each ticked person owes, whether the split can be saved, and the live helper line (specs § 8.2).
 * `input` is what was typed: nothing for equal, an amount in major units for exact, a percent, or a share count.
 * `currency` only affects the helper line.
 */
export function computeSplit(
  totalMinor: number,
  type: SplitType,
  rows: { userId: string; input: number | null }[],
  currency: Currency = 'INR',
): { valid: boolean; amounts: { userId: string; amountMinor: number }[]; helper: string } {
  const money = (v: number) => formatMoney(v, currency);
  const result = (valid: boolean, amts: number[], helper: string) => ({
    valid,
    amounts: rows.map((r, i) => ({ userId: r.userId, amountMinor: amts[i] ?? 0 })),
    helper,
  });

  if (!(totalMinor > 0)) return result(false, [], 'Enter an amount to see each share');
  if (!rows.length) return result(false, [], 'Pick at least one person');

  if (type === 'equal') {
    const each = Math.floor(totalMinor / rows.length);
    return result(true, distribute(totalMinor, rows.map(() => 1), rows.length), `${money(each)} each`);
  }

  if (type === 'exact') {
    const amts = rows.map((r) => Math.round(num(r.input) * 100));
    const left = totalMinor - sum(amts);
    const valid = left === 0 && amts.every((a) => a >= 0);
    const helper =
      left > 0 ? `${money(left)} left to assign` : left < 0 ? `${money(-left)} over` : valid ? 'Adds up to the total' : 'Amounts can’t be negative';
    return result(valid, amts, helper);
  }

  if (type === 'percent') {
    const hundredths = rows.map((r) => Math.max(0, Math.round(num(r.input) * 100))); // 33.33% -> 3333
    const left = (10000 - sum(hundredths)) / 100;
    if (left !== 0) {
      return result(false, floors(totalMinor, hundredths, 10000), left > 0 ? `${left}% left` : `${-left}% over`);
    }
    return result(true, distribute(totalMinor, hundredths, 10000), 'Adds up to 100%');
  }

  const weights = rows.map((r) => Math.max(0, Math.trunc(num(r.input))));
  const totalShares = sum(weights);
  if (!totalShares) return result(false, [], 'Give at least one share');
  return result(true, distribute(totalMinor, weights, totalShares), `${totalShares} share${totalShares === 1 ? '' : 's'} in total`);
}
