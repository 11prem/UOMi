import AsyncStorage from '@react-native-async-storage/async-storage';
import { computeSplit } from '../../domain/split';
import type { Expense } from '../../domain/types';
import { AppError } from '../errors';
import { createDemoServices } from '../demo';
import { STORAGE_KEY, type Storage } from '../demo/db';
import type { Services } from '../types';

const memoryStorage = (): Storage & { data: Map<string, string> } => {
  const data = new Map<string, string>();
  return {
    data,
    getItem: async (k) => data.get(k) ?? null,
    setItem: async (k, v) => void data.set(k, v),
  };
};

const START = 1_800_000_000_000;
function make(storage: Storage = memoryStorage()) {
  const clock = { now: START };
  const svc = createDemoServices(storage, { now: () => clock.now, delay: false });
  return { svc, clock, storage: storage as ReturnType<typeof memoryStorage> };
}
const signInAs = (svc: Services, username: string) => svc.auth.signIn(username, 'demo1234');
const actAs = (svc: Services, id: string) => svc.debug!.actAs(id);
const rejects = async (p: Promise<unknown>, code: string, message?: string | RegExp) => {
  const err = await p.then(
    () => null,
    (e) => e,
  );
  expect(err).toBeInstanceOf(AppError);
  expect(err.code).toBe(code);
  if (typeof message === 'string') expect(err.message).toBe(message);
  else if (message) expect(err.message).toMatch(message);
};

type ExpenseInput = Omit<Expense, 'id' | 'createdBy' | 'updatedAt'>;
function expenseInput(
  spaceId: string,
  paidBy: string,
  total: number,
  userIds: string[],
  opts: { type?: 'equal' | 'shares'; description?: string } = {},
): ExpenseInput {
  const type = opts.type ?? 'equal';
  const rows = userIds.map((userId) => ({ userId, input: type === 'shares' ? 1 : null }));
  return {
    spaceId,
    description: opts.description ?? 'Dinner',
    amountMinor: total,
    paidBy,
    splitType: type,
    date: START,
    shares: computeSplit(total, type, rows).amounts.map((a, i) => ({
      userId: a.userId,
      input: type === 'shares' ? null : rows[i].input, // null on a shares row means "1"
      amountMinor: a.amountMinor,
      response: 'pending' as const,
    })),
  };
}

/** kabir.r creates "Trip" with swetha.i and stays signed in as kabir.r. */
async function tripWithSwetha(svc: Services) {
  await signInAs(svc, 'kabir.r');
  return svc.spaces.create({ name: 'Trip', icon: 'trip', currency: 'INR', memberIds: ['u_swetha'] });
}

describe('seed', () => {
  it('seed balances match the plan table', async () => {
    const { svc } = make();
    await signInAs(svc, 'kabir.r');

    const rows = await svc.spaces.list();
    expect(
      rows.map((r) => ({
        name: r.space.name,
        currency: r.balance.currency,
        net: r.balance.netMinor,
        open: r.balance.openBalances,
        count: r.balance.counterpartyCount,
        who: r.balance.counterpartyName,
      })),
    ).toEqual([
      { name: 'Flat 4B', currency: 'INR', net: -47334, open: 2, count: 2, who: null },
      { name: 'Goa Trip', currency: 'INR', net: 1014000, open: 2, count: 2, who: null },
      { name: 'Dubai stopover', currency: 'USD', net: 3500, open: 1, count: 1, who: 'Meera Shah' },
      { name: 'Sunday cricket', currency: 'INR', net: 0, open: 2, count: 0, who: null },
      { name: 'Office lunches', currency: 'INR', net: 0, open: 0, count: 0, who: null },
    ]); // newest activity first
    const times = rows.map((r) => r.lastActivity);
    expect(times).toEqual([...times].sort((a, b) => b - a));

    expect(await svc.spaces.overall()).toEqual([
      { currency: 'INR', netMinor: 966666, oweMinor: 87334, owedMinor: 1054000 },
      { currency: 'USD', netMinor: 3500, oweMinor: 0, owedMinor: 3500 },
    ]);
  });

  it('has 10 expenses, 4 settlements and 7 notifications, with the message text built at creation', async () => {
    const { svc } = make();
    await signInAs(svc, 'kabir.r');
    expect(await svc.transactions.list({ kind: 'expenses' })).toHaveLength(10);
    expect(await svc.transactions.list({ kind: 'payments' })).toHaveLength(3); // the 4th is Rohan paying Priya
    expect(await svc.transactions.list({ kind: 'all', spaceId: 'sp_goa' })).toHaveLength(5);

    const cards = await svc.notifications.list();
    expect(cards.map((n) => n.type)).toEqual(['expense_share', 'payment_to_confirm', 'reminder', 'payment_answered', 'space_added']);
    expect(cards.filter((n) => n.needsAnswer)).toHaveLength(2);
    expect(await svc.notifications.unreadCount()).toBe(3);
    expect(cards[0]).toMatchObject({
      message: 'Swetha added ‘Dinner at Toit’ — your share is ₹480',
      spaceId: 'sp_flat',
      spaceName: 'Flat 4B',
      refId: 'e_toit',
    });
    expect(cards[1].message).toBe('Priya says they paid you ₹2,000');
    expect(cards[2].message).toBe('You owe Arun ₹400');
    expect(cards[3].message).toBe('Priya confirmed your ₹600 payment');
    expect(cards[4].message).toBe('Arun added you to ‘Goa Trip’');

    await actAs(svc, 'u_swetha');
    expect((await svc.notifications.list()).map((n) => [n.type, n.message])).toEqual([
      ['share_rejected', 'Priya rejected their ₹600 share of ‘Beach shack lunch’'],
    ]);
  });

  it('the Space page lists expenses and payments newest first, with my part of each', async () => {
    const { svc } = make();
    await signInAs(svc, 'kabir.r');
    const { activity, members, space } = await svc.spaces.get('sp_goa');
    expect(space.serial).toBe(398);
    expect(members.map((m) => m.username)).toEqual(['kabir.r', 'arun.n', 'swetha.i', 'priya.m']);
    expect(activity.map((a) => a.id)).toEqual(['st_pr', 'st_sw', 'e_shack', 'e_scoot', 'e_villa']);
    expect(activity.find((a) => a.id === 'e_shack')).toMatchObject({
      kind: 'expense',
      paidByName: 'Swetha Iyer',
      myPartMinor: 70000,
      myResponse: 'accepted',
      disputed: true,
    });
    expect(activity.find((a) => a.id === 'st_pr')).toMatchObject({ kind: 'payment', fromName: 'Priya Menon', toName: 'Kabir Rao', status: 'pending' });
    expect((await svc.spaces.get('sp_flat')).activity.find((a) => a.id === 'e_toit')).toMatchObject({ myPartMinor: 48000, myResponse: 'pending' });
  });

  it('calls other than auth need a signed-in user', async () => {
    const { svc } = make();
    await rejects(svc.spaces.list(), 'session_expired');
    expect(await svc.auth.restore()).toBeNull();
  });

  it('starts from a fresh seed when the stored data is unreadable', async () => {
    const storage = memoryStorage();
    storage.data.set(STORAGE_KEY, '{"version":1,"users":"nope"}');
    const { svc } = make(storage);
    await signInAs(svc, 'kabir.r');
    expect(await svc.spaces.list()).toHaveLength(5);
  });
});

describe('the money loop', () => {
  it('create space → expense → accept → pay → confirm', async () => {
    const { svc } = make();
    const space = await tripWithSwetha(svc);
    expect(space.serial).toBe(421); // 1 more than the highest seeded serial (420)
    expect(space.ownerId).toBe('u_kabir');
    const expense = await svc.expenses.create(expenseInput(space.id, 'u_kabir', 30000, ['u_kabir', 'u_swetha']));
    expect(expense).toMatchObject({ createdBy: 'u_kabir', amountMinor: 30000 });
    expect(expense.shares.map((s) => [s.userId, s.amountMinor, s.response])).toEqual([
      ['u_kabir', 15000, 'accepted'], // the creator and payer never have to answer their own share
      ['u_swetha', 15000, 'pending'],
    ]);
    const kabirBefore = (await svc.notifications.list()).length;

    // Swetha is asked to answer.
    await actAs(svc, 'u_swetha');
    const cards = await svc.notifications.list();
    expect(cards.map((n) => n.type)).toEqual(['expense_share', 'space_added', 'share_rejected']);
    expect(cards[0]).toMatchObject({
      needsAnswer: true,
      read: false,
      refId: expense.id,
      spaceId: space.id,
      message: 'Kabir added ‘Dinner’ — your share is ₹150',
    });
    expect(cards[1].message).toBe('Kabir added you to ‘Trip’');

    // Accepting sends nothing and settles the card.
    await svc.expenses.acceptShare(expense.id);
    expect((await svc.notifications.list())[0]).toMatchObject({ needsAnswer: false, read: true });
    await actAs(svc, 'u_kabir');
    expect(await svc.notifications.list()).toHaveLength(kabirBefore);

    // Swetha owes Kabir ₹150 and records the payment.
    expect((await svc.spaces.get(space.id)).balance).toMatchObject({ netMinor: 15000, counterpartyName: 'Swetha Iyer' });
    await actAs(svc, 'u_swetha');
    const payees = await svc.settlements.payees(space.id);
    expect(payees[0].maxMinor).toBe(15000);
    expect(payees[0].user.username).toBe('kabir.r');
    const payment = await svc.settlements.create({ spaceId: space.id, toUserId: 'u_kabir', amountMinor: 15000 });
    expect(payment).toMatchObject({ status: 'pending', fromUserId: 'u_swetha', toUserId: 'u_kabir', answeredAt: null });
    expect(await svc.settlements.payees(space.id)).toEqual([]); // the pending payment uses up the maximum, so no one is left to pay

    await actAs(svc, 'u_kabir');
    expect((await svc.notifications.list())[0]).toMatchObject({
      type: 'payment_to_confirm',
      needsAnswer: true,
      refId: payment.id,
      message: 'Swetha says they paid you ₹150',
    });
    expect((await svc.spaces.get(space.id)).balance.netMinor).toBe(15000); // pending payments don't move balances

    await svc.settlements.confirm(payment.id);
    const after = await svc.spaces.get(space.id);
    expect(after.balance).toMatchObject({ netMinor: 0, openBalances: 0, settled: true });
    expect((await svc.notifications.list()).find((n) => n.type === 'payment_to_confirm')).toMatchObject({ needsAnswer: false, read: true });

    await actAs(svc, 'u_swetha');
    expect((await svc.notifications.list())[0]).toMatchObject({
      type: 'payment_answered',
      needsAnswer: false,
      refId: payment.id,
      message: 'Kabir confirmed your ₹150 payment',
    });
    expect((await svc.settlements.get(payment.id)).settlement).toMatchObject({ status: 'confirmed', answeredAt: START });
  });

  it('reject makes the expense disputed and notifies its creator', async () => {
    const { svc } = make();
    const space = await tripWithSwetha(svc);
    const expense = await svc.expenses.create(expenseInput(space.id, 'u_kabir', 30000, ['u_kabir', 'u_swetha']));
    expect((await svc.spaces.get(space.id)).balance.netMinor).toBe(15000); // pending shares count

    await actAs(svc, 'u_swetha');
    await svc.expenses.rejectShare(expense.id);
    await actAs(svc, 'u_kabir');
    const card = (await svc.notifications.list())[0];
    expect(card).toMatchObject({
      type: 'share_rejected',
      needsAnswer: false,
      refId: expense.id,
      message: 'Swetha rejected their ₹150 share of ‘Dinner’',
    });
    const { balance, activity } = await svc.spaces.get(space.id);
    expect(balance).toMatchObject({ netMinor: 0, settled: true }); // disputed expenses stop counting
    expect(activity[0]).toMatchObject({ id: expense.id, disputed: true });
    expect((await svc.expenses.get(expense.id)).expense.shares[1].response).toBe('rejected');
  });

  it('editing resets every share to pending and re-notifies; only the creator can edit or delete', async () => {
    const { svc } = make();
    await signInAs(svc, 'kabir.r');
    const wifi = (await svc.expenses.get('e_wifi')).expense;
    const edited = { ...expenseInput('sp_flat', 'u_kabir', 118000, ['u_kabir', 'u_swetha', 'u_rohan'], { description: 'Wi-Fi bill (Nov)' }) };
    const saved = await svc.expenses.update(wifi.id, edited);
    expect(saved).toMatchObject({ id: 'e_wifi', description: 'Wi-Fi bill (Nov)', createdBy: 'u_kabir', updatedAt: START });
    expect(saved.shares.map((s) => s.response)).toEqual(['accepted', 'pending', 'pending']);

    await actAs(svc, 'u_swetha');
    const sw = (await svc.notifications.list()).filter((n) => n.refId === 'e_wifi');
    expect(sw).toEqual([expect.objectContaining({ type: 'expense_share', needsAnswer: true, read: false, message: 'Kabir added ‘Wi-Fi bill (Nov)’ — your share is ₹393.33' })]);
    // Re-saving replaces the earlier card rather than stacking another.
    await actAs(svc, 'u_kabir');
    await svc.expenses.update(wifi.id, edited);
    await actAs(svc, 'u_swetha');
    expect((await svc.notifications.list()).filter((n) => n.refId === 'e_wifi')).toHaveLength(1);

    await rejects(svc.expenses.update(wifi.id, edited), 'forbidden', /creator|added this expense/i);
    await rejects(svc.expenses.remove(wifi.id), 'forbidden', /added this expense/i);
    expect((await svc.expenses.get(wifi.id)).expense.id).toBe('e_wifi');

    await actAs(svc, 'u_kabir');
    await svc.expenses.remove(wifi.id);
    await rejects(svc.expenses.get(wifi.id), 'not_found');
    await actAs(svc, 'u_swetha');
    expect((await svc.notifications.list()).filter((n) => n.refId === 'e_wifi')).toHaveLength(0);
  });

  it('validates an expense and stores a shares row typed as null as 1', async () => {
    const { svc } = make();
    await signInAs(svc, 'kabir.r');
    const ok = expenseInput('sp_goa', 'u_kabir', 100000, ['u_kabir', 'u_arun', 'u_swetha', 'u_priya'], { type: 'shares' });
    const saved = await svc.expenses.create(ok);
    expect(saved.shares.map((s) => s.input)).toEqual([1, 1, 1, 1]);

    const off = { ...ok, shares: ok.shares.map((s, i) => (i === 0 ? { ...s, amountMinor: s.amountMinor + 1 } : s)) };
    await rejects(svc.expenses.create(off), 'validation_error');
    await rejects(svc.expenses.create({ ...ok, description: '  ' }), 'validation_error');
    await rejects(svc.expenses.create({ ...ok, amountMinor: 0 }), 'validation_error');
    await rejects(svc.expenses.create({ ...ok, paidBy: 'u_meera' }), 'validation_error'); // not a member of Goa Trip
    await rejects(svc.expenses.create({ ...ok, spaceId: 'sp_nope' }), 'not_found');
    await actAs(svc, 'u_meera');
    await rejects(svc.expenses.create(ok), 'not_found'); // Meera is not in Goa Trip
  });

  it('only the share’s owner answers it, and the answer is idempotent', async () => {
    const { svc } = make();
    await signInAs(svc, 'kabir.r');
    await rejects(svc.expenses.acceptShare('e_wifi'), 'forbidden'); // Kabir's own share is accepted automatically
    await actAs(svc, 'u_arun');
    await rejects(svc.expenses.acceptShare('e_wifi'), 'not_found'); // Arun is not in Flat 4B
    await actAs(svc, 'u_kabir');
    await svc.expenses.acceptShare('e_toit'); // pending -> accepted, card resolved
    await svc.expenses.acceptShare('e_toit');
    expect((await svc.notifications.list()).find((n) => n.refId === 'e_toit')).toMatchObject({ needsAnswer: false, read: true });
    await actAs(svc, 'u_swetha');
    expect((await svc.notifications.list()).filter((n) => n.type === 'share_rejected')).toHaveLength(1); // still just the seeded card
  });
});

describe('settlements', () => {
  it('caps the amount, checks who may answer, and cancel removes the receiver’s card', async () => {
    const { svc } = make();
    await signInAs(svc, 'swetha.i');
    // In Flat 4B Swetha owes Rohan 30000 (78000 groceries less the 48000 he owes her for dinner).
    expect(await svc.settlements.payees('sp_flat')).toEqual([expect.objectContaining({ maxMinor: 30000, user: expect.objectContaining({ username: 'rohan.d' }) })]);
    await rejects(svc.settlements.create({ spaceId: 'sp_flat', toUserId: 'u_rohan', amountMinor: 30001 }), 'validation_error');
    await rejects(svc.settlements.create({ spaceId: 'sp_flat', toUserId: 'u_rohan', amountMinor: 0 }), 'validation_error');
    await rejects(svc.settlements.create({ spaceId: 'sp_flat', toUserId: 'u_kabir', amountMinor: 100 }), 'forbidden'); // she doesn't owe Kabir
    await rejects(svc.settlements.create({ spaceId: 'sp_goa', toUserId: 'u_kabir', amountMinor: 100 }), 'forbidden'); // owed, not owing

    const first = await svc.settlements.create({ spaceId: 'sp_flat', toUserId: 'u_rohan', amountMinor: 12000 });
    expect((await svc.settlements.payees('sp_flat'))[0].maxMinor).toBe(18000);
    await rejects(svc.settlements.create({ spaceId: 'sp_flat', toUserId: 'u_rohan', amountMinor: 18001 }), 'validation_error');
    const second = await svc.settlements.create({ spaceId: 'sp_flat', toUserId: 'u_rohan', amountMinor: 18000 });

    await rejects(svc.settlements.confirm(first.id), 'forbidden'); // only the receiver answers
    await rejects(svc.settlements.reject(first.id), 'forbidden');
    await actAs(svc, 'u_kabir');
    await rejects(svc.settlements.confirm(first.id), 'forbidden');
    await rejects(svc.settlements.cancel(first.id), 'forbidden'); // only the person who recorded it cancels

    await actAs(svc, 'u_rohan');
    expect((await svc.notifications.list())[0]).toMatchObject({ type: 'payment_to_confirm', refId: second.id });
    await svc.settlements.reject(first.id);
    await rejects(svc.settlements.confirm(first.id), 'forbidden'); // already answered

    await actAs(svc, 'u_swetha');
    expect((await svc.notifications.list())[0]).toMatchObject({ type: 'payment_answered', message: 'Rohan rejected your ₹120 payment' });
    await svc.settlements.cancel(second.id);
    expect((await svc.settlements.get(second.id)).settlement).toMatchObject({ status: 'cancelled', answeredAt: START });
    await rejects(svc.settlements.cancel(second.id), 'forbidden');
    await actAs(svc, 'u_rohan');
    expect((await svc.notifications.list()).filter((n) => n.refId === second.id)).toHaveLength(0);

    // A confirmed payment cannot be cancelled.
    await actAs(svc, 'u_swetha');
    const third = await svc.settlements.create({ spaceId: 'sp_flat', toUserId: 'u_rohan', amountMinor: 30000 });
    await actAs(svc, 'u_rohan');
    await svc.settlements.confirm(third.id);
    await actAs(svc, 'u_swetha');
    await rejects(svc.settlements.cancel(third.id), 'forbidden', /confirmed/i);
    expect(await svc.settlements.payees('sp_flat')).toEqual([]);
  });

  it('settlement detail returns both people and only to members of the space', async () => {
    const { svc } = make();
    await signInAs(svc, 'kabir.r');
    const d = await svc.settlements.get('st_pr');
    expect([d.settlement.id, d.space.name, d.from.username, d.to.username]).toEqual(['st_pr', 'Goa Trip', 'priya.m', 'kabir.r']);
    await rejects(svc.settlements.get('st_nope'), 'not_found');
    await actAs(svc, 'u_meera');
    await rejects(svc.settlements.get('st_pr'), 'not_found');
  });
});

describe('spaces', () => {
  it('only the owner deletes, and only when everyone is settled; members are told with the space name kept', async () => {
    const { svc } = make();
    const space = await tripWithSwetha(svc);
    await svc.spaces.addMembers(space.id, ['u_arun', 'u_swetha']); // Swetha is already in: skipped
    expect((await svc.spaces.get(space.id)).members.map((m) => m.username)).toEqual(['kabir.r', 'swetha.i', 'arun.n']);

    await actAs(svc, 'u_swetha');
    await rejects(svc.spaces.remove(space.id), 'forbidden', /owner/i);
    await actAs(svc, 'u_kabir');
    await rejects(svc.spaces.remove('sp_dubai'), 'forbidden', /settle/i); // Meera still owes him $35

    await svc.spaces.remove(space.id);
    await rejects(svc.spaces.get(space.id), 'not_found');
    expect((await svc.spaces.list()).map((r) => r.space.id)).not.toContain(space.id);
    for (const id of ['u_swetha', 'u_arun']) {
      await actAs(svc, id);
      const gone = (await svc.notifications.list()).find((n) => n.type === 'space_deleted');
      expect(gone).toMatchObject({ spaceId: space.id, spaceName: 'Trip', message: 'Kabir deleted ‘Trip’', needsAnswer: false, read: false });
      expect((await svc.notifications.list()).some((n) => n.type === 'space_added' && n.spaceId === space.id)).toBe(false);
    }
    await actAs(svc, 'u_kabir');
    expect((await svc.notifications.list()).some((n) => n.type === 'space_deleted')).toBe(false); // the deleter is not told
    const again = await svc.spaces.create({ name: 'Trip 2', icon: 'trip', currency: 'INR', memberIds: ['u_swetha'] });
    expect(again.serial).toBe(421); // max of what exists + 1
  });

  it('the owner cannot leave; others leave only when settled up', async () => {
    const { svc } = make();
    await signInAs(svc, 'kabir.r');
    await rejects(svc.spaces.leave('sp_flat'), 'forbidden', /owner/i);
    await rejects(svc.spaces.leave('sp_cricket'), 'forbidden', 'Settle up first'); // not the owner, but 2 open balances
    await svc.spaces.leave('sp_office'); // settled up, owner is Priya
    await rejects(svc.spaces.get('sp_office'), 'not_found');
    expect((await svc.spaces.list()).map((r) => r.space.name)).not.toContain('Office lunches');
  });

  it('removing a member is for the owner and needs that member settled up', async () => {
    const { svc } = make();
    await signInAs(svc, 'kabir.r');
    await rejects(svc.spaces.removeMember('sp_flat', 'u_swetha'), 'forbidden', 'Settle up first');
    await rejects(svc.spaces.removeMember('sp_flat', 'u_kabir'), 'forbidden'); // the owner can't be removed
    const space = await svc.spaces.create({ name: 'Trip', icon: 'trip', currency: 'INR', memberIds: ['u_swetha', 'u_arun'] });
    await actAs(svc, 'u_swetha');
    await rejects(svc.spaces.removeMember(space.id, 'u_arun'), 'forbidden', /owner/i);
    await actAs(svc, 'u_kabir');
    await svc.spaces.removeMember(space.id, 'u_arun');
    expect((await svc.spaces.get(space.id)).members.map((m) => m.username)).toEqual(['kabir.r', 'swetha.i']);
  });

  it('anyone renames; only the owner changes the currency, and only before the first expense', async () => {
    const { svc } = make();
    const space = await tripWithSwetha(svc);
    await actAs(svc, 'u_swetha');
    expect(await svc.spaces.update(space.id, { name: '  Goa again ', icon: 'party' })).toMatchObject({ name: 'Goa again', icon: 'party' });
    await rejects(svc.spaces.update(space.id, { currency: 'USD' }), 'forbidden', /owner/i);
    await rejects(svc.spaces.update(space.id, { name: '' }), 'validation_error');
    await actAs(svc, 'u_kabir');
    expect(await svc.spaces.update(space.id, { currency: 'USD' })).toMatchObject({ currency: 'USD', name: 'Goa again' });
    await svc.expenses.create(expenseInput(space.id, 'u_kabir', 1000, ['u_kabir', 'u_swetha']));
    await rejects(svc.spaces.update(space.id, { currency: 'EUR' }), 'forbidden', 'Can’t change after expenses are added');
    expect(await svc.spaces.update(space.id, { currency: 'USD' })).toMatchObject({ currency: 'USD' }); // unchanged is fine
  });

  it('create validates and tells the people added', async () => {
    const { svc } = make();
    await signInAs(svc, 'kabir.r');
    await rejects(svc.spaces.create({ name: ' ', icon: 'home', currency: 'INR', memberIds: ['u_swetha'] }), 'validation_error');
    await rejects(svc.spaces.create({ name: 'x'.repeat(31), icon: 'home', currency: 'INR', memberIds: ['u_swetha'] }), 'validation_error');
    await rejects(svc.spaces.create({ name: 'Ok', icon: 'home', currency: 'INR', memberIds: ['u_nobody'] }), 'not_found');
    const s = await svc.spaces.create({ name: ' Lake ', icon: 'trip', currency: 'GBP', memberIds: ['u_meera', 'u_kabir', 'u_meera'] });
    expect(s).toMatchObject({ name: 'Lake', currency: 'GBP', memberIds: ['u_kabir', 'u_meera'] }); // creator first, no duplicates
    await actAs(svc, 'u_meera');
    expect((await svc.notifications.list())[0]).toMatchObject({ type: 'space_added', message: 'Kabir added you to ‘Lake’', spaceName: 'Lake' });
  });

  it('returns copies: changing a result never changes the stored data', async () => {
    const { svc } = make();
    await signInAs(svc, 'kabir.r');
    const got = await svc.spaces.get('sp_flat');
    got.space.name = 'Changed';
    got.activity.length = 0;
    const again = await svc.spaces.get('sp_flat');
    expect(again.space.name).toBe('Flat 4B');
    expect(again.activity.length).toBeGreaterThan(0);
  });
});

describe('notifications and transactions', () => {
  it('mark read, mark all read and the unread count', async () => {
    const { svc } = make();
    await signInAs(svc, 'kabir.r');
    const cards = await svc.notifications.list();
    await svc.notifications.markRead(cards[2].id); // the reminder
    expect(await svc.notifications.unreadCount()).toBe(2);
    await rejects(svc.notifications.markRead('n_nope'), 'not_found');
    await actAs(svc, 'u_swetha');
    await rejects(svc.notifications.markRead(cards[0].id), 'not_found'); // not hers
    await actAs(svc, 'u_kabir');
    await svc.notifications.markAllRead();
    expect(await svc.notifications.unreadCount()).toBe(0);
    await actAs(svc, 'u_swetha');
    expect(await svc.notifications.unreadCount()).toBe(1); // only the viewer's own cards
  });

  it('transactions filter by kind and space', async () => {
    const { svc } = make();
    await signInAs(svc, 'kabir.r');
    const rows = await svc.transactions.list({ kind: 'all' });
    expect(rows).toHaveLength(13);
    const dates = rows.map((r) => r.date);
    expect(dates).toEqual([...dates].sort((a, b) => b - a));
    expect(rows.find((r) => r.id === 'e_taxi')).toMatchObject({ spaceId: 'sp_dubai', spaceName: 'Dubai stopover', currency: 'USD', kind: 'expense' });
    expect(await svc.transactions.list({ kind: 'payments', spaceId: 'sp_office' })).toHaveLength(1);
    expect(await svc.transactions.list({ kind: 'expenses', spaceId: 'sp_nope' })).toEqual([]);
  });
});

describe('auth', () => {
  it('sign in: one message for a wrong username or password', async () => {
    const { svc } = make();
    await rejects(svc.auth.signIn('kabir.r', 'wrong'), 'invalid_credentials', 'Username or password is incorrect');
    await rejects(svc.auth.signIn('nobody', 'demo1234'), 'invalid_credentials', 'Username or password is incorrect');
    expect(await svc.auth.signIn('  Kabir.R ', 'demo1234')).toMatchObject({ id: 'u_kabir', name: 'Kabir Rao' });
    expect((await svc.auth.restore())?.username).toBe('kabir.r');
    await svc.auth.signOut();
    expect(await svc.auth.restore()).toBeNull();
  });

  it('sign up needs the code, then creates and signs in the account', async () => {
    const { svc } = make();
    const input = { username: 'Newbie_1', name: ' New Bie ', phone: '+919812345678', password: 'abcd1234' };
    expect(await svc.auth.checkUsername('newbie_1')).toBe(true);
    expect(await svc.auth.checkPhone('+919812345678')).toBe(true);
    const { pendingId, maskedPhone } = await svc.auth.signUp(input);
    expect(maskedPhone).toBe('+91 98******78');
    expect(await svc.auth.checkUsername('newbie_1')).toBe(true); // nothing exists until verified
    expect(await svc.auth.restore()).toBeNull();

    const user = await svc.auth.verifySignUpOtp(pendingId, '123456');
    expect(user).toMatchObject({ username: 'newbie_1', name: 'New Bie', phone: '+919812345678', phoneVerified: true, avatarUrl: null });
    expect((await svc.auth.restore())?.id).toBe(user.id);
    expect(await svc.auth.checkUsername('newbie_1')).toBe(false);
    expect(await svc.auth.checkPhone('+919812345678')).toBe(false);
    expect(await svc.spaces.list()).toEqual([]); // empty state for a new user
    expect((await svc.profile.getPreferences()).defaultCurrency).toBe('INR'); // from the +91 phone
    await svc.auth.signOut();
    expect(await svc.auth.signIn('newbie_1', 'abcd1234')).toMatchObject({ id: user.id });

    await rejects(svc.auth.signUp({ ...input, username: 'kabir.r' }), 'username_taken', 'Username already taken');
    await rejects(svc.auth.signUp({ ...input, username: 'someone', phone: '+919845012331' }), 'phone_taken', 'Phone number already registered');
    await rejects(svc.auth.signUp({ ...input, username: 'ab' }), 'validation_error');
    await rejects(svc.auth.signUp({ ...input, username: 'someone', password: 'short1' }), 'validation_error');
    await rejects(svc.auth.signUp({ ...input, username: 'someone', password: 'allletters' }), 'validation_error');
    await rejects(svc.auth.signUp({ ...input, username: 'someone', phone: '98123' }), 'validation_error');
  });

  it('otp rules: wrong code, 5 wrong locks for 10 minutes, 5-minute expiry, resend', async () => {
    const { svc, clock } = make();
    const input = { username: 'newbie', name: 'New Bie', phone: '+919812345678', password: 'abcd1234' };

    // A wrong code, then the right one.
    const a = await svc.auth.signUp(input);
    await rejects(svc.auth.verifySignUpOtp(a.pendingId, '000000'), 'invalid_code', 'That code is incorrect');
    await rejects(svc.auth.verifySignUpOtp('pend_nope', '123456'), 'not_found');
    expect(await svc.auth.verifySignUpOtp(a.pendingId, '123456')).toMatchObject({ username: 'newbie' });
    await svc.auth.signOut();

    // Four wrong codes still allow the right one.
    const b = await svc.auth.signUp({ ...input, username: 'newbie2', phone: '+919812345679' });
    for (let i = 0; i < 4; i++) await rejects(svc.auth.verifySignUpOtp(b.pendingId, '111111'), 'invalid_code');
    expect((await svc.auth.verifySignUpOtp(b.pendingId, '123456')).username).toBe('newbie2');
    await svc.auth.signOut();

    // The 5th wrong code locks, even for the right code, until 10 minutes pass.
    const c = await svc.auth.signUp({ ...input, username: 'newbie3', phone: '+919812345670' });
    for (let i = 0; i < 4; i++) await rejects(svc.auth.verifySignUpOtp(c.pendingId, '111111'), 'invalid_code');
    const locked = await svc.auth.verifySignUpOtp(c.pendingId, '111111').catch((e) => e);
    expect(locked).toMatchObject({ code: 'otp_locked', message: 'Too many attempts — try again in 10 minutes', extra: { retry_after_seconds: 600 } });
    await rejects(svc.auth.verifySignUpOtp(c.pendingId, '123456'), 'otp_locked');
    await rejects(svc.auth.resendOtp(c.pendingId), 'otp_locked');
    clock.now += 10 * 60_000 + 1;
    await rejects(svc.auth.verifySignUpOtp(c.pendingId, '123456'), 'code_expired', 'Code expired — resend'); // 5 minutes passed long ago
    expect(await svc.auth.resendOtp(c.pendingId)).toEqual({ resendAfterSeconds: 30 });
    expect((await svc.auth.verifySignUpOtp(c.pendingId, '123456')).username).toBe('newbie3');
    await svc.auth.signOut();

    // Expiry: valid for 5 minutes from the last send.
    const d = await svc.auth.signUp({ ...input, username: 'newbie4', phone: '+919812345671' });
    clock.now += 5 * 60_000;
    await rejects(svc.auth.verifySignUpOtp(d.pendingId, '000000'), 'invalid_code'); // still within 5 minutes
    clock.now += 1;
    await rejects(svc.auth.verifySignUpOtp(d.pendingId, '123456'), 'code_expired');
    await svc.auth.resendOtp(d.pendingId);
    expect((await svc.auth.verifySignUpOtp(d.pendingId, '123456')).username).toBe('newbie4');
  });

  it('forgot password: username, masked phone, code, new password', async () => {
    const { svc } = make();
    await rejects(svc.auth.requestResetOtp('nobody'), 'unknown_username', 'We couldn’t find that username');
    const { resetId, maskedPhone } = await svc.auth.requestResetOtp(' Swetha.I ');
    expect(maskedPhone).toBe('+91 98******44');
    await rejects(svc.auth.verifyResetOtp(resetId, '654321'), 'invalid_code');
    expect(await svc.auth.resendOtp(resetId)).toEqual({ resendAfterSeconds: 30 });
    const { resetToken } = await svc.auth.verifyResetOtp(resetId, '123456');
    await rejects(svc.auth.resetPassword(resetToken, 'weak'), 'validation_error');
    expect(await svc.auth.resetPassword(resetToken, 'newpass99')).toEqual({ username: 'swetha.i' });
    await rejects(svc.auth.resetPassword(resetToken, 'newpass99'), 'not_found'); // single use
    await rejects(svc.auth.signIn('swetha.i', 'demo1234'), 'invalid_credentials');
    expect((await svc.auth.signIn('swetha.i', 'newpass99')).id).toBe('u_swetha');
  });

  it('search follows specs § 6.2', async () => {
    const { svc } = make();
    await signInAs(svc, 'kabir.r');
    const names = async (q: string) => (await svc.users.search(q)).map((u) => u.username);
    expect(await names('9880213344')).toEqual(['swetha.i']); // national digits read in the viewer's country (+91)
    expect(await names('98802 13344')).toEqual(['swetha.i']);
    expect(await names('+91 98802-13344')).toEqual(['swetha.i']);
    expect(await names('+971501234567')).toEqual(['meera.s']); // a typed dial code wins
    expect(await names('501234567')).toEqual([]); // that is +91 501234567
    expect(await names('98802')).toEqual([]); // never a partial number
    expect(await names('+9198802')).toEqual([]);
    expect(await names('9845012331')).toEqual([]); // the viewer is never returned
    expect(await names('sw')).toEqual(['swetha.i']);
    expect(await names('SWETHA.')).toEqual(['swetha.i']);
    expect(await names('@arun')).toEqual(['arun.n']);
    expect(await names('r')).toEqual(['rohan.d']); // not kabir.r: prefix, and not the viewer
    expect(await names('kabir')).toEqual([]);
    expect(await names('wetha')).toEqual([]); // prefix, not substring
    expect(await names('  ')).toEqual([]);
    expect(await names('@')).toEqual([]);
    await actAs(svc, 'u_meera');
    expect(await names('9845012331')).toEqual([]); // read as +971 9845012331
    expect(await names('+919845012331')).toEqual(['kabir.r']);
  });
});

describe('profile', () => {
  it('reads and updates the user and the preferences', async () => {
    const { svc } = make();
    await signInAs(svc, 'kabir.r');
    expect(await svc.profile.update({ name: '  Kabir R. Rao ' })).toMatchObject({ name: 'Kabir R. Rao', username: 'kabir.r' });
    expect(await svc.profile.update({ avatarUrl: 'file:///a.jpg' })).toMatchObject({ avatarUrl: 'file:///a.jpg', name: 'Kabir R. Rao' });
    expect((await svc.profile.update({ avatarUrl: null })).avatarUrl).toBeNull();
    await rejects(svc.profile.update({ name: ' ' }), 'validation_error');
    expect((await svc.profile.get()).name).toBe('Kabir R. Rao');
    expect(await svc.profile.getPreferences()).toEqual({ defaultCurrency: 'INR', theme: 'system', notificationsOn: true });
    await svc.profile.setPreferences({ defaultCurrency: 'USD', theme: 'dark', notificationsOn: false });
    expect(await svc.profile.getPreferences()).toEqual({ defaultCurrency: 'USD', theme: 'dark', notificationsOn: false });
  });
});

describe('persistence', () => {
  it('survives an app restart: same session, same data', async () => {
    const { svc, storage } = make();
    const space = await tripWithSwetha(svc);
    await svc.expenses.create(expenseInput(space.id, 'u_kabir', 30000, ['u_kabir', 'u_swetha']));
    expect(storage.data.has(STORAGE_KEY)).toBe(true);

    const { svc: reopened } = make(storage); // a new process reading the same storage
    expect(await reopened.auth.restore()).toMatchObject({ id: 'u_kabir', username: 'kabir.r' });
    const rows = await reopened.spaces.list();
    expect(rows).toHaveLength(6);
    expect(rows.find((r) => r.space.id === space.id)?.balance.netMinor).toBe(15000);
    expect((await reopened.notifications.list()).length).toBe(5); // nothing lost, nothing duplicated
    await actAs(reopened, 'u_swetha');
    expect(((await make(storage).svc.auth.restore()))?.id).toBe('u_swetha'); // "Act as" is part of the saved session
  });

  it('every write is saved, a read is not required to save', async () => {
    const { svc, storage } = make();
    await signInAs(svc, 'kabir.r');
    await svc.notifications.markAllRead();
    const saved = JSON.parse(storage.data.get(STORAGE_KEY)!);
    expect(saved.notifications.filter((n: { userId: string; read: boolean }) => n.userId === 'u_kabir').every((n: { read: boolean }) => n.read)).toBe(true);
    expect(saved.session.userId).toBe('u_kabir');
  });

  it('Reset demo data restores the seed and signs out', async () => {
    const { svc } = make();
    const space = await tripWithSwetha(svc);
    await svc.profile.setPreferences({ defaultCurrency: 'INR', theme: 'dark', notificationsOn: true });
    await svc.debug!.resetDemoData();
    expect(await svc.auth.restore()).toBeNull();
    await signInAs(svc, 'kabir.r');
    expect((await svc.spaces.list()).map((r) => r.space.id)).not.toContain(space.id);
    expect((await svc.profile.getPreferences()).theme).toBe('dark'); // the theme is kept
  });
});

describe('defaults', () => {
  it('uses AsyncStorage and no fake delay when given nothing (under jest)', async () => {
    const svc = createDemoServices();
    const t0 = Date.now();
    await svc.auth.signIn('kabir.r', 'demo1234');
    expect(Date.now() - t0).toBeLessThan(250);
    expect(JSON.parse((await AsyncStorage.getItem(STORAGE_KEY))!).session.userId).toBe('u_kabir');
  });

  it('waits 300–800 ms per call when the delay is on', async () => {
    const svc = createDemoServices(memoryStorage(), { delay: true });
    const t0 = Date.now();
    await svc.auth.restore();
    expect(Date.now() - t0).toBeGreaterThanOrEqual(295);
    expect(Date.now() - t0).toBeLessThan(2000);
  });
});

describe('debug switches', () => {
  it('simulated errors fail every data call; offline fails writes but not reads; debug and restore keep working', async () => {
    const { svc } = make();
    await signInAs(svc, 'kabir.r');
    expect(await svc.debug!.state()).toEqual({ simulateErrors: false, offline: false });

    await svc.debug!.setSimulateErrors(true);
    await rejects(svc.spaces.list(), 'simulated');
    await rejects(svc.notifications.markAllRead(), 'simulated');
    expect(await svc.auth.restore()).toMatchObject({ id: 'u_kabir' });
    expect(await svc.debug!.state()).toEqual({ simulateErrors: true, offline: false });
    await svc.debug!.setSimulateErrors(false);
    expect(await svc.spaces.list()).toHaveLength(5);

    await svc.debug!.setOffline(true);
    expect(await svc.spaces.list()).toHaveLength(5); // last saved data
    await rejects(svc.notifications.markAllRead(), 'network');
    await rejects(svc.spaces.create({ name: 'X', icon: 'home', currency: 'INR', memberIds: [] }), 'network');
    expect((await svc.debug!.users()).map((u) => u.username)).toEqual(['kabir.r', 'swetha.i', 'arun.n', 'meera.s', 'rohan.d', 'priya.m']);
    await svc.debug!.setOffline(false);
    await svc.notifications.markAllRead();
    expect(await svc.notifications.unreadCount()).toBe(0);
  });

  it('is a demo-mode service', () => {
    const { svc } = make();
    expect(svc.mode).toBe('demo');
    expect(svc.debug).not.toBeNull();
  });
});
