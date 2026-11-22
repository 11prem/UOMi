import { formatMoney, parseAmountInput, parseMoneyString } from '../money';

describe('formatMoney', () => {
  it('groups INR the Indian way and other currencies in thousands', () => {
    expect(formatMoney(12345650, 'INR')).toBe('₹1,23,456.50');
    expect(formatMoney(12345650, 'USD')).toBe('$123,456.50');
  });

  it('compact drops .00 on whole amounts only', () => {
    expect(formatMoney(2000, 'INR', { compact: true })).toBe('₹20');
    expect(formatMoney(2050, 'INR', { compact: true })).toBe('₹20.50');
    expect(formatMoney(2000, 'INR')).toBe('₹20.00');
  });

  it('shows the magnitude, with a leading dash only when signed', () => {
    expect(formatMoney(-2000, 'INR')).toBe('₹20.00');
    expect(formatMoney(-2000, 'INR', { signed: true })).toBe('–₹20.00');
    expect(formatMoney(2000, 'INR', { signed: true })).toBe('₹20.00');
  });

  it('puts a space after multi-letter symbols', () => {
    expect(formatMoney(150000, 'AED')).toBe('AED 1,500.00');
    expect(formatMoney(150000, 'SGD')).toBe('S$ 1,500.00');
    expect(formatMoney(150000, 'AUD')).toBe('A$ 1,500.00');
    expect(formatMoney(150000, 'CAD')).toBe('C$ 1,500.00');
  });

  it('shows an unknown currency by its code instead of crashing', () => {
    expect(formatMoney(1234, 'JPY' as never)).toBe('JPY 12.34');
  });
});

describe('parseAmountInput', () => {
  it.each([
    ['12.5', 1250],
    ['12', 1200],
    ['.5', 50],
    ['0.01', 1],
    [' 40 ', 4000],
    ['1,000', 100000],
    ['12,50', 1250],
    ['9999999.99', 999999999],
  ])('accepts %p', (text, minor) => expect(parseAmountInput(text)).toBe(minor));

  it.each(['', ' ', '.', 'abc', '12.345', '0', '0.00', '-5', '1e3', '10000000', '1,00,00,000', '12,345.678'])(
    'rejects %p',
    (text) => expect(parseAmountInput(text)).toBeNull(),
  );
});

describe('parseMoneyString', () => {
  it('reads server decimal strings into integer minor units', () => {
    expect(parseMoneyString('-100.10')).toBe(-10010);
    expect(parseMoneyString('100')).toBe(10000);
    expect(parseMoneyString('0.5')).toBe(50);
    expect(parseMoneyString('1234567.89')).toBe(123456789);
  });

  it('never returns negative zero', () => {
    expect(parseMoneyString('-0.00')).toBe(0);
  });

  it('throws on anything that is not a decimal with at most 2 places', () => {
    expect(() => parseMoneyString('12.345')).toThrow();
    expect(() => parseMoneyString('abc')).toThrow();
    expect(() => parseMoneyString('')).toThrow();
  });
});
