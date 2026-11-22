// The email is the sign-up and forgot-password channel (a 6-digit code goes to it). Same mask rule as the server.

const MAX_EMAIL = 254;
const MAX_LOCAL = 64;
const LOCAL = /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+$/;
const LABEL = /^[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?$/;

export const normalizeEmail = (s: string) => s.trim().toLowerCase();

/** ASCII only, one `@`, a dotted domain of valid labels, no spaces; 254 characters at most and 64 before the `@`. */
export function isValidEmail(s: string): boolean {
  if (s.length > MAX_EMAIL) return false;
  const parts = s.split('@');
  if (parts.length !== 2) return false;
  const [local, domain] = parts;
  if (!local || local.length > MAX_LOCAL || !LOCAL.test(local) || local.startsWith('.') || local.endsWith('.') || local.includes('..')) return false;
  const labels = domain.split('.');
  return labels.length >= 2 && labels.every((l) => l.length >= 1 && l.length <= 63 && LABEL.test(l));
}

/** `kabir.r@example.com` -> `ka*****@example.com`: the first two letters stay, but never the whole local part. */
export function maskEmail(e: string): string {
  const at = e.indexOf('@');
  const local = e.slice(0, at);
  const kept = Math.min(2, local.length - 1);
  return local.slice(0, kept) + '*'.repeat(local.length - kept) + e.slice(at);
}
