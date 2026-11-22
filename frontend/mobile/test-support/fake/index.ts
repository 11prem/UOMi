import AsyncStorage from '@react-native-async-storage/async-storage';
import type { Services } from '../../src/services/types';
import { makeProfile, makeDebug, type FakeDebug } from './account';
import { makeAuth, makeUsers } from './auth';
import { createContext, type DemoOptions } from './context';
import type { Storage } from './db';
import { makeExpenses } from './expenses';
import { makeNotifications, makeTransactions } from './feed';
import { makeSettlements } from './settlements';
import { makeSpaces } from './spaces';

export type { DemoOptions } from './context';
export type { Storage } from './db';
export type { FakeDebug } from './account';

export type FakeServices = Services & { debug: FakeDebug };

/**
 * TEST ONLY. An in-memory stand-in for the backend that the screen tests sign in to (seeded users, spaces and expenses).
 * It is never bundled into the app: jest.setup.js swaps it in for `createServerServices` when the server URL is `FAKE_SERVER_URL`.
 * `opts` is for tests: a clock (OTP expiry) and turning the delay off.
 */
export function createFakeServices(storage: Storage = AsyncStorage, opts: DemoOptions = {}): FakeServices {
  const c = createContext(storage, opts);
  return {
    auth: makeAuth(c),
    users: makeUsers(c),
    spaces: makeSpaces(c),
    expenses: makeExpenses(c),
    settlements: makeSettlements(c),
    notifications: makeNotifications(c),
    transactions: makeTransactions(c),
    profile: makeProfile(c),
    debug: makeDebug(c),
  };
}
