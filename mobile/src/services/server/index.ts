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
  toSpaceDetail,
  toUser,
  type MeDto,
  type NotificationDto,
  type NotificationListDto,
  type SearchResultDto,
  type SpaceDetailDto,
  type SpaceListDto,
} from './mappers';

export type { TokenStore, StoredTokens } from './tokens';

/** `tokenStore` defaults to expo-secure-store (AsyncStorage in a browser); `fetchImpl` and `now` are for tests. */
export type ServerOptions = HttpOptions;

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
      update: no,
      addMembers: no,
      removeMember: no,
      leave: no,
      remove: no,
    },

    expenses: { get: no, create: no, update: no, remove: no, acceptShare: no, rejectShare: no },
    settlements: { get: no, payees: no, create: no, confirm: no, reject: no, cancel: no },
    transactions: { list: no },

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
