import { isValidEmail, maskEmail, normalizeEmail } from '../../src/domain/email';
import type { User } from '../../src/domain/types';
import { AppError } from '../../src/services/errors';
import type { Services } from '../../src/services/types';
import type { Ctx } from './context';

// specs § 3.4 (OTP) and § 4 (sign up, sign in, forgot password). The code is always 123456.
const OTP_CODE = '123456';
const OTP_TTL_MS = 5 * 60_000;
const LOCK_MS = 10 * 60_000;
const MAX_WRONG = 5;
const RESEND_AFTER_SECONDS = 30;

const USERNAME = /^[a-z0-9_.]{3,20}$/;
const passwordOk = (p: string) => p.length >= 8 && /[A-Za-z]/.test(p) && /\d/.test(p);
const PASSWORD_RULE = 'Use at least 8 characters with a letter and a number';

type Otp = { sentAt: number; wrong: number; lockedUntil: number };
type SignUp = Otp & { username: string; name: string; email: string; password: string };
type Reset = Otp & { userId: string };

export function makeAuth(c: Ctx): Services['auth'] {
  // Pending codes live only in memory: leaving before verifying creates nothing and frees the username and email.
  const signups = new Map<string, SignUp>();
  const resets = new Map<string, Reset>();
  const resetTokens = new Map<string, string>(); // token -> user id

  const normalise = (username: string) => username.trim().toLowerCase();
  const usernameTaken = (username: string) => c.db.users.some((u) => u.username === username);
  const emailTaken = (email: string) => c.db.users.some((u) => u.email === email);
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
    signUp: ({ username, name, email: rawEmail, password }) =>
      c.write(() => {
        const u = normalise(username);
        const n = name.trim();
        const email = normalizeEmail(rawEmail);
        if (!USERNAME.test(u)) throw c.invalid('username', 'Use 3–20 lowercase letters, digits, _ or .');
        if (n.length < 1 || n.length > 50) throw c.invalid('name', 'Enter your name (up to 50 characters)');
        if (!isValidEmail(email)) throw new AppError('invalid_email', 'Enter a valid email address');
        if (!passwordOk(password)) throw c.invalid('password', PASSWORD_RULE);
        if (usernameTaken(u)) throw new AppError('username_taken', 'Username already taken');
        if (emailTaken(email)) throw new AppError('email_taken', 'Email already registered');
        const pendingId = c.uid('pend');
        signups.set(pendingId, { username: u, name: n, email, password, sentAt: c.now(), wrong: 0, lockedUntil: 0 });
        return { pendingId, maskedEmail: maskEmail(email) };
      }),

    verifySignUpOtp: (pendingId, code) =>
      c.write(() => {
        const p = pending(signups, pendingId);
        checkCode(p, code);
        if (usernameTaken(p.username)) throw new AppError('username_taken', 'Username already taken'); // someone verified first
        if (emailTaken(p.email)) throw new AppError('email_taken', 'Email already registered');
        const created: User = {
          id: c.uid('u'),
          username: p.username,
          name: p.name,
          email: p.email,
          emailVerified: true,
          avatarUrl: null,
          plate: ((c.db.users.length % 6) + 1) as User['plate'],
        };
        c.db.users.push(created);
        c.db.passwords[created.id] = p.password;
        c.db.session.userId = created.id;
        c.db.prefs.defaultCurrency = 'INR';
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
    checkEmail: (email) => c.read(() => !emailTaken(normalizeEmail(email))),

    requestResetOtp: (username) =>
      c.write(() => {
        // An unknown username gets the same reply as a known one (a made-up address, a code that leads nowhere), so the
        // screen cannot be used to find out who has an account. Its new-password step fails like an expired request.
        const name = normalise(username);
        const u = c.db.users.find((x) => x.username === name);
        const resetId = c.uid('rst');
        resets.set(resetId, { userId: u?.id ?? '', sentAt: c.now(), wrong: 0, lockedUntil: 0 });
        return { resetId, maskedEmail: maskEmail(u?.email ?? `${name}@example.com`) };
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

/** specs § 6.2: a username prefix (a leading @ is ignored). Never the viewer. */
export function makeUsers(c: Ctx): Services['users'] {
  return {
    search: (q) =>
      c.read(() => {
        const me = c.me();
        const text = q.trim().toLowerCase();
        const prefix = text.replace(/^@/, '');
        return prefix ? c.db.users.filter((u) => u.id !== me.id && u.username.startsWith(prefix)) : [];
      }),
  };
}
