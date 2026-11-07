import { parseAmountInput } from '../../../domain/money';
import { cleanDecimal, hundredths } from '../amountText';

/** What a controlled amount field holds after typing `keys` one at a time: AmountField feeds each cleaned value back. */
const typed = (keys: string) => [...keys].reduce((value, key) => cleanDecimal(value + key), '');

describe('amount fields typed key by key', () => {
  it.each([
    ['1,000', 100000],
    ['1,00,000', 10000000],
    ['2,500.50', 250050],
    ['12,50', 1250],
    ['12,5', 1250],
    ['40', 4000],
  ])('%p reads as %p minor units', (keys, minor) => {
    expect(parseAmountInput(typed(keys))).toBe(minor);
    expect(hundredths(typed(keys))).toBe(minor);
  });

  it('shows what was typed, commas included', () => {
    expect(typed('1,000')).toBe('1,000');
    expect(typed('12,50')).toBe('12,50');
  });
});

describe('cleanDecimal', () => {
  it('keeps digits, commas and one point with at most two decimals', () => {
    expect(cleanDecimal('1.2.3')).toBe('1.23');
    expect(cleanDecimal('100.009')).toBe('100.00');
    expect(cleanDecimal('1,000.5,5')).toBe('1,000.55');
    expect(cleanDecimal('₹ 40')).toBe('40');
  });
});
