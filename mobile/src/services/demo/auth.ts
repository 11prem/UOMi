import { COUNTRIES, maskPhone } from '../../domain/phone';
import type { User } from '../../domain/types';
import { AppError } from '../errors';
import type { Services } from '../types';
import type { Ctx } from './context';

// specs § 3.4 (OTP) and § 4 (sign up, sign in, forgot password). The code is always 123456.
const OTP_CODE = '123456';
const OTP_TTL_MS = 5 * 60_000;
const LOCK_MS = 10 * 60_000;
const MAX_WRONG = 5;
const RESEND_AFTER_SECONDS = 30;

const USERNAME = /^[a-z0-9_.]{3,20}$/;
const E164 = /^\+[1-9]\d{6,14}$/;
const passwordOk = (p: string) => p.length >= 8 && /[A-Za-z]/.test(p) && /\d/.test(p);
const PASSWORD_RULE = 'Use at least 8 characters with a letter and a number';

type Otp = { sentAt: number; wrong: number; lockedUntil: number };
type SignUp = Otp & { username: string; name: string; phone: string; password: string };
type Reset = Otp & { userId: string };

const byDialLength = [...COUNTRIES].sort((a, b) => b.dial.length - a.dial.length);
/** The country a stored E.164 number belongs to (the longest matching dial code). */
export const countryOf = (phone: string) => byDialLength.find((c) => phone.startsWith(c.dial));

export function makeAuth(c: Ctx): Services['auth'] {
  // Pending codes live only in memory: leaving before verifying creates nothing and frees the username and phone.
  const signups = new Map<string, SignUp>();
  const resets = new Map<string, Reset>();
  const resetTokens = new Map<string, string>(); // token -> user id

  const normalise = (username: string) => username.trim().toLowerCase();
  const usernameTaken = (username: string) => c.db.users.some((u) => u.username === username);
  const phoneTaken = (phone: string) => c.db.users.some((u) => u.phone === phone);
  const locked = (o: Otp) =>
    new AppError('otp_locked', 'Too many attempts — try again in 10 minutes', { retry_after_seconds: Math.ceil((o.lockedUntil - c.now()) / 1000) });

  /** Throws unless `code` is right, not expired and not locked out. The 5th wrong code locks for 10 minutes. */
  function checkCode(o: Otp, code: string) {
    const t = c.now();
    if (t < o.lockedUntil) throw locked(o);
    if (t - o.sentAt > OTP_TTL_MS) throw new AppError('code_expired', 'Code expired — resend');
    if (code === OTP_CODE) return;
    if (++o.wrong >= MAX_WRONG) {
      o.wrong = 0;
      o.lockedUntil = t + LOCK_MS;
      throw locked(o);
    }
    throw new AppError('invalid_code', 'That code is incorrect');
  }
  const pending = <T>(map: Map<string, T>, id: string) => {
    const p = map.get(id);
    if (!p) throw c.notFound('Verification');
    return p;
  };

  return {
    signUp: ({ username, name, phone, password }) =>
      c.write(() => {
        const u = normalise(username);
        const n = name.trim();
        if (!USERNAME.test(u)) throw c.invalid('username', 'Use 3–20 lowercase letters, digits, _ or .');
        if (n.length < 1 || n.length > 50) throw c.invalid('name', 'Enter your name (up to 50 characters)');
        if (!E164.test(phone)) throw c.invalid('phone', 'Enter a valid phone number');
        if (!passwordOk(password)) throw c.invalid('password', PASSWORD_RULE);
        if (usernameTaken(u)) throw new AppError('username_taken', 'Username already taken');
        if (phoneTaken(phone)) throw new AppError('phone_taken', 'Phone number already registered');
        const pendingId = c.uid('pend');
        signups.set(pendingId, { username: u, name: n, phone, password, sentAt: c.now(), wrong: 0, lockedUntil: 0 });
        return { pendingId, maskedPhone: maskPhone(phone) };
      }),

    verifySignUpOtp: (pendingId, code) =>
      c.write(() => {
        const p = pending(signups, pendingId);
        checkCode(p, code);
        if (usernameTaken(p.username)) throw new AppError('username_taken', 'Username already taken'); // someone verified first
        if (phoneTaken(p.phone)) throw new AppError('phone_taken', 'Phone number already registered');
        const created: User = {
          id: c.uid('u'),
          username: p.username,
          name: p.name,
          phone: p.phone,
          phoneVerified: true,
          avatarUrl: null,
          plate: ((c.db.users.length % 6) + 1) as User['plate'],
        };
        c.db.users.push(created);
        c.db.passwords[created.id] = p.password;
        c.db.session.userId = created.id;
        c.db.prefs.defaultCurrency = countryOf(p.phone)?.currency ?? 'INR';
        signups.delete(pendingId);
        return created;
      }),

    resendOtp: (ref) =>
      c.write(() => {
        const o = signups.get(ref) ?? pending(resets, ref);
        if (c.now() < o.lockedUntil) throw locked(o);
        o.sentAt = c.now();
        return { resendAfterSeconds: RESEND_AFTER_SECONDS };
      }),

    signIn: (username, password) =>
      c.write(() => {
        const u = c.db.users.find((x) => x.username === normalise(username));
        if (!u || c.db.passwords[u.id] !== password) throw new AppError('invalid_credentials', 'Username or password is incorrect');
        c.db.session.userId = u.id;
        return u;
      }),

    signOut: () =>
      c.local(() => {
        c.db.session.userId = null;
      }, true),

    restore: () => c.local(() => (c.db.session.userId ? (c.user(c.db.session.userId) ?? null) : null)),

    checkUsername: (u) => c.read(() => !usernameTaken(normalise(u))),
    checkPhone: (e164) => c.read(() => !phoneTaken(e164)),

    requestResetOtp: (username) =>
      c.write(() => {
        const u = c.db.users.find((x) => x.username === normalise(username));
        if (!u) throw new AppError('unknown_username', 'We couldn’t find that username');
        const resetId = c.uid('rst');
        resets.set(resetId, { userId: u.id, sentAt: c.now(), wrong: 0, lockedUntil: 0 });
        return { resetId, maskedPhone: maskPhone(u.phone ?? '') };
      }),

    verifyResetOtp: (resetId, code) =>
      c.write(() => {
        const r = pending(resets, resetId);
        checkCode(r, code);
        const resetToken = c.uid('tok');
        resetTokens.set(resetToken, r.userId);
        resets.delete(resetId);
        return { resetToken };
      }),

    resetPassword: (resetToken, newPassword) =>
      c.write(() => {
        const userId = resetTokens.get(resetToken);
        const u = userId ? c.user(userId) : undefined;
        if (!u) throw c.notFound('Reset request');
        if (!passwordOk(newPassword)) throw c.invalid('password', PASSWORD_RULE);
        c.db.passwords[u.id] = newPassword;
        resetTokens.delete(resetToken);
        return { username: u.username };
      }),
  };
}

/** specs § 6.2: a query of digits (with an optional +) is one WHOLE phone number; anything else is a username prefix. Never the viewer. */
export function makeUsers(c: Ctx): Services['users'] {
  return {
    search: (q) =>
      c.read(() => {
        const me = c.me();
        const text = q.trim().toLowerCase();
        const digits = text.replace(/[\s-]/g, '');
        if (/^\+?\d+$/.test(digits)) {
          const full = digits.startsWith('+') ? digits : `${countryOf(me.phone ?? '')?.dial ?? '+91'}${digits}`;
          return c.db.users.filter((u) => u.id !== me.id && u.phone === full);
        }
        const prefix = text.replace(/^@/, '');
        return prefix ? c.db.users.filter((u) => u.id !== me.id && u.username.startsWith(prefix)) : [];
      }),
  };
}
