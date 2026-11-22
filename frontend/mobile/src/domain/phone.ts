/**
 * Phone numbers, the same rule as the server (`normalize_phone` in app/utils/validators.py): spaces, dashes, dots and brackets are
 * ignored, a leading `00` means `+`, ASCII digits only, 8 to 15 digits, and ten digits with no `+` are an Indian number (+91).
 * It is a format check only. The result is E.164 (`+919876543210`), or null when it cannot be a phone number.
 */
export function normalizePhone(raw: string): string | null {
  let cleaned = raw.trim().replace(/[ \-.()]/g, '');
  if (cleaned.startsWith('00')) cleaned = `+${cleaned.slice(2)}`;
  if (!/^\+?[0-9]+$/.test(cleaned)) return null;
  let digits = cleaned.replace(/^\+/, '');
  if (!cleaned.startsWith('+') && digits.length === 10) digits = `91${digits}`;
  if (digits.length < 8 || digits.length > 15 || digits.startsWith('0')) return null;
  return `+${digits}`;
}

export const isValidPhone = (raw: string) => normalizePhone(raw) !== null;
