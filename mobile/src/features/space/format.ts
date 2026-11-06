import type { Tone } from '../../domain/phrases';
import { formatMoney } from '../../domain/money';
import type { ActivityRow, Currency } from '../../domain/types';

/** The record number on a space ("NO. 0412", prototype `U.serial`). */
export const serial = (n: number) => `NO. ${String(n).padStart(4, '0')}`;

/** "Meera Shah" → "Meera" (prototype `U.first`). */
export const firstName = (name: string) => name.trim().split(/\s+/)[0];

const money = (minor: number, currency: Currency) => formatMoney(Math.abs(minor), currency, { compact: true });

/** The right side of an expense row (specs § 7), from the signed `myPartMinor`: + lent, − owed, null not involved. */
export function myPartText(r: Extract<ActivityRow, { kind: 'expense' }>, currency: Currency, meId: string): { text: string; tone: Tone } {
  if (r.disputed) return { text: 'not counted', tone: 'muted' }; // a disputed expense stops counting toward balances (§ 11.2)
  if (r.myPartMinor === null) return { text: 'not involved', tone: 'muted' };
  if (r.myPartMinor > 0) return { text: `you lent ${money(r.myPartMinor, currency)}`, tone: 'owed' };
  if (r.myPartMinor < 0) return { text: `you owe ${money(r.myPartMinor, currency)}`, tone: 'owe' };
  return { text: r.paidById === meId ? 'your own' : 'not involved', tone: 'muted' };
}

/** One line of the Space Page breakdown: "You owe Swetha" / "Arun owes you" and the amount. `netMinor` + = they owe the viewer. */
export function pairLine(name: string, netMinor: number, currency: Currency) {
  const who = firstName(name);
  return { text: netMinor < 0 ? `You owe ${who}` : `${who} owes you`, amount: money(netMinor, currency), tone: (netMinor < 0 ? 'owe' : 'owed') as Tone };
}
