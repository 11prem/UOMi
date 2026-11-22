import { balanceText, overallLines } from '../phrases';
import type { SpaceBalance } from '../types';

const bal = (over: Partial<SpaceBalance>): SpaceBalance => ({
  spaceId: 's1',
  currency: 'INR',
  netMinor: 0,
  pairs: [],
  openBalances: 0,
  counterpartyName: null,
  counterpartyCount: 0,
  settled: true,
  ...over,
});

describe('balanceText', () => {
  it('you owe one person: first word of the name only', () => {
    const b = bal({
      netMinor: -2000,
      openBalances: 1,
      counterpartyName: 'Swetha Iyer',
      counterpartyCount: 1,
      settled: false,
    });
    expect(balanceText(b)).toEqual({ tone: 'owe', text: 'You owe ₹20', sub: 'Swetha' });
  });

  it('you are owed by several people', () => {
    const b = bal({
      netMinor: 1014000,
      openBalances: 2,
      counterpartyCount: 2,
      settled: false,
    });
    expect(balanceText(b)).toEqual({ tone: 'owed', text: 'You’re owed ₹10,140', sub: '2 people' });
  });

  it('uses the space currency and keeps paise', () => {
    const b = bal({
      currency: 'USD',
      netMinor: 3550,
      openBalances: 1,
      counterpartyName: 'Meera Shah',
      counterpartyCount: 1,
      settled: false,
    });
    expect(balanceText(b)).toEqual({ tone: 'owed', text: 'You’re owed $35.50', sub: 'Meera' });
  });

  it('compact defaults on; compact false shows .00', () => {
    const b = bal({ netMinor: -2000, openBalances: 1, counterpartyName: 'Swetha Iyer', counterpartyCount: 1, settled: false });
    expect(balanceText(b, false).text).toBe('You owe ₹20.00');
  });

  it('settled up', () => {
    expect(balanceText(bal({}))).toEqual({ tone: 'muted', text: 'Settled up', sub: '' });
  });

  it('net zero with open balances', () => {
    const b = bal({ netMinor: 0, openBalances: 2, settled: false });
    expect(balanceText(b)).toEqual({ tone: 'muted', text: '₹0 net', sub: '2 open balances' });
  });

  it('reads settled from openBalances, not from pairs', () => {
    expect(balanceText(bal({ openBalances: 0, settled: false })).text).toBe('Settled up');
  });
});

describe('overallLines', () => {
  it('says all settled when there is nothing', () => {
    expect(overallLines([])).toMatchObject([{ text: 'You’re all settled up' }]);
  });

  it('one line per currency, net only', () => {
    expect(
      overallLines([
        { currency: 'INR', netMinor: -2000, oweMinor: 2000, owedMinor: 0 },
        { currency: 'USD', netMinor: 25000, oweMinor: 0, owedMinor: 25000 },
      ]),
    ).toEqual([
      { tone: 'owe', text: 'Overall, you owe ₹20' },
      { tone: 'owed', text: 'Overall, you’re owed $250' },
    ]);
  });

  it('shows a zero net when owing and owed cancel out', () => {
    expect(overallLines([{ currency: 'INR', netMinor: 0, oweMinor: 400, owedMinor: 400 }])).toEqual([
      { tone: 'muted', text: 'Overall, ₹0 net' },
    ]);
  });
});
