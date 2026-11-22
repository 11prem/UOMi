import type { Currency, Expense, OverallLine, Pair, Settlement, Space, SpaceBalance } from './types';

// The one balance calculator (specs § 14.2). Every screen and both services read through it.
// Callers pass one space's expenses and settlements; ids must not contain '>'.

export const pairKey = (debtorId: string, creditorId: string) => `${debtorId}>${creditorId}`;

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

/**
 * Who owes whom in one space: `pairKey(debtor, creditor)` -> amount > 0, with both directions netted, so a
 * pair appears at most once and settled pairs are absent.
 * Counts every share of an expense with no rejected share (pending and accepted alike), never the payer's
 * own share, and only confirmed settlements.
 */
export function pairwise(expenses: Expense[], settlements: Settlement[]): Map<string, number> {
  const owes = new Map<string, number>();
  const add = (a: string, b: string, v: number) => owes.set(pairKey(a, b), (owes.get(pairKey(a, b)) ?? 0) + v);
  for (const e of expenses) {
    if (e.shares.some((s) => s.response === 'rejected')) continue; // disputed
    for (const s of e.shares) if (s.userId !== e.paidBy) add(s.userId, e.paidBy, s.amountMinor);
  }
  for (const s of settlements) if (s.status === 'confirmed') add(s.fromUserId, s.toUserId, -s.amountMinor);

  const net = new Map<string, number>();
  for (const [key, v] of owes) {
    const [a, b] = key.split('>');
    const d = v - (owes.get(pairKey(b, a)) ?? 0);
    if (d > 0) net.set(key, d);
    else if (d < 0) net.set(pairKey(b, a), -d); // an over-paid settlement flips the pair
  }
  return net;
}

const inSpace = <T extends { spaceId: string }>(space: Space, rows: T[]) => rows.filter((r) => r.spaceId === space.id);

/**
 * The viewer's balance in one space. Pairs cover every other member, in member order, zero pairs included, then anyone
 * who has left with a balance still open (a deleted expense can reopen it), so it can still be seen and settled.
 */
export function spaceBalance(
  space: Space,
  expenses: Expense[],
  settlements: Settlement[],
  viewerId: string,
  nameOf: (id: string) => string,
): SpaceBalance {
  const owes = pairwise(inSpace(space, expenses), inSpace(space, settlements));
  const others = space.memberIds.filter((id) => id !== viewerId);
  for (const key of owes.keys()) {
    const [a, b] = key.split('>');
    const other = a === viewerId ? b : b === viewerId ? a : null;
    if (other && !others.includes(other)) others.push(other);
  }
  const pairs: Pair[] = others.map((userId) => ({
    userId,
    name: nameOf(userId),
    netMinor: (owes.get(pairKey(userId, viewerId)) ?? 0) - (owes.get(pairKey(viewerId, userId)) ?? 0),
  }));
  const open = pairs.filter((p) => p.netMinor !== 0);
  const netMinor = sum(pairs.map((p) => p.netMinor));
  // The people on the side of the net; nobody when it is 0 (open pairs are never 0, so no sign matches).
  const side = open.filter((p) => Math.sign(p.netMinor) === Math.sign(netMinor));
  return {
    spaceId: space.id,
    currency: space.currency,
    netMinor,
    pairs,
    openBalances: open.length,
    counterpartyName: side.length === 1 ? side[0].name : null,
    counterpartyCount: side.length,
    settled: open.length === 0,
  };
}

/** Per currency, over the viewer's spaces: what they owe, what they are owed, the net. Currencies are never mixed. */
export function overall(balances: SpaceBalance[]): OverallLine[] {
  const by = new Map<Currency, OverallLine>();
  for (const b of balances) {
    const line = by.get(b.currency) ?? { currency: b.currency, netMinor: 0, oweMinor: 0, owedMinor: 0 };
    for (const p of b.pairs) {
      if (p.netMinor < 0) line.oweMinor -= p.netMinor;
      else line.owedMinor += p.netMinor;
    }
    line.netMinor = line.owedMinor - line.oweMinor;
    by.set(b.currency, line);
  }
  return [...by.values()].filter((l) => l.oweMinor !== 0 || l.owedMinor !== 0).sort((a, b) => (a.currency < b.currency ? -1 : 1)); // code order, as the backend
}

/** The most `fromId` can record paying `toId` now: what they owe, minus payments to them still awaiting an answer (specs § 9). */
export function settleMax(
  space: Space,
  expenses: Expense[],
  settlements: Settlement[],
  fromId: string,
  toId: string,
): number {
  const mine = inSpace(space, settlements);
  const owed = pairwise(inSpace(space, expenses), mine).get(pairKey(fromId, toId)) ?? 0;
  const pending = sum(
    mine.filter((s) => s.fromUserId === fromId && s.toUserId === toId && s.status === 'pending').map((s) => s.amountMinor),
  );
  return Math.max(0, owed - pending);
}
