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

/** What was saved, or a fresh seed when there is nothing saved or it no longer matches the schema. */
export async function loadDb(storage: Storage, now: number): Promise<DemoDb> {
  try {
    const raw = await storage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = DemoDbSchema.safeParse(JSON.parse(raw));
      if (parsed.success) return parsed.data;
    }
  } catch {
    // unreadable storage: start over from the seed
  }
  const fresh = seed(now);
  await saveDb(storage, fresh);
  return fresh;
}

/** Never throws: if the device can't store it, the app keeps working from memory (as the prototype does). */
export async function saveDb(storage: Storage, db: DemoDb): Promise<void> {
  try {
    await storage.setItem(STORAGE_KEY, JSON.stringify(db));
  } catch {
    // keep the in-memory data
  }
}
