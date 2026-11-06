import { PreferencesSchema } from '../../domain/types';
import type { Services } from '../types';
import type { Ctx } from './context';
import { seed } from './seed';

// specs § 13 (profile) and § 14.1 (the hidden debug menu: Act as…, error switches, Reset demo data).
export function makeProfile(c: Ctx): Services['profile'] {
  return {
    get: () => c.read(() => c.me()),

    update: ({ name, avatarUrl }) =>
      c.write(() => {
        const me = c.me();
        const clean = name?.trim();
        if (clean !== undefined && (clean.length < 1 || clean.length > 50)) throw c.invalid('name', 'Enter your name (up to 50 characters)');
        if (clean !== undefined) me.name = clean;
        if (avatarUrl !== undefined) me.avatarUrl = avatarUrl;
        return me;
      }),

    // Preferences belong to the device, so they can be read before anyone signs in (the theme is needed on the Welcome screen).
    getPreferences: () => c.read(() => c.db.prefs),

    setPreferences: (p) =>
      c.write(() => {
        const parsed = PreferencesSchema.safeParse(p);
        if (!parsed.success) throw c.invalid('preferences', 'Those settings are not valid');
        c.db.prefs = parsed.data;
      }),
  };
}

/** Never delayed, never failed by the switches (otherwise the switches could not be turned off), and available signed out. */
export function makeDebug(c: Ctx): NonNullable<Services['debug']> {
  return {
    users: () => c.debug(() => c.db.users),

    actAs: (userId) =>
      c.debug(() => {
        const u = c.user(userId);
        if (!u) throw c.notFound('User');
        c.db.session.userId = u.id;
        return u;
      }, true),

    // Back to the seed and signed out (as the prototype does); the chosen theme is kept.
    resetDemoData: () =>
      c.debug(() => {
        const fresh = seed(c.now());
        fresh.prefs.theme = c.db.prefs.theme;
        c.db = fresh;
      }, true),

    setSimulateErrors: (on) =>
      c.debug(() => {
        c.flags.simulateErrors = on;
      }),
    setOffline: (on) =>
      c.debug(() => {
        c.flags.offline = on;
      }),
    state: () => c.debug(() => ({ ...c.flags })),
  };
}
