import type { Services } from '../types';
import type { Ctx } from './context';

// specs § 11 (notifications) and § 12 (transactions).
export function makeNotifications(c: Ctx): Services['notifications'] {
  const mine = () => {
    const me = c.me();
    return c.db.notifications.filter((n) => n.userId === me.id);
  };

  return {
    // The list is kept newest first (new cards are added at the front), so no sort is needed.
    list: () =>
      c.read(() => mine().map((n) => ({ ...n, spaceName: (n.spaceId && c.space(n.spaceId)?.name) || n.spaceName }))), // a rename shows; a deleted space keeps its copied name

    markRead: (id) =>
      c.write(() => {
        const n = mine().find((x) => x.id === id);
        if (!n) throw c.notFound('Notification');
        n.read = true;
      }),

    markAllRead: () =>
      c.write(() => {
        for (const n of mine()) n.read = true;
      }),

    unreadCount: () => c.read(() => mine().filter((n) => !n.read).length),
  };
}

export function makeTransactions(c: Ctx): Services['transactions'] {
  return {
    // Every expense in the viewer's spaces, and the payments the viewer is part of.
    list: ({ kind, spaceId }) =>
      c.read(() => {
        const me = c.me();
        return c
          .spacesOf(me.id)
          .filter((s) => !spaceId || s.id === spaceId)
          .flatMap((s) => {
            const { expenses, settlements } = c.rowsOf(s);
            const meta = { spaceId: s.id, spaceName: s.name, currency: s.currency };
            return [
              ...(kind === 'payments' ? [] : expenses.map((e) => ({ ...c.expenseRow(e, me.id), ...meta }))),
              ...(kind === 'expenses' ? [] : settlements.filter((x) => x.fromUserId === me.id || x.toUserId === me.id).map((x) => ({ ...c.paymentRow(x), ...meta }))),
            ];
          })
          .sort((a, b) => b.date - a.date);
      }),
  };
}
