import { z } from 'zod';
import { isValidEmail } from '../../domain/email';
import { isValidPhone } from '../../domain/phone';

// specs § 4.2 field rules. The messages are the prototype's copy.
export const USERNAME_RULE = /^[a-z0-9_.]{3,20}$/;
export const USERNAME_HINT = 'Use 3–20 lowercase letters, numbers, _ or .';
export const PASSWORD_HINT = 'At least 8 characters, with a letter and a number';

const username = z.string().trim().toLowerCase().min(1, 'Enter a username').regex(USERNAME_RULE, USERNAME_HINT);
export const password = z.string().refine((p) => p.length >= 8 && /[A-Za-z]/.test(p) && /\d/.test(p), PASSWORD_HINT);

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
    email: z.string().trim().min(1, 'Enter your email').refine(isValidEmail, 'Enter a valid email address'),
    phone: z.string().trim().min(1, 'Enter your phone number').refine(isValidPhone, 'Enter a valid phone number, with the country code if it isn’t Indian'),
    password,
    confirm: z.string(),
  })
  .superRefine(confirmMatches);
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
