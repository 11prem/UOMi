import { overall } from '../../domain/balances';
import type { Space, User } from '../../domain/types';
import { AppError } from '../errors';
import type { Services } from '../types';
import type { Ctx } from './context';
import { messages } from './messages';

const forbidden = (message: string) => new AppError('forbidden', message);

// specs § 6 (create), § 7 (the page), § 10 and § 10.1 (who can do what).
export function makeSpaces(c: Ctx): Services['spaces'] {
  const cleanName = (name: string) => {
    const n = name.trim();
    if (n.length < 1 || n.length > 30) throw c.invalid('name', 'Space names are 1–30 characters');
    return n;
  };

  return {
    list: () =>
      c.read(() => {
        const me = c.me();
        return c
          .spacesOf(me.id)
          .map((space) => ({ space, balance: c.bal(space, me.id), lastActivity: c.lastActivity(space) }))
          .sort((a, b) => b.lastActivity - a.lastActivity);
      }),

    overall: () =>
      c.read(() => {
        const me = c.me();
        return overall(c.spacesOf(me.id).map((s) => c.bal(s, me.id)));
      }),

    get: (id) =>
      c.read(() => {
        const me = c.me();
        const space = c.memberSpace(id);
        const { expenses, settlements } = c.rowsOf(space);
        return {
          space,
          members: space.memberIds.map((m) => c.user(m)).filter((u): u is User => !!u),
          balance: c.bal(space, me.id),
          activity: [...expenses.map((e) => c.expenseRow(e, me.id)), ...settlements.map(c.paymentRow)].sort((a, b) => b.date - a.date),
          settledMemberIds: space.memberIds.filter((m) => c.isSettled(space, m)),
          allSettled: c.isSettled(space),
        };
      }),

    create: ({ name, icon, currency, memberIds }) =>
      c.write(() => {
        const me = c.me();
        const clean = cleanName(name);
        const others = [...new Set(memberIds)].filter((id) => id !== me.id);
        if (others.some((id) => !c.user(id))) throw c.notFound('Person');
        const space: Space = {
          id: c.uid('sp'),
          name: clean,
          icon,
          currency,
          ownerId: me.id,
          memberIds: [me.id, ...others],
          serial: Math.max(0, ...c.db.spaces.map((s) => s.serial)) + 1,
          createdAt: c.now(),
        };
        c.db.spaces.push(space);
        for (const id of others) c.notify(id, 'space_added', messages.spaceAdded(c.firstOf(me.id), clean), { space });
        return space;
      }),

    update: (id, p) =>
      c.write(() => {
        const me = c.me();
        const space = c.memberSpace(id);
        const patch: Partial<Pick<Space, 'name' | 'icon' | 'currency'>> = {};
        if (p.name !== undefined) patch.name = cleanName(p.name);
        if (p.icon !== undefined) patch.icon = p.icon;
        if (p.currency !== undefined && p.currency !== space.currency) {
          if (space.ownerId !== me.id) throw forbidden('Only the owner can change the currency');
          if (c.rowsOf(space).expenses.length) throw forbidden('Can’t change after expenses are added');
          patch.currency = p.currency;
        }
        return Object.assign(space, patch);
      }),

    addMembers: (id, userIds) =>
      c.write(() => {
        const me = c.me();
        const space = c.memberSpace(id);
        const added = [...new Set(userIds)].filter((u) => !space.memberIds.includes(u));
        if (added.some((u) => !c.user(u))) throw c.notFound('Person');
        for (const u of added) {
          space.memberIds.push(u);
          c.notify(u, 'space_added', messages.spaceAdded(c.firstOf(me.id), space.name), { space });
        }
      }),

    removeMember: (id, userId) =>
      c.write(() => {
        const space = c.memberSpace(id);
        if (space.ownerId !== c.me().id) throw forbidden('Only the owner can remove people');
        if (userId === space.ownerId) throw forbidden('The owner can’t be removed');
        if (!space.memberIds.includes(userId)) throw c.notFound('Member');
        if (!c.isSettled(space, userId)) throw forbidden('Settle up first');
        space.memberIds = space.memberIds.filter((m) => m !== userId);
      }),

    leave: (id) =>
      c.write(() => {
        const me = c.me();
        const space = c.memberSpace(id);
        if (space.ownerId === me.id) throw forbidden('The owner can’t leave. Settle up and delete the space instead.');
        if (!c.isSettled(space, me.id)) throw forbidden('Settle up first');
        space.memberIds = space.memberIds.filter((m) => m !== me.id);
      }),

    remove: (id) =>
      c.write(() => {
        const me = c.me();
        const space = c.memberSpace(id);
        if (space.ownerId !== me.id) throw forbidden('Only the owner can delete this space');
        if (!c.isSettled(space)) throw forbidden('Everyone must be settled up first');
        for (const m of space.memberIds.filter((x) => x !== me.id)) {
          c.notify(m, 'space_deleted', messages.spaceDeleted(c.firstOf(me.id), space.name), { space });
        }
        c.db.spaces = c.db.spaces.filter((s) => s.id !== id);
        c.db.expenses = c.db.expenses.filter((e) => e.spaceId !== id);
        c.db.settlements = c.db.settlements.filter((s) => s.spaceId !== id);
        // Everything else about the space goes with it; the "space deleted" cards stay, with the name copied onto them.
        c.db.notifications = c.db.notifications.filter((n) => n.spaceId !== id || n.type === 'space_deleted');
      }),
  };
}
