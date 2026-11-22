import AsyncStorage from '@react-native-async-storage/async-storage';
import { CURRENCIES, type Currency, type Expense, type Preferences, type User } from '../../domain/types';
import { AppError, notOnServer } from '../errors';
import type { Services } from '../types';
import { createHttp, type HttpOptions, type TokenPairDto } from './http';
import {
  dayString,
  toExpense,
  toExpenseDetail,
  cardBalance,
  cardSpace,
  ms,
  toNotification,
  toOverall,
  toPayee,
  toSettlementDetail,
  toSpaceDetail,
  toTransaction,
  toUser,
  type ExpenseDetailDto,
  type MeDto,
  type NotificationDto,
  type NotificationListDto,
  type PayeeDto,
  type SearchResultDto,
  type SettlementDetailDto,
  type SpaceDetailDto,
  type SpaceListDto,
  type TransactionDto,
  type TransactionListDto,
} from './mappers';

export type { TokenStore, StoredTokens } from './tokens';

/** `tokenStore` defaults to expo-secure-store (AsyncStorage in a browser); `fetchImpl` and `now` are for tests. */
export type ServerOptions = HttpOptions;

/** The Transactions list is fetched this many rows at a time (the server allows up to 100), and at most this many times. */
export const TRANSACTIONS_PAGE = 100;
export const TRANSACTIONS_MAX_PAGES = 20;

/** The server keeps no default currency per person: a new space starts in this one (the server's own default too). */
const DEFAULT_CURRENCY: Currency = 'INR';

const no = async (): Promise<never> => {
  throw notOnServer();
};

/**
 * The default currency and the Notifications switch are the phone's own: the server keeps no preferences. They are saved here,
 * the same way the theme is saved on the phone.
 */
const PREFS_KEY = 'uomi.server.preferences';
type PhonePrefs = Pick<Preferences, 'defaultCurrency' | 'notificationsOn'>;
const DEFAULT_PREFS: PhonePrefs = { defaultCurrency: DEFAULT_CURRENCY, notificationsOn: true };

async function readPhonePrefs(): Promise<PhonePrefs> {
  try {
    const raw = await AsyncStorage.getItem(PREFS_KEY);
    const saved = raw ? (JSON.parse(raw) as Partial<PhonePrefs>) : {};
    return {
      defaultCurrency: (CURRENCIES as readonly string[]).includes(saved.defaultCurrency ?? '') ? (saved.defaultCurrency as Currency) : DEFAULT_PREFS.defaultCurrency,
      notificationsOn: typeof saved.notificationsOn === 'boolean' ? saved.notificationsOn : DEFAULT_PREFS.notificationsOn,
    };
  } catch {
    return DEFAULT_PREFS; // unreadable: the defaults stand
  }
}

/**
 * The same `Services` over HTTP against the FastAPI backend. Operations the backend has no endpoint for reject with
 * `not_on_server`; every other failure is an `AppError` (`network` when the server can't be reached, tokens kept).
 */
export function createServerServices(opts: ServerOptions): Services {
  const http = createHttp({
    ...opts,
    onSignedOut: (reason) => {
      me = null;
      opts.onSignedOut(reason);
    },
  });

  let me: { user: User; currency: Currency } | null = null;
  async function loadMe() {
    const r = await http.request<MeDto>('GET', '/users/me');
    return (me = { user: toUser(r, { email: r.email ?? undefined }), currency: DEFAULT_CURRENCY });
  }
  const viewer = async () => me ?? (await loadMe());
  const home = () => http.request<SpaceListDto>('GET', '/spaces');
  const detail = async (path: string, method = 'GET', body?: unknown) => {
    const who = await viewer();
    return toSpaceDetail(await http.request<SpaceDetailDto>(method, path, body), who.user);
  };
  const expensePath = (id: string) => `/expenses/${encodeURIComponent(id)}`;
  /** The body of adding or editing an expense. What was typed is sent as typed; a shares row with nothing typed is one share. */
  const expenseBody = (i: Omit<Expense, 'id' | 'createdBy' | 'updatedAt'>) => ({
    description: i.description,
    amount_minor: i.amountMinor,
    paid_by: i.paidBy,
    split_type: i.splitType,
    shares: i.shares.map((s) => ({ username: s.userId, input: i.splitType === 'equal' ? null : i.splitType === 'shares' ? (s.input ?? 1) : s.input })),
    date: dayString(i.date),
  });
  const settlementPath = (id: string) => `/settlements/${encodeURIComponent(id)}`;
  const settlementDetail = async (path: string, method = 'GET', body?: unknown) =>
    toSettlementDetail(await http.request<SettlementDetailDto>(method, path, body));

  return {
    auth: {
      async signUp({ username, name, email, phone, password }) {
        const r = await http.open<{ pending_id: string; masked_email: string }>('POST', '/auth/register', {
          username: username.trim(),
          name,
          email,
          phone: phone ?? '',
          password,
          confirm_password: password,
        });
        return { pendingId: r.pending_id, maskedEmail: r.masked_email };
      },

      async verifySignUpOtp(pendingId, code) {
        me = null;
        await http.startSession(await http.open<TokenPairDto>('POST', '/auth/register/verify', { pending_id: pendingId, code }));
        try {
          return (await loadMe()).user;
        } catch (e) {
          await http.forget(); // not signed in after all: don't keep tokens that restore() would pick up
          throw e;
        }
      },

      async resendOtp(ref) {
        const r = await http.open<{ resend_after_seconds: number }>('POST', '/auth/otp/resend', { id: ref });
        return { resendAfterSeconds: r.resend_after_seconds };
      },

      checkUsername: async (u) => (await http.open<{ available: boolean }>('GET', `/auth/check-username?username=${encodeURIComponent(u)}`)).available,
      checkEmail: async (email) => (await http.open<{ available: boolean }>('GET', `/auth/check-email?email=${encodeURIComponent(email)}`)).available,

      async requestResetOtp(username) {
        const r = await http.open<{ reset_id: string; masked_email: string }>('POST', '/auth/forgot', { username: username.trim() });
        return { resetId: r.reset_id, maskedEmail: r.masked_email };
      },

      async verifyResetOtp(resetId, code) {
        const r = await http.open<{ reset_token: string }>('POST', '/auth/verify-otp', { reset_id: resetId, code });
        return { resetToken: r.reset_token };
      },

      async resetPassword(resetToken, newPassword) {
        const r = await http.open<{ username: string }>('POST', '/auth/reset', { reset_token: resetToken, new_password: newPassword, confirm_password: newPassword });
        return { username: r.username };
      },

      async signIn(username, password) {
        me = null;
        await http.login(username.trim(), password);
        try {
          return (await loadMe()).user;
        } catch (e) {
          await http.forget(); // not signed in after all: don't keep tokens that restore() would pick up
          throw e;
        }
      },

      async signOut() {
        await http.logout();
        me = null;
      },

      async restore() {
        if (!(await http.resume())) return null;
        try {
          return (await loadMe()).user;
        } catch (e) {
          if (e instanceof AppError && e.code === 'session_expired') return null; // the server had already ended it
          throw e;
        }
      },
    },

    users: {
      async search(q) {
        const query = q.trim().replace(/^@/, '');
        if (!query) return [];
        const rows = await http.request<SearchResultDto[]>('GET', `/users/search?q=${encodeURIComponent(query)}`);
        return rows.map((r) => toUser(r));
      },
    },

    spaces: {
      list: async () => (await home()).spaces.map((c) => ({ space: cardSpace(c), balance: cardBalance(c), lastActivity: ms(c.last_activity_at) })),
      overall: async () => (await home()).overall.map(toOverall),
      get: (id) => detail(`/spaces/${encodeURIComponent(id)}`),
      create: async ({ name, icon, currency, memberIds }) => (await detail('/spaces', 'POST', { name, icon, currency, usernames: memberIds })).space,
      update: async (id, p) => (await detail(`/spaces/${encodeURIComponent(id)}`, 'PATCH', { name: p.name, icon: p.icon, currency: p.currency })).space, // only what is given is sent
      addMembers: async (id, userIds) => void (await detail(`/spaces/${encodeURIComponent(id)}/members`, 'POST', { usernames: userIds })),
      removeMember: async (id, userId) => void (await http.request<void>('DELETE', `/spaces/${encodeURIComponent(id)}/members/${encodeURIComponent(userId)}`)),
      leave: async (id) => void (await http.request<void>('POST', `/spaces/${encodeURIComponent(id)}/leave`)),
      remove: async (id) => void (await http.request<void>('DELETE', `/spaces/${encodeURIComponent(id)}`)),
    },

    expenses: {
      get: async (id) => toExpenseDetail(await http.request<ExpenseDetailDto>('GET', expensePath(id)), (await viewer()).user),
      create: async (i) => toExpense(await http.request<ExpenseDetailDto>('POST', `/spaces/${encodeURIComponent(i.spaceId)}/expenses`, expenseBody(i))),
      update: async (id, i) => toExpense(await http.request<ExpenseDetailDto>('PUT', expensePath(id), expenseBody(i))),
      remove: async (id) => void (await http.request<void>('DELETE', expensePath(id))),
      acceptShare: async (id) => void (await http.request<ExpenseDetailDto>('POST', `${expensePath(id)}/accept`)),
      rejectShare: async (id) => void (await http.request<ExpenseDetailDto>('POST', `${expensePath(id)}/reject`)),
    },
    settlements: {
      get: (id) => settlementDetail(settlementPath(id)),
      payees: async (spaceId) => (await http.request<PayeeDto[]>('GET', `/spaces/${encodeURIComponent(spaceId)}/payees`)).map(toPayee),
      create: async ({ spaceId, toUserId, amountMinor }) =>
        (await settlementDetail(`/spaces/${encodeURIComponent(spaceId)}/settlements`, 'POST', { to_username: toUserId, amount_minor: amountMinor })).settlement,
      confirm: async (id) => void (await http.request<SettlementDetailDto>('POST', `${settlementPath(id)}/confirm`)),
      reject: async (id) => void (await http.request<SettlementDetailDto>('POST', `${settlementPath(id)}/reject`)),
      cancel: async (id) => void (await http.request<SettlementDetailDto>('POST', `${settlementPath(id)}/cancel`)),
    },
    transactions: {
      list: async ({ kind, spaceId }) => {
        const who = await viewer();
        const rows: TransactionDto[] = [];
        let before: string | null = null;
        for (let page = 0; page < TRANSACTIONS_MAX_PAGES; page++) {
          const query: string = `kind=${kind}&limit=${TRANSACTIONS_PAGE}${spaceId ? `&space_id=${encodeURIComponent(spaceId)}` : ''}${before ? `&before=${encodeURIComponent(before)}` : ''}`;
          let got: TransactionListDto;
          try {
            got = await http.request<TransactionListDto>('GET', `/transactions?${query}`);
          } catch (e) {
            // An older server has no such route. With no space picked, "not found" can only mean that: a space that is
            // gone also comes back as not_found, but only when one was asked for.
            if (page === 0 && !spaceId && e instanceof AppError && e.code === 'not_found') throw notOnServer();
            throw e;
          }
          rows.push(...got.items);
          before = got.next_before;
          if (before === null) break;
        }
        // Newest first by the date the app shows (an expense's day on this device, a payment's moment). The sort is stable.
        return rows.map((r) => toTransaction(r, who.user)).sort((a, b) => b.date - a.date);
      },
    },

    notifications: {
      async list() {
        const who = (await viewer()).user.username;
        const r = await http.request<NotificationListDto>('GET', '/notifications?limit=50');
        return r.items.map((n) => toNotification(n, who));
      },
      markRead: async (id) => void (await http.request<NotificationDto>('PATCH', `/notifications/${encodeURIComponent(id)}`, { read: true })),
      markAllRead: async () => void (await http.request<{ updated_count: number }>('PATCH', '/notifications/read-all')),
      unreadCount: async () => (await http.request<{ unread_count: number }>('GET', '/notifications/unread-count')).unread_count,
    },

    profile: {
      get: async () => (await loadMe()).user,
      // Only the name is the server's to change. A photo stays on the phone that picked it, and is not sent.
      async update(p) {
        if (p.name !== undefined) await http.request<MeDto>('PATCH', '/users/me', { name: p.name });
        return (await loadMe()).user;
      },
      // Preferences are the device's, so they must work before sign-in (the theme is read on the Welcome screen).
      getPreferences: async () => ({ ...(await readPhonePrefs()), theme: 'system' }),
      async setPreferences(p) {
        await AsyncStorage.setItem(PREFS_KEY, JSON.stringify({ defaultCurrency: p.defaultCurrency, notificationsOn: p.notificationsOn })).catch(() => {});
      },
    },
  };
}
