import { parsePhoneNumberFromString } from 'libphonenumber-js/mobile';
import { toE164 } from '../../domain/phone';
import type { Currency, User } from '../../domain/types';
import { AppError, notOnServer } from '../errors';
import type { Services } from '../types';
import { createHttp, type HttpOptions } from './http';
import {
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

const no = async (): Promise<never> => {
  throw notOnServer();
};

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
    return (me = { user: toUser(r, { phone: r.phone }), currency: r.currency as Currency });
  }
  const viewer = async () => me ?? (await loadMe());
  const home = () => http.request<SpaceListDto>('GET', '/spaces');
  const detail = async (path: string, method = 'GET', body?: unknown) => {
    const who = await viewer();
    return toSpaceDetail(await http.request<SpaceDetailDto>(method, path, body), who.user);
  };
  const settlementPath = (id: string) => `/settlements/${encodeURIComponent(id)}`;
  const settlementDetail = async (path: string, method = 'GET', body?: unknown) =>
    toSettlementDetail(await http.request<SettlementDetailDto>(method, path, body));

  return {
    mode: 'server',

    auth: {
      signUp: no,
      verifySignUpOtp: no,
      resendOtp: no,
      checkUsername: no,
      checkPhone: no,
      requestResetOtp: no,
      verifyResetOtp: no,
      resetPassword: no,

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
        const text = q.trim();
        const compact = text.replace(/[\s-]/g, '');
        let query: string;
        if (/^\+?\d+$/.test(compact)) {
          // The server reads a number with no `+` as +91, so give it the viewer's own country's code instead.
          const country = compact.startsWith('+') ? undefined : parsePhoneNumberFromString((await viewer()).user.phone ?? '')?.country;
          query = (country && toE164(compact, country)) || compact;
        } else {
          query = text.replace(/^@/, '');
        }
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

    expenses: { get: no, create: no, update: no, remove: no, acceptShare: no, rejectShare: no },
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
      update: no,
      // Preferences are the device's, so they must work before sign-in (the theme is read on the Welcome screen).
      getPreferences: async () => ({
        defaultCurrency: (await http.hasSession()) ? (await viewer()).currency : 'INR',
        theme: 'system',
        notificationsOn: true,
      }),
      setPreferences: no,
    },

    debug: null,
  };
}
