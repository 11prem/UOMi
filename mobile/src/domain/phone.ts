// The mobile metadata set: these numbers receive SMS codes, so landlines are rejected (India: must start 6-9).
import { getCountryCallingCode, parsePhoneNumberFromString, type CountryCode } from 'libphonenumber-js/mobile';
import type { Currency } from './types';

export type Country = { code: CountryCode; name: string; dial: string; len: number[]; currency: Currency };

// `currency` is the default for a new account from that country (CA and AU use their own now that CAD and AUD exist).
export const COUNTRIES: Country[] = [
  { code: 'IN', name: 'India', dial: '+91', len: [10], currency: 'INR' },
  { code: 'AE', name: 'United Arab Emirates', dial: '+971', len: [9], currency: 'AED' },
  { code: 'US', name: 'United States', dial: '+1', len: [10], currency: 'USD' },
  { code: 'GB', name: 'United Kingdom', dial: '+44', len: [10], currency: 'GBP' },
  { code: 'SG', name: 'Singapore', dial: '+65', len: [8], currency: 'SGD' },
  { code: 'CA', name: 'Canada', dial: '+1', len: [10], currency: 'CAD' },
  { code: 'AU', name: 'Australia', dial: '+61', len: [9], currency: 'AUD' },
  { code: 'DE', name: 'Germany', dial: '+49', len: [10, 11], currency: 'EUR' },
  { code: 'NP', name: 'Nepal', dial: '+977', len: [10], currency: 'USD' },
  { code: 'LK', name: 'Sri Lanka', dial: '+94', len: [9], currency: 'USD' },
  { code: 'BD', name: 'Bangladesh', dial: '+880', len: [10], currency: 'USD' },
  { code: 'SA', name: 'Saudi Arabia', dial: '+966', len: [9], currency: 'USD' },
];

/**
 * `98765 43210` typed in India's field -> `+919876543210`; null if it isn't a valid mobile number for that
 * country. A leading `+` overrides the default country in libphonenumber, so a pasted foreign number is
 * rejected by comparing calling codes (not `p.country`: US and CA share +1).
 */
export function toE164(national: string, country: CountryCode): string | null {
  const p = parsePhoneNumberFromString(national, country);
  return p?.isValid() && p.countryCallingCode === getCountryCallingCode(country) ? p.number : null;
}

function splitPhone(e164: string) {
  const p = parsePhoneNumberFromString(e164);
  return p ? { dial: `+${p.countryCallingCode}`, nat: p.nationalNumber } : { dial: '', nat: e164 };
}

/** `+918012345631` -> `+91 80******31`: first 2 and last 2 national digits. */
export function maskPhone(e164: string): string {
  const { dial, nat } = splitPhone(e164);
  return `${dial} ${nat.slice(0, 2)}${'*'.repeat(Math.max(0, nat.length - 4))}${nat.slice(-2)}`.trim();
}

/** `+919876543210` -> `+91 98765 43210`. */
export function prettyPhone(e164: string): string {
  const { dial, nat } = splitPhone(e164);
  return `${dial} ${nat.length === 10 ? `${nat.slice(0, 5)} ${nat.slice(5)}` : nat}`.trim();
}
