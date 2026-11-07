import { z } from 'zod';
import {
  AppNotificationSchema,
  ExpenseSchema,
  PreferencesSchema,
  SettlementSchema,
  SpaceSchema,
  UserSchema,
} from '../../domain/types';
import { seed } from './seed';

export const STORAGE_KEY = 'uomi.demo.v1';

/** The slice of AsyncStorage the demo uses. (Deliberately shadows the DOM `Storage` type.) */
export interface Storage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
}

// Everything the demo persists. Balances are never stored (one calculator derives them). Passwords are demo-only plain text.
// The error/offline switches are not saved: restarting the app is always a way out of them.
export const DemoDbSchema = z.object({
  version: z.literal(1),
  users: z.array(UserSchema),
  passwords: z.record(z.string(), z.string()),
  spaces: z.array(SpaceSchema),
  expenses: z.array(ExpenseSchema),
  settlements: z.array(SettlementSchema),
  notifications: z.array(AppNotificationSchema),
  session: z.object({ userId: z.string().nullable() }),
  prefs: PreferencesSchema,
});
export type DemoDb = z.infer<typeof DemoDbSchema>;

/** The last stored value that could not be read back, kept (latest only) before a fresh seed replaces it. */
export const UNREADABLE_KEY = 'uomi.demo.v1.unreadable';

/** What to run on: `canSave` false means this run must never write over what is stored; `fresh` is a new seed to save. */
export type Loaded = { db: DemoDb; canSave: boolean; fresh: boolean };

const parse = (raw: string): DemoDb | null => {
  try {
    const parsed = DemoDbSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null; // not JSON
  }
};

/**
 * What was saved, or a fresh seed. Never destroys stored data on a read problem: a read that fails twice runs on a seed in
 * memory with saving off (the stored data may be fine), and an unreadable value is copied aside before it is replaced.
 */
export async function loadDb(storage: Storage, now: number): Promise<Loaded> {
  let raw: string | null;
  try {
    raw = await storage.getItem(STORAGE_KEY).catch(() => storage.getItem(STORAGE_KEY)); // one retry
  } catch (e) {
    console.warn('Demo data could not be read; using sample data without saving this time', e);
    return { db: seed(now), canSave: false, fresh: false };
  }
  if (raw) {
    const saved = parse(raw);
    if (saved) return { db: saved, canSave: true, fresh: false };
    try {
      await storage.setItem(UNREADABLE_KEY, raw);
    } catch (e) {
      console.warn('Unreadable demo data could not be backed up; using sample data without saving this time', e);
      return { db: seed(now), canSave: false, fresh: false };
    }
  }
  return { db: seed(now), canSave: true, fresh: true };
}

/** Never throws: if the device can't store it, the app keeps working from memory (as the prototype does). False on failure. */
export async function saveDb(storage: Storage, db: DemoDb): Promise<boolean> {
  try {
    await storage.setItem(STORAGE_KEY, JSON.stringify(db));
    return true;
  } catch (e) {
    console.warn('Demo data could not be saved; changes are kept in memory for now', e);
    return false;
  }
}
