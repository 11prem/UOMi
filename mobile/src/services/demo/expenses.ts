import { computeSplit } from '../../domain/split';
import type { Expense, Space } from '../../domain/types';
import { AppError } from '../errors';
import type { Services } from '../types';
import type { Ctx } from './context';
import { messages } from './messages';

type Input = Omit<Expense, 'id' | 'createdBy' | 'updatedAt'>;
const MAX_MINOR = 999_999_999; // 9,999,999.99
const forbidden = (message: string) => new AppError('forbidden', message);

// specs § 8 (add / edit, split types), § 10.1 (who can do what), § 11.2 (who is told).
export function makeExpenses(c: Ctx): Services['expenses'] {
  /** Checks the input against the space and the split rules; returns what to store. The amounts must be what computeSplit gives. */
  function check(space: Space, i: Input) {
    const description = i.description.trim();
    if (description.length < 1 || description.length > 50) throw c.invalid('description', 'Description must be 1–50 characters');
    if (!Number.isInteger(i.amountMinor) || i.amountMinor <= 0 || i.amountMinor > MAX_MINOR) throw c.invalid('amount', 'Enter an amount greater than zero');
    if (!space.memberIds.includes(i.paidBy)) throw c.invalid('paidBy', 'The person who paid must be in this space');
    const ids = i.shares.map((s) => s.userId);
    if (!ids.length || new Set(ids).size !== ids.length || ids.some((id) => !space.memberIds.includes(id))) {
      throw c.invalid('shares', 'Split between people in this space, each once');
    }
    // A shares row with no number means 1 share; equal has nothing typed.
    const rows = i.shares.map((s) => ({ userId: s.userId, input: i.splitType === 'equal' ? null : i.splitType === 'shares' ? (s.input ?? 1) : s.input }));
    const split = computeSplit(i.amountMinor, i.splitType, rows, space.currency);
    if (!split.valid || split.amounts.some((a, k) => a.amountMinor !== i.shares[k].amountMinor)) {
      throw c.invalid('shares', 'The split doesn’t add up to the total');
    }
    if (split.amounts.some((a) => a.amountMinor === 0)) throw c.invalid('shares', 'Everyone in the split needs an amount above 0'); // no ₹0 shares to answer
    return { description, amountMinor: i.amountMinor, paidBy: i.paidBy, splitType: i.splitType, date: i.date, rows, amounts: split.amounts };
  }

  /** The payer and the creator never have to answer their own share; everyone else starts pending. */
  const shareOf = (v: ReturnType<typeof check>, createdBy: string) =>
    v.rows.map((r, k) => ({
      userId: r.userId,
      input: r.input,
      amountMinor: v.amounts[k].amountMinor,
      response: r.userId === v.paidBy || r.userId === createdBy ? ('accepted' as const) : ('pending' as const),
    }));

  const tellShares = (e: Expense, space: Space) => {
    for (const s of e.shares.filter((x) => x.response === 'pending')) {
      c.notify(s.userId, 'expense_share', messages.expenseShare(c.firstOf(e.createdBy), e.description, s.amountMinor, space.currency), {
        space,
        refId: e.id,
        needsAnswer: true,
      });
    }
  };

  const answer = (id: string, response: 'accepted' | 'rejected') =>
    c.write(() => {
      const me = c.me();
      const { expense: e, space } = c.expenseOf(id);
      const share = e.shares.find((s) => s.userId === me.id);
      if (!share) throw forbidden('Only the person whose share it is can answer it');
      if (me.id === e.createdBy || me.id === e.paidBy) throw forbidden('Your own share is accepted automatically');
      if (share.response === response) return;
      share.response = response;
      c.resolve(id, me.id);
      // Accepting sends nothing; a rejection goes to whoever created the expense.
      if (response === 'rejected') {
        c.notify(e.createdBy, 'share_rejected', messages.shareRejected(c.firstOf(me.id), share.amountMinor, e.description, space.currency), { space, refId: e.id });
      }
    });

  return {
    get: (id) =>
      c.read(() => {
        const { expense, space } = c.expenseOf(id);
        // Everyone the expense names, even someone since removed from the space, so every row has a name.
        const involved = [...new Set([...space.memberIds, expense.paidBy, expense.createdBy, ...expense.shares.map((s) => s.userId)])];
        return { expense, space, members: involved.flatMap((u) => c.user(u) ?? []) };
      }),

    create: (i) =>
      c.write(() => {
        const me = c.me();
        const space = c.memberSpace(i.spaceId);
        const v = check(space, i);
        const e: Expense = {
          id: c.uid('e'),
          spaceId: space.id,
          description: v.description,
          amountMinor: v.amountMinor,
          paidBy: v.paidBy,
          splitType: v.splitType,
          shares: shareOf(v, me.id),
          date: v.date,
          createdBy: me.id,
          updatedAt: c.now(),
        };
        c.db.expenses.push(e);
        tellShares(e, space);
        return e;
      }),

    update: (id, i) =>
      c.write(() => {
        const me = c.me();
        const { expense: e, space } = c.expenseOf(id);
        if (e.createdBy !== me.id) throw forbidden('Only the person who added this expense can edit it');
        const v = check(space, i); // the space cannot be changed by an edit
        // An edit resets every answer and asks everyone again, replacing the old cards.
        c.db.notifications = c.db.notifications.filter((n) => !(n.refId === id && n.type === 'expense_share'));
        Object.assign(e, {
          description: v.description,
          amountMinor: v.amountMinor,
          paidBy: v.paidBy,
          splitType: v.splitType,
          shares: shareOf(v, e.createdBy),
          date: v.date,
          updatedAt: c.now(),
        });
        tellShares(e, space);
        return e;
      }),

    remove: (id) =>
      c.write(() => {
        const { expense } = c.expenseOf(id);
        if (expense.createdBy !== c.me().id) throw forbidden('Only the person who added this expense can delete it');
        c.db.expenses = c.db.expenses.filter((e) => e.id !== id);
        c.db.notifications = c.db.notifications.filter((n) => n.refId !== id);
      }),

    acceptShare: (id) => answer(id, 'accepted'),
    rejectShare: (id) => answer(id, 'rejected'),
  };
}
