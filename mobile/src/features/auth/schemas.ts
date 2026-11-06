import { z } from 'zod';
import { COUNTRIES, toE164, type Country } from '../../domain/phone';

// specs § 4.2 field rules. The messages are the prototype's copy.
export const USERNAME_RULE = /^[a-z0-9_.]{3,20}$/;
export const USERNAME_HINT = 'Use 3–20 lowercase letters, numbers, _ or .';
export const PASSWORD_HINT = 'At least 8 characters, with a letter and a number';

const username = z.string().trim().toLowerCase().min(1, 'Enter a username').regex(USERNAME_RULE, USERNAME_HINT);
export const password = z.string().refine((p) => p.length >= 8 && /[A-Za-z]/.test(p) && /\d/.test(p), PASSWORD_HINT);

/** `Enter a 10-digit number for India` while the digits can't be right yet, else a general "not a valid mobile number". */
export function phoneProblem(phone: string, country: Country): string {
  const digits = phone.replace(/\D/g, '');
  return !phone.trim().startsWith('+') && !country.len.includes(digits.length)
    ? `Enter a ${country.len.join(' or ')}-digit number for ${country.name}`
    : `Enter a valid mobile number for ${country.name}`;
}

/** The "Confirm password" rule shared by Create Account and New password. */
function confirmMatches(v: { password: string; confirm: string }, ctx: z.RefinementCtx) {
  if (v.confirm !== v.password || !v.confirm) {
    ctx.addIssue({ code: 'custom', path: ['confirm'], message: v.confirm ? 'Passwords don’t match' : 'Confirm your password' });
  }
}

export const signUpSchema = z
  .object({
    username,
    name: z.string().trim().min(1, 'Enter your name').max(50, 'Use 50 characters or fewer'),
    country: z.string(),
    phone: z.string().trim().min(1, 'Enter your phone number'),
    password,
    confirm: z.string(),
  })
  .superRefine((v, ctx) => {
    const country = COUNTRIES.find((c) => c.code === v.country);
    if (v.phone && country && !toE164(v.phone, country.code)) {
      ctx.addIssue({ code: 'custom', path: ['phone'], message: phoneProblem(v.phone, country) });
    }
    confirmMatches(v, ctx);
  });
export type SignUpInput = z.input<typeof signUpSchema>;

/** Sign in only asks for both fields: an old account's password must not be judged by today's rule. */
export const signInSchema = z.object({
  username: z.string().trim().min(1, 'Enter your username'),
  password: z.string().min(1, 'Enter your password'),
});
export type SignInInput = z.input<typeof signInSchema>;

export const forgotSchema = z.object({ username: z.string().trim().min(1, 'Enter your username') });
export type ForgotInput = z.input<typeof forgotSchema>;

export const resetSchema = z.object({ password, confirm: z.string() }).superRefine(confirmMatches);
export type ResetInput = z.input<typeof resetSchema>;
