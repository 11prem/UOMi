import { computeSplit } from '../split';

const rows = (...inputs: (number | null)[]) =>
  inputs.map((input, i) => ({ userId: 'abcdef'[i], input }));
const amounts = (r: ReturnType<typeof computeSplit>) => r.amounts.map((a) => a.amountMinor);
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

describe('computeSplit equal', () => {
  it('hands leftover units out one at a time in member order', () => {
    const r = computeSplit(10000, 'equal', rows(null, null, null));
    expect(r.valid).toBe(true);
    expect(amounts(r)).toEqual([3334, 3333, 3333]);
    expect(sum(amounts(r))).toBe(10000);
    expect(r.amounts.map((a) => a.userId)).toEqual(['a', 'b', 'c']);
    expect(r.helper).toBe('₹33.33 each');
  });

  it('is invalid with nobody ticked or no amount', () => {
    expect(computeSplit(10000, 'equal', []).valid).toBe(false);
    expect(computeSplit(0, 'equal', rows(null, null)).valid).toBe(false);
    expect(computeSplit(0, 'equal', rows(null, null)).helper).toBe('Enter an amount to see each share');
  });

  it('uses the given currency in the helper line', () => {
    expect(computeSplit(20000, 'equal', rows(null, null), 'USD').helper).toBe('$100.00 each');
  });
});

describe('computeSplit exact', () => {
  it('is valid when the amounts add up to the total', () => {
    const r = computeSplit(10000, 'exact', rows(50, 50));
    expect(r.valid).toBe(true);
    expect(amounts(r)).toEqual([5000, 5000]);
    expect(r.helper).toBe('Adds up to the total');
  });

  it('says how much is left to assign', () => {
    const r = computeSplit(10000, 'exact', rows(40, 50));
    expect(r.valid).toBe(false);
    expect(amounts(r)).toEqual([4000, 5000]);
    expect(r.helper).toBe('₹10.00 left to assign');
  });

  it('says how much is over', () => {
    const r = computeSplit(10000, 'exact', rows(60, 50));
    expect(r.valid).toBe(false);
    expect(r.helper).toBe('₹10.00 over');
  });

  it('rounds typed amounts without float drift and treats empty as 0', () => {
    const r = computeSplit(7010, 'exact', rows(70.1, null));
    expect(amounts(r)).toEqual([7010, 0]);
    expect(r.valid).toBe(true);
  });

  it('rejects a negative amount even if the total matches', () => {
    expect(computeSplit(10000, 'exact', rows(150, -50)).valid).toBe(false);
  });
});

describe('computeSplit percent', () => {
  it('sums to the total for 33.33 / 33.33 / 33.34', () => {
    const r = computeSplit(10000, 'percent', rows(33.33, 33.33, 33.34));
    expect(r.valid).toBe(true);
    expect(amounts(r)).toEqual([3333, 3333, 3334]);
    expect(sum(amounts(r))).toBe(10000);
    expect(r.helper).toBe('Adds up to 100%');
  });

  it('gives the leftover unit to the first person in member order', () => {
    expect(amounts(computeSplit(10001, 'percent', rows(50, 25, 25)))).toEqual([5001, 2500, 2500]);
  });

  it('says how many percent are left or over', () => {
    const left = computeSplit(10000, 'percent', rows(20, 20));
    expect(left.valid).toBe(false);
    expect(left.helper).toBe('60% left');
    expect(computeSplit(10000, 'percent', rows(55, 50)).helper).toBe('5% over');
    expect(computeSplit(10000, 'percent', rows(33.33, 33.33, 33.33)).helper).toBe('0.01% left');
  });
});

describe('computeSplit shares', () => {
  it('splits 2:1:1 on 30000', () => {
    const r = computeSplit(30000, 'shares', rows(2, 1, 1));
    expect(r.valid).toBe(true);
    expect(amounts(r)).toEqual([15000, 7500, 7500]);
    expect(r.helper).toBe('4 shares in total');
  });

  it('hands leftover units out in member order', () => {
    expect(amounts(computeSplit(10000, 'shares', rows(1, 1, 1)))).toEqual([3334, 3333, 3333]);
  });

  it('needs at least one share', () => {
    const r = computeSplit(10000, 'shares', rows(0, null));
    expect(r.valid).toBe(false);
    expect(r.helper).toBe('Give at least one share');
    expect(amounts(r)).toEqual([0, 0]);
  });

  it('uses the singular for one share', () => {
    expect(computeSplit(10000, 'shares', rows(1)).helper).toBe('1 share in total');
  });
});
