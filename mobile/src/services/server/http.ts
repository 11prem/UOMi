import { AppError, type AppErrorCode } from '../errors';
import { defaultTokenStore, type StoredTokens, type TokenStore } from './tokens';

const TIMEOUT_MS = 10_000;
const IDLE_MARGIN_SECONDS = 30; // sign in again a little before the server would have ended the session
const SIGN_IN_AGAIN = 'Please sign in again';
const SERVER_DOWN = 'Can’t reach the server — try again when you’re connected';

/** Every code of the 401 family except `token_expired` (which refreshes) and `invalid_credentials` (a sign-in answer). */
const SESSION_ENDED = new Set(['session_expired', 'invalid_token', 'invalid_refresh_token', 'not_authenticated']);
/** Backend codes that are also an `AppErrorCode`. `network`, `not_on_server` and `simulated` are the app's own, so a server can't send them. */
const SAME_NAME = new Set<string>([
  'invalid_credentials',
  'too_many_attempts',
  'username_taken',
  'phone_taken',
  'invalid_code',
  'code_expired',
  'otp_locked',
  'unknown_username',
  'session_expired',
  'not_found',
  'forbidden',
  'validation_error',
] satisfies AppErrorCode[]);
const RENAMED: Record<string, AppErrorCode> = {
  space_not_found: 'not_found',
  notification_not_found: 'not_found',
  unknown_usernames: 'validation_error', // the list stays in `extra.usernames`
};

export type HttpOptions = {
  baseUrl: string;
  tokenStore?: TokenStore;
  fetchImpl?: typeof fetch;
  now?: () => number;
  onSignedOut: (reason: string) => void;
  onActivity?: () => void;
};

type TokenPairDto = { access_token: string; refresh_token: string; idle_timeout_seconds: number };

/** A non-2xx reply, kept raw until we know whether it is the 401 family (which needs the backend's own code). */
class Failure extends Error {
  constructor(
    public code: string,
    message: string,
    public extra: Record<string, unknown>,
  ) {
    super(message);
    Object.setPrototypeOf(this, Failure.prototype); // keeps `instanceof` working when classes are down-levelled
  }
}

const toAppError = (f: Failure) => new AppError(SAME_NAME.has(f.code) ? (f.code as AppErrorCode) : (RENAMED[f.code] ?? 'unknown'), f.message, f.extra);

/**
 * The HTTP side of server mode: Bearer header, 10 s timeout, one shared refresh, the session ending, the idle check on launch.
 * Tokens are kept in memory and written through to the store; the store is read once, lazily (and again by `resume`).
 */
export function createHttp(o: HttpOptions) {
  const baseUrl = o.baseUrl.replace(/\/+$/, '');
  const store = o.tokenStore ?? defaultTokenStore();
  const doFetch = o.fetchImpl ?? fetch;
  const now = o.now ?? Date.now;

  let mem: StoredTokens | null | undefined; // undefined = not read from the store yet
  const tokens = async () => (mem === undefined ? (mem = await store.get()) : mem);
  // Bumped by every sign-in and sign-out, so a reply that belongs to an earlier session can't write its tokens back.
  let generation = 0;

  // Writes run one after another and always write the latest state, so a slow write can't leave old tokens behind.
  // A failed write only costs a sign-in after a restart, so it never fails a request.
  let writes: Promise<unknown> = Promise.resolve();
  const persist = () => (writes = writes.catch(() => {}).then(() => (mem ? store.set(mem) : store.clear())).catch(() => {}));

  /** One round trip. Network trouble and the timeout are `network`; a non-2xx reply is a `Failure`. */
  async function send(method: string, path: string, body?: unknown, token?: string): Promise<unknown> {
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), TIMEOUT_MS);
    let status: number;
    let text: string;
    try {
      const headers: Record<string, string> = { Accept: 'application/json' };
      if (body !== undefined) headers['Content-Type'] = 'application/json';
      if (token) headers.Authorization = `Bearer ${token}`;
      const res = await doFetch(baseUrl + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), signal: abort.signal });
      status = res.status;
      text = await res.text();
    } catch {
      throw new AppError('network', SERVER_DOWN);
    } finally {
      clearTimeout(timer);
    }
    let json: unknown;
    try {
      json = text ? JSON.parse(text) : undefined;
    } catch {
      json = undefined; // not JSON: a proxy page, or some other server
    }
    if (status >= 200 && status < 300) {
      if (text && json === undefined) throw new AppError('unknown', 'Unexpected reply from the server');
      return json;
    }
    const detail = (json as { detail?: { code?: unknown; message?: unknown } } | undefined)?.detail;
    const { code, message, ...extra } = (detail && typeof detail === 'object' ? detail : {}) as Record<string, unknown>;
    throw new Failure(typeof code === 'string' ? code : 'unknown', typeof message === 'string' ? message : 'Something went wrong. Please try again.', extra);
  }

  /** `send` for calls made without a session (sign in, logout): failures become `AppError`s straight away. */
  const sendPlain = (method: string, path: string, body?: unknown, token?: string) =>
    send(method, path, body, token).catch((e) => {
      throw e instanceof Failure ? toAppError(e) : e;
    });

  /** A sign-in or sign-out: the new tokens (or none), and replies from the old session are ignored from now on. */
  function replace(next: StoredTokens | null) {
    mem = next;
    generation++;
    return persist();
  }

  /**
   * The server ended the session that `access` belongs to: forget the tokens and tell the app, once however many requests
   * were in flight. A late reply for an earlier session (signed out, or someone else signed in since) changes nothing.
   */
  async function endSession(message: string, access: string): Promise<AppError> {
    if (mem?.access === access) {
      await replace(null);
      o.onSignedOut(message);
    }
    return new AppError('session_expired', message);
  }

  let refreshing: Promise<void> | null = null;
  const refresh = () => (refreshing ??= refreshTokens().finally(() => (refreshing = null)));
  async function refreshTokens() {
    const t = mem;
    if (!t) throw new AppError('session_expired', SIGN_IN_AGAIN);
    const gen = generation;
    try {
      const pair = (await send('POST', '/auth/refresh', { refresh_token: t.refresh })) as TokenPairDto;
      if (gen !== generation) throw new AppError('session_expired', SIGN_IN_AGAIN); // signed out (or in again) meanwhile
      mem = { access: pair.access_token, refresh: pair.refresh_token, lastRequestAt: now(), idleSeconds: pair.idle_timeout_seconds };
      await persist();
    } catch (e) {
      if (!(e instanceof Failure)) throw e; // network: the tokens stay
      if (e.code === 'token_expired' || SESSION_ENDED.has(e.code)) throw await endSession(e.message, t.access);
      throw toAppError(e);
    }
  }

  async function recordActivity() {
    if (mem) {
      mem = { ...mem, lastRequestAt: now() };
      await persist();
    }
    o.onActivity?.();
  }

  return {
    /** An authenticated call. `token_expired` refreshes and retries once; the 401 family ends the session. */
    async request<T>(method: string, path: string, body?: unknown): Promise<T> {
      let t = await tokens();
      const gen = generation;
      for (let attempt = 0; ; attempt++) {
        if (!t) throw new AppError('session_expired', SIGN_IN_AGAIN);
        try {
          const out = await send(method, path, body, t.access);
          await recordActivity();
          return out as T;
        } catch (e) {
          if (!(e instanceof Failure)) throw e;
          if (e.code === 'token_expired' && attempt === 0) {
            // Another request may have refreshed while this one was in flight; then there is nothing to refresh.
            if (!mem || mem.access === t.access) await refresh();
            if (gen !== generation) throw new AppError('session_expired', SIGN_IN_AGAIN); // signed out or in again since: never retry as the next user
            t = mem ?? null;
            continue;
          }
          if (e.code === 'token_expired' || SESSION_ENDED.has(e.code)) throw await endSession(e.message, t.access);
          throw toAppError(e);
        }
      }
    },

    async login(username: string, password: string) {
      const pair = (await sendPlain('POST', '/auth/login', { username, password })) as TokenPairDto;
      await replace({ access: pair.access_token, refresh: pair.refresh_token, lastRequestAt: now(), idleSeconds: pair.idle_timeout_seconds });
    },

    /** The tokens go first; then the server is told, best effort and without waiting for its answer. */
    async logout() {
      const t = await tokens();
      await replace(null);
      if (t) sendPlain('POST', '/auth/logout', undefined, t.access).catch(() => {});
    },

    /** Drop the tokens without telling the server (a sign-in that could not finish). */
    async forget() {
      await replace(null);
    },

    /** On launch: are there tokens, and has the user been idle too long for the server to still accept them? */
    async resume(): Promise<boolean> {
      mem = await store.get();
      if (mem && now() - mem.lastRequestAt > (mem.idleSeconds - IDLE_MARGIN_SECONDS) * 1000) await replace(null);
      return mem !== null;
    },

    async hasSession() {
      return (await tokens()) !== null;
    },
  };
}
