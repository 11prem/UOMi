import { formatMoney } from './money';
import type { OverallLine, SpaceBalance } from './types';

export type Tone = 'owe' | 'owed' | 'muted';

/**
 * The balance wording of a Home card (specs § 5.1). Reads only netMinor, openBalances and the counterparty
 * fields (never `pairs`, which server-mode cards don't carry). `compact` (default on) drops `.00`.
 */
export function balanceText(b: SpaceBalance, compact = true): { tone: Tone; text: string; sub: string } {
  if (b.openBalances === 0) return { tone: 'muted', text: 'Settled up', sub: '' };
  if (b.netMinor === 0) {
    return { tone: 'muted', text: `${formatMoney(0, b.currency, { compact: true })} net`, sub: `${b.openBalances} open balances` };
  }
  const who =
    b.counterpartyCount === 1 ? (b.counterpartyName ?? 'Someone').trim().split(/\s+/)[0] : `${b.counterpartyCount} people`;
  const money = formatMoney(Math.abs(b.netMinor), b.currency, { compact });
  return b.netMinor < 0
    ? { tone: 'owe', text: `You owe ${money}`, sub: who }
    : { tone: 'owed', text: `You’re owed ${money}`, sub: who };
}

/** The banner under the Home header: one line per currency, by net. */
export function overallLines(lines: OverallLine[]): { tone: Tone; text: string }[] {
  if (lines.length === 0) return [{ tone: 'muted', text: 'You’re all settled up' }];
  return lines.map((l): { tone: Tone; text: string } => {
    const money = formatMoney(Math.abs(l.netMinor), l.currency, { compact: true });
    if (l.netMinor < 0) return { tone: 'owe', text: `Overall, you owe ${money}` };
    if (l.netMinor > 0) return { tone: 'owed', text: `Overall, you’re owed ${money}` };
    return { tone: 'muted', text: `Overall, ${money} net` };
  });
}
