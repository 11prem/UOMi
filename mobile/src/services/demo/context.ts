import { pairwise, spaceBalance } from '../../domain/balances';
import type { ActivityRow, Expense, NotificationType, Settlement, Space, SpaceBalance, User } from '../../domain/types';
import { AppError } from '../errors';
import { loadDb, saveDb, type DemoDb, type Storage } from './db';

export type DemoOptions = {
  /** The clock (OTP expiry, timestamps). Default `Date.now`. */
  now?: () => number;
  /** Wait 300–800 ms per call. Default: on, except under jest (`NODE_ENV === 'test'`). */
  delay?: boolean;
};

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
// Results are copies, so a screen can't change the stored data through an object it was handed (and a cached query result never mutates).
const copy = <T>(x: T): T => (x === undefined ? x : JSON.parse(JSON.stringify(x)));

/** Per-call rules: `read` = delay + simulated errors; `write` adds the offline failure and saves; `local` = delay only; `debug` = none. */
type Kind = 'read' | 'write' | 'local' | 'debug';

/** The shared state and helpers every operation file uses. */
export function createContext(storage: Storage, opts: DemoOptions = {}) {
  const now = opts.now ?? Date.now;
  const delay = opts.delay ?? process.env.NODE_ENV !== 'test';
  const flags = { simulateErrors: false, offline: false };
  let db: DemoDb;
  let canSave = true; // false for a run on sample data because the stored data couldn't be read: it must survive
  let lastSaveFailed = false;

  let saving: Promise<void> = Promise.resolve(); // saves run one after another, so the last write wins
  const save = () =>
    (saving = saving.then(async () => {
      if (canSave) lastSaveFailed = !(await saveDb(storage, db));
    }));
  const ready = loadDb(storage, now()).then((loaded) => {
    ({ db, canSave } = loaded);
    if (loaded.fresh) return save();
  });

  async function run<T>(kind: Kind, fn: () => T, saveAfter: boolean): Promise<T> {
    await ready;
    if (delay && kind !== 'debug') await wait(300 + Math.random() * 500);
    if ((kind === 'read' || kind === 'write') && flags.simulateErrors) {
      throw new AppError('simulated', 'Something went wrong. Your data is safe.');
    }
    if (kind === 'write' && flags.offline) throw new AppError('network', 'You’re offline — try again when you’re connected');
    const out = fn(); // runs to completion with no awaits inside, so calls never interleave
    if (saveAfter) await save();
    return copy(out);
  }

  const uid = (prefix: string) => `${prefix}_${Math.random().toString(36).slice(2, 9)}`;
  const notFound = (what: string) => new AppError('not_found', `${what} not found`);
  const user = (id: string): User | undefined => db.users.find((u) => u.id === id);
  const nameOf = (id: string) => user(id)?.name ?? 'Someone';
  const space = (id: string): Space | undefined => db.spaces.find((s) => s.id === id);
  const rowsOf = (s: Space) => ({
    expenses: db.expenses.filter((e) => e.spaceId === s.id),
    settlements: db.settlements.filter((x) => x.spaceId === s.id),
  });

  /** The signed-in user; calls with nobody signed in fail like an expired session. */
  function me(): User {
    const u = db.session.userId ? user(db.session.userId) : undefined;
    if (!u) throw new AppError('session_expired', 'Please sign in again');
    return u;
  }
  /** A space the signed-in user is in. A space they are not in reads as not found (as a removed member would see it). */
  function memberSpace(id: string): Space {
    const s = space(id);
    if (!s || !s.memberIds.includes(me().id)) throw notFound('Space');
    return s;
  }
  function expenseOf(id: string): { expense: Expense; space: Space } {
    const expense = db.expenses.find((x) => x.id === id);
    const s = expense && space(expense.spaceId);
    if (!expense || !s || !s.memberIds.includes(me().id)) throw notFound('Expense');
    return { expense, space: s };
  }
  /** A payment in one of the user's spaces, or one they are part of after leaving its space (to answer a late payment). */
  function settlementOf(id: string): { settlement: Settlement; space: Space } {
    const settlement = db.settlements.find((x) => x.id === id);
    const s = settlement && space(settlement.spaceId);
    if (!settlement || !s || ![...s.memberIds, settlement.fromUserId, settlement.toUserId].includes(me().id)) throw notFound('Payment');
    return { settlement, space: s };
  }

  // ---- balances: always the shared calculator ----
  const bal = (s: Space, viewerId: string): SpaceBalance => spaceBalance(s, db.expenses, db.settlements, viewerId, nameOf);
  /** Who owes whom in a space: `pairKey(debtor, creditor)` -> amount. */
  const owes = (s: Space) => pairwise(rowsOf(s).expenses, rowsOf(s).settlements);
  /** True when none of the user's pairwise balances in the space is open (or, given no user, none of anyone's). */
  function isSettled(s: Space, userId?: string): boolean {
    const keys = [...owes(s).keys()];
    return userId ? !keys.some((k) => k.split('>').includes(userId)) : keys.length === 0;
  }
  function lastActivity(s: Space): number {
    const { expenses, settlements } = rowsOf(s);
    return Math.max(s.createdAt, ...expenses.map((e) => e.updatedAt), ...settlements.flatMap((x) => [x.date, x.answeredAt ?? 0]));
  }

  // ---- rows shown in the Space page and Transactions lists ----
  function expenseRow(e: Expense, viewerId: string): ActivityRow {
    const mine = e.shares.find((x) => x.userId === viewerId);
    return {
      kind: 'expense',
      id: e.id,
      description: e.description,
      date: e.date,
      amountMinor: e.amountMinor,
      paidById: e.paidBy,
      paidByName: nameOf(e.paidBy),
      // Signed from the viewer's side: + what the others owe them (they paid), − their own share (someone else paid), null if not involved.
      myPartMinor: e.paidBy === viewerId ? e.amountMinor - (mine?.amountMinor ?? 0) : mine ? 0 - mine.amountMinor : null, // 0 − x: never −0
      myResponse: mine ? mine.response : null,
      disputed: e.shares.some((x) => x.response === 'rejected'),
    };
  }
  const paymentRow = (s: Settlement): ActivityRow => ({
    kind: 'payment',
    id: s.id,
    date: s.date,
    fromId: s.fromUserId,
    fromName: nameOf(s.fromUserId),
    toId: s.toUserId,
    toName: nameOf(s.toUserId),
    amountMinor: s.amountMinor,
    status: s.status,
  });

  // ---- notification cards ----
  function notify(userId: string, type: NotificationType, message: string, o: { space: { id: string; name: string }; refId?: string; needsAnswer?: boolean }) {
    db.notifications.unshift({
      id: uid('n'),
      userId,
      type,
      message,
      spaceId: o.space.id,
      spaceName: o.space.name,
      refId: o.refId ?? null,
      needsAnswer: o.needsAnswer ?? false,
      read: false,
      createdAt: now(),
    });
  }
  /** The user answered the card(s) about `refId`: they stop asking and count as read. */
  function resolve(refId: string, userId: string) {
    for (const n of db.notifications) if (n.refId === refId && n.userId === userId && n.needsAnswer) Object.assign(n, { needsAnswer: false, read: true });
  }

  return {
    get db() {
      return db;
    },
    set db(next: DemoDb) {
      db = next;
    },
    /** The last save didn't reach the device (the data is still in memory). */
    get lastSaveFailed() {
      return lastSaveFailed;
    },
    flags,
    now,
    read: <T>(fn: () => T) => run('read', fn, false),
    write: <T>(fn: () => T) => run('write', fn, true),
    local: <T>(fn: () => T, saveAfter = false) => run('local', fn, saveAfter),
    debug: <T>(fn: () => T, saveAfter = false) => run('debug', fn, saveAfter),
    uid,
    notFound,
    invalid: (field: string, message: string) => new AppError('validation_error', message, { fields: [{ field, message }] }),
    user,
    nameOf,
    firstOf: (id: string) => nameOf(id).split(' ')[0],
    space,
    spacesOf: (userId: string) => db.spaces.filter((s) => s.memberIds.includes(userId)),
    rowsOf,
    me,
    memberSpace,
    expenseOf,
    settlementOf,
    bal,
    owes,
    isSettled,
    lastActivity,
    expenseRow,
    paymentRow,
    notify,
    resolve,
  };
}

export type Ctx = ReturnType<typeof createContext>;
