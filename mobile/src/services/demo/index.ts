import AsyncStorage from '@react-native-async-storage/async-storage';
import type { Services } from '../types';
import { makeProfile, makeDebug } from './account';
import { makeAuth, makeUsers } from './auth';
import { createContext, type DemoOptions } from './context';
import type { Storage } from './db';
import { makeExpenses } from './expenses';
import { makeNotifications, makeTransactions } from './feed';
import { makeSettlements } from './settlements';
import { makeSpaces } from './spaces';

export type { DemoOptions } from './context';
export type { Storage } from './db';

/**
 * The standalone app's service layer: everything lives on the device (AsyncStorage key `uomi.demo.v1`), ported from
 * prototype/js/data.js. Each area is in its own file; `context.ts` holds the shared state, the 300–800 ms delay, the
 * simulated-error / offline switches and the save after every write.
 * `opts` is for tests: a clock (OTP expiry) and turning the delay off.
 */
export function createDemoServices(storage: Storage = AsyncStorage, opts: DemoOptions = {}): Services {
  const c = createContext(storage, opts);
  return {
    mode: 'demo',
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
