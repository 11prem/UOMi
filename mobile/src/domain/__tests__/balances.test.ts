import { overall, pairKey, pairwise, settleMax, spaceBalance } from '../balances';
import type {
  Currency,
  Expense,
  Settlement,
  SettlementStatus,
  Share,
  ShareResponse,
  Space,
  SpaceBalance,
} from '../types';

const NAMES: Record<string, string> = {
  me: 'Kabir Rao',
  sw: 'Swetha Iyer',
  ar: 'Arun Nair',
  u_kabir: 'Kabir Rao',
  u_swetha: 'Swetha Iyer',
  u_arun: 'Arun Nair',
  u_meera: 'Meera Shah',
  u_rohan: 'Rohan Das',
  u_priya: 'Priya Menon',
};
const nameOf = (id: string) => NAMES[id] ?? id;

const mkSpace = (id: string, currency: Currency, memberIds: string[]): Space => ({
  id,
  name: id,
  icon: 'home',
  currency,
  ownerId: memberIds[0],
  memberIds,
  serial: 1,
  createdAt: 0,
});
const mkShare = (userId: string, amountMinor: number, response: ShareResponse = 'accepted'): Share => ({
  userId,
  input: null,
  amountMinor,
  response,
});
let n = 0;
const mkExpense = (spaceId: string, paidBy: string, shares: Share[]): Expense => ({
  id: `e${++n}`,
  spaceId,
  description: 'x',
  amountMinor: shares.reduce((a, s) => a + s.amountMinor, 0),
  paidBy,
  splitType: 'exact',
  shares,
  date: 0,
  createdBy: paidBy,
  updatedAt: 0,
});
const mkSettlement = (
  spaceId: string,
  fromUserId: string,
  toUserId: string,
  amountMinor: number,
  status: SettlementStatus,
): Settlement => ({
  id: `s${++n}`,
  spaceId,
  fromUserId,
  toUserId,
  amountMinor,
  date: 0,
  status,
  answeredAt: null,
});

const space = mkSpace('s1', 'INR', ['me', 'sw', 'ar']);
const balance = (expenses: Expense[], settlements: Settlement[] = []) =>
  spaceBalance(space, expenses, settlements, 'me', nameOf);

describe('pairwise', () => {
  it('records who owes whom, netted, and never counts the payer’s own share', () => {
    const m = pairwise(
      [
        mkExpense('s1', 'sw', [mkShare('me', 1500), mkShare('sw', 1500)]),
        mkExpense('s1', 'me', [mkShare('me', 400), mkShare('sw', 400)]),
      ],
      [],
    );
    expect(m.get(pairKey('me', 'sw'))).toBe(1100);
    expect(m.has(pairKey('sw', 'me'))).toBe(false);
    expect(m.size).toBe(1);
  });

  it('flips a pair when a confirmed payment is bigger than the debt', () => {
    const m = pairwise(
      [mkExpense('s1', 'sw', [mkShare('me', 1000)])],
      [mkSettlement('s1', 'me', 'sw', 1500, 'confirmed')],
    );
    expect([...m]).toEqual([[pairKey('sw', 'me'), 500]]);
    expect([...pairwise([], [mkSettlement('s1', 'me', 'sw', 500, 'confirmed')])]).toEqual([
      [pairKey('sw', 'me'), 500],
    ]);
  });
});

describe('spaceBalance', () => {
  it('counts shares that are still pending', () => {
    const b = balance([mkExpense('s1', 'sw', [mkShare('me', 1500, 'pending'), mkShare('sw', 1500)])]);
    expect(b.netMinor).toBe(-1500);
    expect(b.openBalances).toBe(1);
    expect(b.settled).toBe(false);
  });

  it('leaves a disputed expense out until it is fixed', () => {
    const disputed = mkExpense('s1', 'sw', [
      mkShare('me', 1500),
      mkShare('ar', 1500, 'rejected'),
      mkShare('sw', 1500),
    ]);
    const b = balance([disputed]);
    expect(b.netMinor).toBe(0);
    expect(b.openBalances).toBe(0);
    expect(b.settled).toBe(true);
    // a rejected share on one expense does not poison the others
    const ok = mkExpense('s1', 'sw', [mkShare('me', 700), mkShare('sw', 700)]);
    expect(balance([disputed, ok]).netMinor).toBe(-700);
  });

  it('applies confirmed settlements only; pending ones only lower the Settle Up maximum', () => {
    const expenses = [mkExpense('s1', 'sw', [mkShare('me', 1500), mkShare('sw', 1500)])];
    const settlements = [
      mkSettlement('s1', 'me', 'sw', 500, 'confirmed'),
      mkSettlement('s1', 'me', 'sw', 300, 'pending'),
      mkSettlement('s1', 'me', 'sw', 200, 'rejected'),
      mkSettlement('s1', 'me', 'sw', 100, 'cancelled'),
    ];
    expect(balance(expenses, settlements).netMinor).toBe(-1000);
    expect(settleMax(space, expenses, settlements, 'me', 'sw')).toBe(700);
    expect(settleMax(space, expenses, [], 'me', 'sw')).toBe(1500);
    expect(settleMax(space, expenses, settlements, 'sw', 'me')).toBe(0);
  });

  it('puts the people on the side of the net in the counterparty fields', () => {
    const b = balance([
      mkExpense('s1', 'sw', [mkShare('me', 3000), mkShare('sw', 3000)]),
      mkExpense('s1', 'me', [mkShare('ar', 500), mkShare('me', 500)]),
    ]);
    expect(b.netMinor).toBe(-2500);
    expect(b.openBalances).toBe(2);
    expect(b.counterpartyCount).toBe(1);
    expect(b.counterpartyName).toBe('Swetha Iyer'); // full name; phrases shows the first word
    expect(b.pairs).toEqual([
      { userId: 'sw', name: 'Swetha Iyer', netMinor: -3000 },
      { userId: 'ar', name: 'Arun Nair', netMinor: 500 },
    ]);
  });

  it('with several people on the side of the net there is no single name', () => {
    const b = balance([
      mkExpense('s1', 'sw', [mkShare('me', 1000)]),
      mkExpense('s1', 'ar', [mkShare('me', 1000)]),
    ]);
    expect(b.counterpartyCount).toBe(2);
    expect(b.counterpartyName).toBeNull();
  });

  it('net zero with two open balances has nobody on its side and is not settled', () => {
    const b = balance([
      mkExpense('s1', 'sw', [mkShare('me', 1000)]),
      mkExpense('s1', 'me', [mkShare('ar', 1000)]),
    ]);
    expect(b.netMinor).toBe(0);
    expect(b.openBalances).toBe(2);
    expect(b.counterpartyCount).toBe(0);
    expect(b.counterpartyName).toBeNull();
    expect(b.settled).toBe(false);
  });

  it('ignores other spaces’ expenses and settlements', () => {
    const b = balance(
      [mkExpense('other', 'sw', [mkShare('me', 1000)])],
      [mkSettlement('other', 'me', 'sw', 1000, 'confirmed')],
    );
    expect(b).toMatchObject({ spaceId: 's1', currency: 'INR', netMinor: 0, settled: true });
  });
});

describe('overall', () => {
  const bal = (currency: Currency, ...nets: number[]): SpaceBalance => ({
    spaceId: 'x',
    currency,
    netMinor: nets.reduce((a, b) => a + b, 0),
    pairs: nets.map((netMinor, i) => ({ userId: `u${i}`, name: `U${i}`, netMinor })),
    openBalances: nets.filter((x) => x !== 0).length,
    counterpartyName: null,
    counterpartyCount: 0,
    settled: nets.every((x) => x === 0),
  });

  it('sums per currency and never across currencies', () => {
    expect(overall([bal('INR', -2000, 1000), bal('USD', 3500), bal('INR', 500)])).toEqual([
      { currency: 'INR', netMinor: -500, oweMinor: 2000, owedMinor: 1500 },
      { currency: 'USD', netMinor: 3500, oweMinor: 0, owedMinor: 3500 },
    ]);
  });

  it('lists only currencies with something owed or owing', () => {
    expect(overall([bal('INR', 0, 0), bal('USD')])).toEqual([]);
    expect(overall([])).toEqual([]);
  });
});

describe('seed data (values shared with the backend, viewer kabir.r)', () => {
  const [K, S, A, M, R, P] = ['u_kabir', 'u_swetha', 'u_arun', 'u_meera', 'u_rohan', 'u_priya'];
  const spaces = [
    mkSpace('sp_flat', 'INR', [K, S, R]),
    mkSpace('sp_goa', 'INR', [K, A, S, P]),
    mkSpace('sp_office', 'INR', [K, P, R]),
    mkSpace('sp_dubai', 'USD', [K, M]),
    mkSpace('sp_cricket', 'INR', [K, A, R]),
  ];
  const ex = (sp: string, paidBy: string, shares: [string, number, ShareResponse?][]) =>
    mkExpense(sp, paidBy, shares.map(([u, a, r]) => mkShare(u, a, r)));
  const expenses = [
    ex('sp_flat', R, [[K, 78000], [S, 78000], [R, 78000]]),
    ex('sp_flat', K, [[K, 39334], [S, 39333], [R, 39333]]),
    ex('sp_flat', S, [[K, 48000, 'pending'], [S, 48000], [R, 48000]]),
    ex('sp_goa', K, [[K, 368000], [A, 736000], [S, 368000], [P, 368000]]),
    ex('sp_goa', A, [[K, 90000], [A, 90000], [S, 90000], [P, 90000]]),
    ex('sp_goa', S, [[K, 70000], [A, 82000], [S, 56000], [P, 60000, 'rejected']]),
    ex('sp_office', P, [[K, 60000], [P, 60000], [R, 60000]]),
    ex('sp_dubai', K, [[K, 3500], [M, 3500]]),
    ex('sp_cricket', A, [[K, 40000], [A, 40000]]),
    ex('sp_cricket', K, [[K, 40000], [R, 40000]]),
  ];
  const settlements = [
    mkSettlement('sp_goa', S, K, 368000, 'confirmed'),
    mkSettlement('sp_goa', P, K, 200000, 'pending'),
    mkSettlement('sp_office', K, P, 60000, 'confirmed'),
    mkSettlement('sp_office', R, P, 60000, 'confirmed'),
  ];
  const balances = spaces.map((s) => spaceBalance(s, expenses, settlements, K, nameOf));

  it('matches the expected per-space cards', () => {
    expect(
      balances.map((b) => [
        b.spaceId,
        b.currency,
        b.netMinor,
        b.openBalances,
        b.counterpartyCount,
        b.counterpartyName,
      ]),
    ).toEqual([
      ['sp_flat', 'INR', -47334, 2, 2, null],
      ['sp_goa', 'INR', 1014000, 2, 2, null],
      ['sp_office', 'INR', 0, 0, 0, null],
      ['sp_dubai', 'USD', 3500, 1, 1, 'Meera Shah'],
      ['sp_cricket', 'INR', 0, 2, 0, null],
    ]);
  });

  it('matches the expected overall lines', () => {
    expect(overall(balances)).toEqual([
      { currency: 'INR', netMinor: 966666, oweMinor: 87334, owedMinor: 1054000 },
      { currency: 'USD', netMinor: 3500, oweMinor: 0, owedMinor: 3500 },
    ]);
  });
});
