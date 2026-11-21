import { isValidEmail, maskEmail, normalizeEmail } from '../email';

describe('normalizeEmail', () => {
  it('trims and lowercases', () => expect(normalizeEmail('  Kabir.R@Example.COM \n')).toBe('kabir.r@example.com'));
});

describe('isValidEmail', () => {
  it.each(['kabir.r@example.com', 'a@x.io', 'a+tag@mail.example.co.uk', "o'brien@ex-ample.com", 'x@a-b.c1'])('accepts %s', (e) => {
    expect(isValidEmail(e)).toBe(true);
  });

  it.each([
    '',
    'plain',
    'a@b',
    '@x.io',
    'a@',
    'a@@x.io',
    'a@b@x.io',
    'a b@x.io',
    'a@x .io',
    ' a@x.io',
    'a@x.io ',
    'a@.io',
    'a@x..io',
    'a@x.io.',
    'a@-x.io',
    'a@x-.io',
    'a..b@x.io',
    '.a@x.io',
    'a.@x.io',
    'kabïr@example.com',
    'a@exämple.com',
  ])('rejects %j', (e) => {
    expect(isValidEmail(e)).toBe(false);
  });

  it('limits the local part to 64 characters and the whole address to 254', () => {
    expect(isValidEmail(`${'a'.repeat(64)}@x.io`)).toBe(true);
    expect(isValidEmail(`${'a'.repeat(65)}@x.io`)).toBe(false);
    const label = 'b'.repeat(63);
    expect(isValidEmail(`a@${label}.${label}.${label}.${'c'.repeat(254 - 2 - 63 * 3 - 3)}`)).toBe(true); // exactly 254
    expect(isValidEmail(`a@${label}.${label}.${label}.${'c'.repeat(254 - 2 - 63 * 3 - 3 + 1)}`)).toBe(false); // 255
    expect(isValidEmail(`a@${'b'.repeat(64)}.io`)).toBe(false); // a label of 64
  });
});

describe('maskEmail', () => {
  it.each([
    ['kabir.r@example.com', 'ka*****@example.com'],
    ['ab@x.io', 'a*@x.io'],
    ['a@x.io', '*@x.io'],
    ['abc@x.io', 'ab*@x.io'],
  ])('%s -> %s', (e, masked) => expect(maskEmail(e)).toBe(masked));
});
