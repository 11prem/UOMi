import { COUNTRIES, maskPhone, prettyPhone, toE164 } from '../phone';
import { CURRENCIES } from '../types';

describe('maskPhone', () => {
  it('keeps the dial code and the first and last 2 national digits', () => {
    expect(maskPhone('+918012345631')).toBe('+91 80******31');
    expect(maskPhone('+971501234567')).toBe('+971 50*****67');
  });
});

describe('prettyPhone', () => {
  it('shows international format, splitting 10-digit numbers 5 + 5', () => {
    expect(prettyPhone('+919876543210')).toBe('+91 98765 43210');
    expect(prettyPhone('+971501234567')).toBe('+971 501234567');
  });
});

describe('toE164', () => {
  it('normalises a valid national number for the chosen country', () => {
    expect(toE164('98765 43210', 'IN')).toBe('+919876543210');
    expect(toE164('50 123 4567', 'AE')).toBe('+971501234567');
  });

  it('returns null when the number is not valid for that country', () => {
    expect(toE164('12345', 'IN')).toBeNull();
    expect(toE164('', 'IN')).toBeNull();
    expect(toE164('not a number', 'IN')).toBeNull();
  });

  it('rejects a pasted number from another country (a leading + overrides the default country)', () => {
    expect(toE164('+14155552671', 'IN')).toBeNull();
    expect(toE164('+971501234567', 'IN')).toBeNull();
    expect(toE164('+14155552671', 'US')).toBe('+14155552671');
    expect(toE164('+91 98765 43210', 'IN')).toBe('+919876543210');
  });

  it('rejects Indian numbers that are not mobiles (they start with 6-9)', () => {
    expect(toE164('1234567890', 'IN')).toBeNull();
    expect(toE164('5555555555', 'IN')).toBeNull();
  });

  it('accepts a valid US number under US and a valid Canadian number under CA (both +1)', () => {
    expect(toE164('(415) 555-2671', 'US')).toBe('+14155552671');
    expect(toE164('(506) 234-5678', 'CA')).toBe('+15062345678');
  });
});

describe('COUNTRIES', () => {
  it('lists India first and maps every country to a supported currency', () => {
    expect(COUNTRIES[0]).toMatchObject({ code: 'IN', dial: '+91', currency: 'INR' });
    for (const c of COUNTRIES) expect(CURRENCIES).toContain(c.currency);
  });
});
