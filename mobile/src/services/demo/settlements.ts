import { pairKey, settleMax } from '../../domain/balances';
import { formatMoney } from '../../domain/money';
import type { Settlement, User } from '../../domain/types';
import { AppError } from '../errors';
import type { Services } from '../types';
import type { Ctx } from './context';
import { messages } from './messages';

const forbidden = (message: string) => new AppError('forbidden', message);

// specs § 9 (settle up), § 9.1 (detail), § 10.1 (who can do what), § 11.2 (who is told). No real money moves.
export function makeSettlements(c: Ctx): Services['settlements'] {
  const answer = (id: string, confirm: boolean) =>
    c.write(() => {
      const me = c.me();
      const { settlement: s, space } = c.settlementOf(id);
      if (s.toUserId !== me.id) throw forbidden('Only the person receiving the payment can answer it');
      if (s.status !== 'pending') throw forbidden('This payment has already been answered');
      s.status = confirm ? 'confirmed' : 'rejected';
      s.answeredAt = c.now();
      c.resolve(id, me.id);
      c.notify(s.fromUserId, 'payment_answered', messages.paymentAnswered(c.firstOf(me.id), s.status, s.amountMinor, space.currency), { space, refId: id });
    });

  return {
    get: (id) =>
      c.read(() => {
        const { settlement, space } = c.settlementOf(id);
        return { settlement, space, from: c.user(settlement.fromUserId) as User, to: c.user(settlement.toUserId) as User };
      }),

    payees: (spaceId) =>
      c.read(() => {
        const me = c.me();
        const space = c.memberSpace(spaceId);
        return c
          .bal(space, me.id)
          .pairs.filter((p) => p.netMinor < 0)
          .map((p) => ({ user: c.user(p.userId) as User, maxMinor: settleMax(space, c.db.expenses, c.db.settlements, me.id, p.userId) }))
          .filter((p) => p.maxMinor > 0); // everything already recorded and waiting for an answer: nothing left to pay
      }),

    create: ({ spaceId, toUserId, amountMinor }) =>
      c.write(() => {
        const me = c.me();
        const space = c.memberSpace(spaceId);
        if (toUserId === me.id || !space.memberIds.includes(toUserId)) throw c.notFound('Person');
        if (!(c.owes(space).get(pairKey(me.id, toUserId)) ?? 0)) throw forbidden(`You don’t owe ${c.firstOf(toUserId)} anything in this space`);
        const max = settleMax(space, c.db.expenses, c.db.settlements, me.id, toUserId);
        if (!Number.isInteger(amountMinor) || amountMinor <= 0) throw c.invalid('amount', 'Enter an amount greater than zero');
        if (amountMinor > max) throw c.invalid('amount', `The most you can record is ${formatMoney(max, space.currency)}`);
        const s: Settlement = { id: c.uid('st'), spaceId, fromUserId: me.id, toUserId, amountMinor, date: c.now(), status: 'pending', answeredAt: null };
        c.db.settlements.push(s);
        c.notify(toUserId, 'payment_to_confirm', messages.paymentToConfirm(c.firstOf(me.id), amountMinor, space.currency), { space, refId: s.id, needsAnswer: true });
        return s;
      }),

    confirm: (id) => answer(id, true),
    reject: (id) => answer(id, false),

    cancel: (id) =>
      c.write(() => {
        const { settlement: s } = c.settlementOf(id);
        if (s.fromUserId !== c.me().id) throw forbidden('Only the person who recorded this payment can cancel it');
        if (s.status !== 'pending') throw forbidden(s.status === 'confirmed' ? 'Confirmed payments can’t be cancelled' : 'Only pending payments can be cancelled');
        s.status = 'cancelled';
        s.answeredAt = c.now();
        c.db.notifications = c.db.notifications.filter((n) => !(n.refId === id && n.type === 'payment_to_confirm'));
      }),
  };
}
