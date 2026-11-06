import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';
import { AppError } from '../errors';
import { createServerServices } from '../server';
import { defaultTokenStore, type StoredTokens, type TokenStore } from '../server/tokens';

jest.mock('expo-secure-store', () => {
  const values = new Map<string, string>();
  return {
    getItemAsync: jest.fn(async (k: string) => values.get(k) ?? null),
    setItemAsync: jest.fn(async (k: string, v: string) => void values.set(k, v)),
    deleteItemAsync: jest.fn(async (k: string) => void values.delete(k)),
  };
});

const BASE = 'http://10.0.0.5:8000';
const NOW = 1_800_000_000_000;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// ---- fakes ----

const memoryStore = (initial: StoredTokens | null = null) => {
  const s = {
    value: initial,
    get: async () => s.value,
    set: async (t: StoredTokens) => void (s.value = t),
    clear: async () => void (s.value = null),
  };
  return s satisfies TokenStore;
};

type Call = { method: string; path: string; headers: Record<string, string>; body?: any };
type Reply = { status?: number; body?: unknown };
/** A fetch that answers with `handler(call)`; replies are `{status, body}` (body JSON-encoded) or throw to simulate a dead connection. */
function fakeFetch(handler: (c: Call) => Reply | Promise<Reply>) {
  const calls: Call[] = [];
  const fetchImpl = (async (url: string, init: RequestInit = {}) => {
    const call: Call = {
      method: init.method ?? 'GET',
      path: url.replace(BASE, ''),
      headers: (init.headers ?? {}) as Record<string, string>,
      body: init.body ? JSON.parse(init.body as string) : undefined,
    };
    calls.push(call);
    const { status = 200, body } = await handler(call);
    return { status, ok: status >= 200 && status < 300, text: async () => (body === undefined ? '' : typeof body === 'string' ? body : JSON.stringify(body)) };
  }) as unknown as typeof fetch;
  return { fetchImpl, calls };
}
const fail = (status: number, code: string, message: string, extra: object = {}): Reply => ({ status, body: { detail: { code, message, ...extra } } });
const pair = (n: number) => ({ access_token: `access-${n}`, refresh_token: `refresh-${n}`, token_type: 'bearer', expires_in: 900, idle_timeout_seconds: 600 });
const tokens = (n: number, lastRequestAt = NOW): StoredTokens => ({ access: `access-${n}`, refresh: `refresh-${n}`, lastRequestAt, idleSeconds: 600 });
const ME = { username: 'kabir.r', name: 'Kabir Rao', phone: '+919845012331', currency: 'INR' };

function make(handler: (c: Call) => Reply | Promise<Reply>, store = memoryStore(tokens(1)), baseUrl = BASE) {
  const { fetchImpl, calls } = fakeFetch(handler);
  const clock = { now: NOW };
  const onSignedOut = jest.fn();
  const onActivity = jest.fn();
  const svc = createServerServices({ baseUrl, tokenStore: store, fetchImpl, now: () => clock.now, onSignedOut, onActivity });
  return { svc, calls, store, clock, onSignedOut, onActivity };
}
const rejects = async (p: Promise<unknown>, code: string) => {
  const err = await p.then(
    () => null,
    (e) => e,
  );
  expect(err).toBeInstanceOf(AppError);
  expect(err.code).toBe(code);
  return err as AppError;
};
const bearer = (c: Call) => c.headers.Authorization;

// ---- fixtures: shaped like the backend's responses ----

const person = (username: string, name: string) => ({ username, name });
const KABIR = person('kabir.r', 'Kabir Rao');
const ARUN = person('arun.n', 'Arun Nair');
const SWETHA = person('swetha.i', 'Swetha Iyer');
const PRIYA = person('priya.m', 'Priya Menon');
const expense = (id: number, description: string, amount: number, paidBy: object, date: string, mine: number | null, extra: object = {}) => ({
  id,
  description,
  amount_minor: amount,
  split_type: 'equal',
  paid_by: paidBy,
  created_by: paidBy,
  date,
  created_at: `${date}T08:00:00Z`,
  updated_at: `${date}T08:00:00Z`,
  my_share_minor: mine,
  my_share_status: mine === null ? null : 'accepted',
  disputed: false,
  ...extra,
});
const GOA = {
  id: 2,
  name: 'Goa Trip',
  icon: 'trip',
  currency: 'INR',
  owner_username: 'arun.n',
  created_at: '2026-10-01T06:00:00.123456Z',
  balance_minor: 150000,
  members: [
    { ...KABIR, position: 1 },
    { ...ARUN, position: 2 },
    { ...SWETHA, position: 3 },
    { ...PRIYA, position: 4 },
  ],
  expenses: [
    expense(14, 'Taxi', 50000, KABIR, '2026-11-03', null), // I paid, I have no share
    expense(13, 'Shack', 280000, SWETHA, '2026-11-03', null, { disputed: true }), // not involved
    expense(12, 'Scooters', 600000, KABIR, '2026-11-02', 150000), // I paid, my own share is 1500
    expense(11, 'Villa', 1200000, ARUN, '2026-10-20', 300000), // Arun paid, I owe 3000
  ],
  settlements: [
    { id: 6, from_user: PRIYA, to_user: KABIR, amount_minor: 100000, status: 'pending', created_at: '2026-11-04T09:30:00Z', answered_at: null },
    { id: 5, from_user: KABIR, to_user: ARUN, amount_minor: 200000, status: 'confirmed', created_at: '2026-10-25T10:00:00Z', answered_at: '2026-10-25T11:00:00Z' },
  ],
  pairwise: [
    { debtor: PRIYA, creditor: KABIR, amount_minor: 450000 },
    { debtor: KABIR, creditor: ARUN, amount_minor: 300000 },
    { debtor: SWETHA, creditor: ARUN, amount_minor: 10000 }, // not the viewer's pair
  ],
};
const card = (id: number, name: string, currency: string, balance: number, open: number, cpCount: number, cpName: string | null, last: string) => ({
  id,
  name,
  icon: 'home',
  currency,
  member_count: 3,
  balance_minor: balance,
  open_balances: open,
  counterparty_name: cpName,
  counterparty_count: cpCount,
  last_activity_at: last,
});
// The "Seed expected values" table of the plan.
const HOME = {
  overall: [
    { currency: 'INR', net_minor: 966666, owe_minor: 87334, owed_minor: 1054000 },
    { currency: 'USD', net_minor: 3500, owe_minor: 0, owed_minor: 3500 },
  ],
  spaces: [
    card(1, 'Flat 4B', 'INR', -47334, 2, 2, null, '2026-11-05T10:00:00Z'),
    card(4, 'Dubai stopover', 'USD', 3500, 1, 1, 'Meera Shah', '2026-11-04T10:00:00Z'),
    card(5, 'Sunday cricket', 'INR', 0, 2, 0, null, '2026-11-03T10:00:00Z'),
  ],
};
const note = (id: number, over: object = {}) => ({
  id,
  type: 'expense_share',
  message: 'Swetha added ‘Dinner’ — your share is ₹14',
  space_id: 1,
  space_name: 'Flat 4B',
  ref_id: 9,
  needs_answer: true,
  read: false,
  created_at: '2026-11-05T08:00:00Z',
  ...over,
});

describe('sign in, restore, sign out', () => {
  it('signIn stores tokens and loads /users/me', async () => {
    const { svc, calls, store, onActivity } = make(
      (c) => (c.path === '/auth/login' ? { body: pair(1) } : { body: ME }),
      memoryStore(),
    );
    const user = await svc.auth.signIn('kabir.r', 'demo1234');
    expect(user).toEqual({ id: 'kabir.r', username: 'kabir.r', name: 'Kabir Rao', phone: '+919845012331', phoneVerified: true, avatarUrl: null, plate: 4 });
    expect(calls.map((c) => `${c.method} ${c.path}`)).toEqual(['POST /auth/login', 'GET /users/me']);
    expect(calls[0].body).toEqual({ username: 'kabir.r', password: 'demo1234' });
    expect(bearer(calls[0])).toBeUndefined();
    expect(bearer(calls[1])).toBe('Bearer access-1');
    expect(store.value).toEqual({ access: 'access-1', refresh: 'refresh-1', lastRequestAt: NOW, idleSeconds: 600 });
    expect(onActivity).toHaveBeenCalled();
  });

  it('a wrong password and a lockout keep the server code and detail', async () => {
    const wrong = make(() => fail(401, 'invalid_credentials', 'Incorrect username or password.'), memoryStore());
    const err = await rejects(wrong.svc.auth.signIn('kabir.r', 'nope'), 'invalid_credentials');
    expect(err.message).toBe('Incorrect username or password.');
    expect(wrong.store.value).toBeNull();
    expect(wrong.onSignedOut).not.toHaveBeenCalled();

    const locked = make(() => fail(429, 'too_many_attempts', 'Too many failed attempts.', { retry_after_seconds: 840 }), memoryStore());
    expect((await rejects(locked.svc.auth.signIn('kabir.r', 'nope'), 'too_many_attempts')).extra).toEqual({ retry_after_seconds: 840 });
  });

  it('a sign-in whose /users/me fails leaves no tokens behind', async () => {
    const { svc, store } = make(
      (c) => {
        if (c.path === '/auth/login') return { body: pair(1) };
        throw new TypeError('Network request failed');
      },
      memoryStore(),
    );
    await rejects(svc.auth.signIn('kabir.r', 'demo1234'), 'network');
    expect(store.value).toBeNull();
  });

  it('restore after idle returns null', async () => {
    const idle = make(() => ({ body: ME }), memoryStore(tokens(1, NOW - 571_000)));
    expect(await idle.svc.auth.restore()).toBeNull();
    expect(idle.store.value).toBeNull();
    expect(idle.calls).toHaveLength(0);

    const active = make(() => ({ body: ME }), memoryStore(tokens(1, NOW - 500_000)));
    expect((await active.svc.auth.restore())?.username).toBe('kabir.r');
    expect(active.calls.map((c) => c.path)).toEqual(['/users/me']);
    expect(active.store.value).not.toBeNull();

    // The limit is idle_timeout_seconds − 30, and exactly at it still counts as active.
    const edge = make(() => ({ body: ME }), memoryStore(tokens(1, NOW - 570_000)));
    expect(await edge.svc.auth.restore()).not.toBeNull();
  });

  it('restore with nothing stored, or with a session the server already ended, gives null', async () => {
    const none = make(() => ({ body: ME }), memoryStore());
    expect(await none.svc.auth.restore()).toBeNull();
    expect(none.calls).toHaveLength(0);

    const ended = make(() => fail(401, 'session_expired', 'You were signed out after 10 minutes of inactivity.'));
    expect(await ended.svc.auth.restore()).toBeNull();
    expect(ended.store.value).toBeNull();
  });

  it('signOut calls /auth/logout, ignores its failure and clears the tokens without calling onSignedOut', async () => {
    const { svc, calls, store, onSignedOut } = make((c) => {
      if (c.path === '/auth/logout') throw new TypeError('Network request failed');
      return { body: ME };
    });
    await svc.auth.signOut();
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ method: 'POST', path: '/auth/logout' });
    expect(bearer(calls[0])).toBe('Bearer access-1');
    expect(store.value).toBeNull();
    expect(onSignedOut).not.toHaveBeenCalled();
    await rejects(svc.spaces.list(), 'session_expired');
  });
});

describe('the session', () => {
  it('single-flight refresh: parallel token_expired makes one /auth/refresh and retries each request once', async () => {
    let valid = 'access-0'; // the stored access-1 is already expired
    const { svc, calls, store } = make(async (c) => {
      if (c.path === '/auth/refresh') {
        await sleep(5);
        expect(c.body).toEqual({ refresh_token: 'refresh-1' });
        valid = 'access-2';
        return { body: pair(2) };
      }
      if (bearer(c) !== `Bearer ${valid}`) return fail(401, 'token_expired', 'Access token expired. Refresh it.');
      return { body: c.path === '/spaces' ? HOME : { unread_count: 3 } };
    });
    const [list, unread] = await Promise.all([svc.spaces.list(), svc.notifications.unreadCount()]);
    expect(list).toHaveLength(3);
    expect(unread).toBe(3);
    expect(calls.filter((c) => c.path === '/auth/refresh')).toHaveLength(1);
    expect(calls.filter((c) => c.path === '/spaces')).toHaveLength(2);
    expect(calls.filter((c) => c.path.startsWith('/notifications'))).toHaveLength(2);
    expect(store.value).toMatchObject({ access: 'access-2', refresh: 'refresh-2', idleSeconds: 600 });
  });

  it('a token_expired that arrives after another request already refreshed retries without refreshing again', async () => {
    let valid = 'access-0'; // the stored access-1 is already expired
    const { svc, calls } = make(async (c) => {
      if (c.path === '/auth/refresh') {
        await sleep(5);
        valid = 'access-2';
        return { body: pair(2) };
      }
      if (bearer(c) !== `Bearer ${valid}`) {
        if (c.path.startsWith('/notifications')) await sleep(40); // this 401 is slow: it lands after the refresh finished
        return fail(401, 'token_expired', 'Access token expired. Refresh it.');
      }
      return { body: c.path === '/spaces' ? HOME : { unread_count: 1 } };
    });
    await Promise.all([svc.spaces.list(), svc.notifications.unreadCount()]);
    expect(calls.filter((c) => c.path === '/auth/refresh')).toHaveLength(1);
    expect(calls.filter((c) => c.path.startsWith('/notifications'))).toHaveLength(2);
  });

  it('a request that is still token_expired after the refresh signs out instead of looping', async () => {
    const { svc, calls, onSignedOut } = make((c) => (c.path === '/auth/refresh' ? { body: pair(2) } : fail(401, 'token_expired', 'Access token expired.')));
    await rejects(svc.spaces.list(), 'session_expired');
    expect(calls.map((c) => c.path)).toEqual(['/spaces', '/auth/refresh', '/spaces']);
    expect(onSignedOut).toHaveBeenCalledTimes(1);
  });

  it('session_expired signs out: onSignedOut once, the store cleared, every caller rejected', async () => {
    const message = 'You were signed out after 10 minutes of inactivity.';
    const { svc, calls, store, onSignedOut } = make(() => fail(401, 'session_expired', message));
    const [a, b] = await Promise.all([rejects(svc.spaces.list(), 'session_expired'), rejects(svc.notifications.list(), 'session_expired')]);
    expect(a.message).toBe(message);
    expect(b.message).toBe(message);
    expect(onSignedOut).toHaveBeenCalledTimes(1);
    expect(onSignedOut).toHaveBeenCalledWith(message);
    expect(store.value).toBeNull();
    const sent = calls.length;
    await rejects(svc.spaces.list(), 'session_expired'); // nobody signed in: fails without a request, and without a second callback
    expect(calls).toHaveLength(sent);
    expect(onSignedOut).toHaveBeenCalledTimes(1);
  });

  it.each(['invalid_token', 'not_authenticated', 'invalid_refresh_token'])('%s also signs out', async (code) => {
    const { svc, store, onSignedOut } = make(() => fail(401, code, 'Please sign in again.'));
    await rejects(svc.spaces.list(), 'session_expired');
    expect(onSignedOut).toHaveBeenCalledWith('Please sign in again.');
    expect(store.value).toBeNull();
  });

  it('a refresh refused with invalid_refresh_token signs out', async () => {
    const { svc, store, onSignedOut } = make((c) =>
      c.path === '/auth/refresh' ? fail(401, 'invalid_refresh_token', 'Invalid refresh token. Please sign in again.') : fail(401, 'token_expired', 'Access token expired.'),
    );
    await rejects(svc.spaces.list(), 'session_expired');
    expect(onSignedOut).toHaveBeenCalledTimes(1);
    expect(store.value).toBeNull();
  });

  it('network failure keeps session: fetch rejects, the code is network and the tokens stay', async () => {
    let down = true;
    const { svc, store, onSignedOut } = make(() => {
      if (down) throw new TypeError('Network request failed');
      return { body: HOME };
    });
    await rejects(svc.spaces.list(), 'network');
    expect(store.value).toEqual(tokens(1));
    expect(onSignedOut).not.toHaveBeenCalled();
    down = false;
    expect(await svc.spaces.list()).toHaveLength(3); // still signed in once the server is back
  });

  it('a refresh that cannot reach the server keeps the session too', async () => {
    const { svc, store, onSignedOut } = make((c) => {
      if (c.path === '/auth/refresh') throw new TypeError('Network request failed');
      return fail(401, 'token_expired', 'Access token expired.');
    });
    await rejects(svc.spaces.list(), 'network');
    expect(store.value).toEqual(tokens(1));
    expect(onSignedOut).not.toHaveBeenCalled();
  });

  it('a request that takes longer than 10 seconds is aborted and reports network', async () => {
    jest.useFakeTimers();
    try {
      const fetchImpl = ((_url: string, init: RequestInit) =>
        new Promise((_resolve, reject) => init.signal!.addEventListener('abort', () => reject(new Error('aborted'))))) as unknown as typeof fetch;
      const store = memoryStore(tokens(1));
      const svc = createServerServices({ baseUrl: BASE, tokenStore: store, fetchImpl, now: () => NOW, onSignedOut: jest.fn() });
      const outcome = rejects(svc.spaces.list(), 'network');
      await jest.advanceTimersByTimeAsync(10_000);
      await outcome;
      expect(store.value).toEqual(tokens(1));
    } finally {
      jest.useRealTimers();
    }
  });

  it('every request carries the Bearer token; each success moves lastRequestAt and calls onActivity', async () => {
    const { svc, calls, store, clock, onActivity } = make(() => ({ body: HOME }), memoryStore(tokens(1)), `${BASE}/`);
    clock.now = NOW + 90_000;
    await svc.spaces.list();
    expect(calls[0].path).toBe('/spaces'); // the trailing slash of baseUrl is dropped
    expect(bearer(calls[0])).toBe('Bearer access-1');
    expect(store.value?.lastRequestAt).toBe(NOW + 90_000);
    expect(onActivity).toHaveBeenCalledTimes(1);
  });

  it('a failed request does not count as activity', async () => {
    const { svc, store, clock, onActivity } = make(() => fail(500, 'internal_error', 'Something went wrong on our side.'));
    clock.now = NOW + 60_000;
    await rejects(svc.spaces.list(), 'unknown');
    expect(store.value?.lastRequestAt).toBe(NOW);
    expect(onActivity).not.toHaveBeenCalled();
  });
});

describe('errors', () => {
  it.each([
    [404, 'space_not_found', 'not_found'],
    [404, 'notification_not_found', 'not_found'],
    [404, 'not_found', 'not_found'],
    [422, 'validation_error', 'validation_error'],
    [500, 'internal_error', 'unknown'],
    [405, 'method_not_allowed', 'unknown'],
    [409, 'username_taken', 'username_taken'],
  ])('%i %s becomes %s', async (status, code, expected) => {
    const { svc } = make(() => fail(status, code, 'Server message.'));
    const err = await rejects(svc.spaces.get('1'), expected);
    expect(err.message).toBe('Server message.');
  });

  it('keeps the field list of a validation error and the usernames of an unknown_usernames error', async () => {
    const fields = [{ field: 'name', message: 'Too long' }];
    const a = make(() => fail(422, 'validation_error', 'Some fields are invalid.', { fields }));
    expect((await rejects(a.svc.spaces.get('1'), 'validation_error')).extra).toEqual({ fields });

    const b = make(() => fail(422, 'unknown_usernames', 'Some of these usernames do not exist.', { usernames: ['ghost'] }));
    const err = await rejects(b.svc.spaces.create({ name: 'Trip', icon: 'trip', currency: 'INR', memberIds: ['ghost'] }), 'validation_error');
    expect(err.extra).toEqual({ usernames: ['ghost'] });
  });

  it('a reply that is not the error envelope is unknown', async () => {
    const html = make(() => ({ status: 502, body: '<html>Bad gateway</html>' }));
    expect((await rejects(html.svc.spaces.list(), 'unknown')).message).toMatch(/something went wrong/i);
    const garbage = make(() => ({ status: 200, body: '<html>captive portal</html>' }));
    await rejects(garbage.svc.spaces.list(), 'unknown');
  });
});

describe('spaces', () => {
  it('list maps the cards; overall keeps the server order', async () => {
    const { svc } = make(() => ({ body: HOME }));
    const rows = await svc.spaces.list();
    expect(rows.map((r) => r.space.name)).toEqual(['Flat 4B', 'Dubai stopover', 'Sunday cricket']);
    expect(rows[1]).toEqual({
      space: { id: '4', name: 'Dubai stopover', icon: 'home', currency: 'USD', ownerId: '', memberIds: [], serial: 4, createdAt: Date.parse('2026-11-04T10:00:00Z') },
      balance: { spaceId: '4', currency: 'USD', netMinor: 3500, pairs: [], openBalances: 1, counterpartyName: 'Meera Shah', counterpartyCount: 1, settled: false },
      lastActivity: Date.parse('2026-11-04T10:00:00Z'),
    });
    expect(rows[0].balance).toMatchObject({ netMinor: -47334, openBalances: 2, counterpartyName: null, counterpartyCount: 2, settled: false });
    expect(rows[2].balance).toMatchObject({ netMinor: 0, openBalances: 2, counterpartyCount: 0, settled: false }); // net 0 but two open pairs
    expect(await svc.spaces.overall()).toEqual([
      { currency: 'INR', netMinor: 966666, oweMinor: 87334, owedMinor: 1054000 },
      { currency: 'USD', netMinor: 3500, oweMinor: 0, owedMinor: 3500 },
    ]);
  });

  it('an unknown icon key falls back to other', async () => {
    const { svc } = make(() => ({ body: { overall: [], spaces: [{ ...HOME.spaces[0], icon: 'rocket' }] } }));
    expect((await svc.spaces.list())[0].space.icon).toBe('other');
  });

  it('maps space detail', async () => {
    const { svc, calls } = make((c) => ({ body: c.path === '/users/me' ? ME : GOA }));
    const { space, members, balance, activity } = await svc.spaces.get('2');
    expect(calls.map((c) => c.path)).toContain('/spaces/2');

    expect(space).toEqual({ id: '2', name: 'Goa Trip', icon: 'trip', currency: 'INR', ownerId: 'arun.n', memberIds: ['kabir.r', 'arun.n', 'swetha.i', 'priya.m'], serial: 2, createdAt: Date.parse('2026-10-01T06:00:00.123Z') });
    expect(members.map((m) => [m.id, m.plate, m.phone])).toEqual([
      ['kabir.r', 1, '+919845012331'], // plate = ((position − 1) % 6) + 1; the phone is only known for the viewer
      ['arun.n', 2, null],
      ['swetha.i', 3, null],
      ['priya.m', 4, null],
    ]);
    expect(members[1]).toEqual({ id: 'arun.n', username: 'arun.n', name: 'Arun Nair', phone: null, phoneVerified: true, avatarUrl: null, plate: 2 });

    // + = they owe the viewer; lines that do not involve the viewer are left out; member order.
    expect(balance).toEqual({
      spaceId: '2',
      currency: 'INR',
      netMinor: 150000,
      pairs: [
        { userId: 'arun.n', name: 'Arun Nair', netMinor: -300000 },
        { userId: 'priya.m', name: 'Priya Menon', netMinor: 450000 },
      ],
      openBalances: 2,
      counterpartyName: 'Priya Menon',
      counterpartyCount: 1,
      settled: false,
    });

    // Newest first: the payment of 4 Nov, then 3 Nov (server order kept), 2 Nov, the 25 Oct payment, 20 Oct.
    expect(activity.map((a) => `${a.kind}:${a.id}`)).toEqual(['payment:6', 'expense:14', 'expense:13', 'expense:12', 'payment:5', 'expense:11']);
    const row = (id: string) => activity.find((a) => a.kind === 'expense' && a.id === id);
    expect(row('11')).toMatchObject({ description: 'Villa', amountMinor: 1200000, paidById: 'arun.n', paidByName: 'Arun Nair', myPartMinor: -300000, myResponse: 'accepted', disputed: false }); // I owe my share
    expect(row('12')).toMatchObject({ paidById: 'kabir.r', myPartMinor: 450000 }); // I paid: the others owe me amount − my share
    expect(row('13')).toMatchObject({ myPartMinor: null, myResponse: null, disputed: true }); // not involved
    expect(row('14')).toMatchObject({ myPartMinor: 50000, myResponse: null }); // I paid and have no share: all of it is owed to me
    expect(activity.find((a) => a.kind === 'payment' && a.id === '6')).toEqual({
      kind: 'payment',
      id: '6',
      date: Date.parse('2026-11-04T09:30:00Z'),
      fromId: 'priya.m',
      fromName: 'Priya Menon',
      toId: 'kabir.r',
      toName: 'Kabir Rao',
      amountMinor: 100000,
      status: 'pending',
    });
    // An expense's YYYY-MM-DD is that calendar day on the device (local midnight), whatever the time zone.
    const day = new Date(row('13')!.date);
    expect([day.getFullYear(), day.getMonth(), day.getDate(), day.getHours()]).toEqual([2026, 10, 3, 0]);
  });

  it('a share of 0 that someone else paid is 0, not −0', async () => {
    const detail = { ...GOA, expenses: [expense(20, 'Free', 1000, ARUN, '2026-11-01', 0)] };
    const { svc } = make((c) => ({ body: c.path === '/users/me' ? ME : detail }));
    expect(Object.is((await svc.spaces.get('2')).activity.find((a) => a.kind === 'expense')!.myPartMinor, 0)).toBe(true);
  });

  it('a space where every pair is zero is settled with no counterparty', async () => {
    const { svc } = make((c) => ({ body: c.path === '/users/me' ? ME : { ...GOA, balance_minor: 0, pairwise: [], expenses: [], settlements: [] } }));
    const d = await svc.spaces.get('2');
    expect(d.balance).toMatchObject({ pairs: [], openBalances: 0, counterpartyName: null, counterpartyCount: 0, settled: true });
    expect(d).toMatchObject({ settledMemberIds: ['kabir.r', 'arun.n', 'swetha.i', 'priya.m'], allSettled: true });
  });

  it('who is settled reads every pair in the space, the viewer’s or not', async () => {
    // The viewer is square with everyone, but Swetha owes Arun: neither of them is settled, and the space isn't.
    const pairwise = [{ debtor: SWETHA, creditor: ARUN, amount_minor: 10000 }];
    const { svc } = make((c) => ({ body: c.path === '/users/me' ? ME : { ...GOA, balance_minor: 0, pairwise } }));
    const d = await svc.spaces.get('2');
    expect(d.balance.settled).toBe(true);
    expect(d).toMatchObject({ settledMemberIds: ['kabir.r', 'priya.m'], allSettled: false });

    const goa = await make((c) => ({ body: c.path === '/users/me' ? ME : GOA })).svc.spaces.get('2');
    expect(goa).toMatchObject({ settledMemberIds: [], allSettled: false }); // all four are in an open pair
  });

  it('create posts the usernames and returns the new space', async () => {
    const { svc, calls } = make((c) => (c.path === '/users/me' ? { body: ME } : { status: 201, body: { ...GOA, id: 9, name: 'Trip', currency: 'USD', owner_username: 'kabir.r' } }));
    const space = await svc.spaces.create({ name: 'Trip', icon: 'trip', currency: 'USD', memberIds: ['meera.s'] });
    const post = calls.find((c) => c.method === 'POST')!;
    expect(post.path).toBe('/spaces');
    expect(post.body).toEqual({ name: 'Trip', icon: 'trip', currency: 'USD', usernames: ['meera.s'] });
    expect(space).toMatchObject({ id: '9', name: 'Trip', currency: 'USD', ownerId: 'kabir.r' });
  });
});

describe('notifications and people', () => {
  it('maps the cards; the id and ref are strings, userId is the signed-in username', async () => {
    const { svc, calls } = make((c) =>
      c.path === '/users/me'
        ? { body: ME }
        : { body: { items: [note(7), note(6, { type: 'space_deleted', space_id: null, ref_id: null, needs_answer: false, read: true })], next_before: null, unread_count: 1 } },
    );
    const list = await svc.notifications.list();
    expect(calls.find((c) => c.path.startsWith('/notifications'))!.path).toBe('/notifications?limit=50');
    expect(list[0]).toEqual({
      id: '7',
      userId: 'kabir.r',
      type: 'expense_share',
      message: 'Swetha added ‘Dinner’ — your share is ₹14',
      spaceId: '1',
      spaceName: 'Flat 4B',
      refId: '9',
      needsAnswer: true,
      read: false,
      createdAt: Date.parse('2026-11-05T08:00:00Z'),
    });
    expect(list[1]).toMatchObject({ id: '6', spaceId: null, refId: null, read: true });
  });

  it('unreadCount, markRead and markAllRead', async () => {
    const { svc, calls } = make((c) => {
      if (c.path === '/notifications/read-all') return { body: { updated_count: 2 } };
      if (c.method === 'PATCH') return { body: note(7, { read: true }) };
      return { body: { unread_count: 4 } };
    });
    expect(await svc.notifications.unreadCount()).toBe(4);
    await svc.notifications.markRead('7');
    expect(await svc.notifications.markAllRead()).toBeUndefined(); // the count is ignored
    expect(calls.map((c) => `${c.method} ${c.path}`)).toEqual(['GET /notifications/unread-count', 'PATCH /notifications/7', 'PATCH /notifications/read-all']);
    expect(calls[1].body).toEqual({ read: true });
  });

  it('search turns a digits query into the viewer’s E.164 number and sends anything else as typed', async () => {
    const { svc, calls } = make((c) => ({
      body: c.path === '/users/me' ? ME : c.path.includes('rohan') || c.path.includes('%2B91') ? [{ username: 'rohan.d', name: 'Rohan Das', is_friend: true }] : [],
    }));
    const found = await svc.users.search('98300 45566');
    expect(found).toEqual([{ id: 'rohan.d', username: 'rohan.d', name: 'Rohan Das', phone: null, phoneVerified: true, avatarUrl: null, plate: expect.any(Number) }]);
    expect(found[0].plate).toBeGreaterThanOrEqual(1);
    expect(found[0].plate).toBeLessThanOrEqual(6);

    await svc.users.search('+971 50 123 4567');
    await svc.users.search('123'); // not a whole valid number: sent as typed
    await svc.users.search('@roha');
    await svc.users.search('  ');
    const paths = calls.filter((c) => c.path.startsWith('/users/search')).map((c) => c.path);
    expect(paths).toEqual(['/users/search?q=%2B919830045566', '/users/search?q=%2B971501234567', '/users/search?q=123', '/users/search?q=roha']);
  });
});

describe('profile and the operations the server cannot do yet', () => {
  it('profile.get and getPreferences come from /users/me; debug is null', async () => {
    const { svc } = make(() => ({ body: ME }));
    expect(svc.mode).toBe('server');
    expect(svc.debug).toBeNull();
    expect((await svc.profile.get()).name).toBe('Kabir Rao');
    expect(await svc.profile.getPreferences()).toEqual({ defaultCurrency: 'INR', theme: 'system', notificationsOn: true });
  });

  it('getPreferences works before anyone signs in', async () => {
    const { svc, calls } = make(() => ({ body: ME }), memoryStore());
    expect(await svc.profile.getPreferences()).toEqual({ defaultCurrency: 'INR', theme: 'system', notificationsOn: true });
    expect(calls).toHaveLength(0);
  });

  it('notOnServer: expenses.create rejects with code not_on_server', async () => {
    const { svc } = make(() => ({ body: ME }));
    const err = await rejects(
      svc.expenses.create({ spaceId: '1', description: 'x', amountMinor: 100, paidBy: 'kabir.r', splitType: 'equal', shares: [], date: NOW }),
      'not_on_server',
    );
    expect(err.message).toBe('Not available on this server yet');
  });

  it('every operation without an endpoint rejects with not_on_server and makes no request', async () => {
    const { svc, calls } = make(() => ({ body: ME }));
    const expenseInput = { spaceId: '1', description: 'x', amountMinor: 100, paidBy: 'kabir.r', splitType: 'equal' as const, shares: [], date: NOW };
    const all: [string, () => Promise<unknown>][] = [
      ['auth.signUp', () => svc.auth.signUp({ username: 'a', name: 'A', phone: '+919845012331', password: 'x' })],
      ['auth.verifySignUpOtp', () => svc.auth.verifySignUpOtp('p', '123456')],
      ['auth.resendOtp', () => svc.auth.resendOtp('p')],
      ['auth.checkUsername', () => svc.auth.checkUsername('a')],
      ['auth.checkPhone', () => svc.auth.checkPhone('+919845012331')],
      ['auth.requestResetOtp', () => svc.auth.requestResetOtp('a')],
      ['auth.verifyResetOtp', () => svc.auth.verifyResetOtp('r', '123456')],
      ['auth.resetPassword', () => svc.auth.resetPassword('t', 'x')],
      ['spaces.update', () => svc.spaces.update('1', { name: 'x' })],
      ['spaces.addMembers', () => svc.spaces.addMembers('1', ['a'])],
      ['spaces.removeMember', () => svc.spaces.removeMember('1', 'a')],
      ['spaces.leave', () => svc.spaces.leave('1')],
      ['spaces.remove', () => svc.spaces.remove('1')],
      ['expenses.get', () => svc.expenses.get('1')],
      ['expenses.create', () => svc.expenses.create(expenseInput)],
      ['expenses.update', () => svc.expenses.update('1', expenseInput)],
      ['expenses.remove', () => svc.expenses.remove('1')],
      ['expenses.acceptShare', () => svc.expenses.acceptShare('1')],
      ['expenses.rejectShare', () => svc.expenses.rejectShare('1')],
      ['settlements.get', () => svc.settlements.get('1')],
      ['settlements.payees', () => svc.settlements.payees('1')],
      ['settlements.create', () => svc.settlements.create({ spaceId: '1', toUserId: 'a', amountMinor: 100 })],
      ['settlements.confirm', () => svc.settlements.confirm('1')],
      ['settlements.reject', () => svc.settlements.reject('1')],
      ['settlements.cancel', () => svc.settlements.cancel('1')],
      ['transactions.list', () => svc.transactions.list({ kind: 'all' })],
      ['profile.update', () => svc.profile.update({ name: 'x' })],
      ['profile.setPreferences', () => svc.profile.setPreferences({ defaultCurrency: 'INR', theme: 'dark', notificationsOn: false })],
    ];
    for (const [, run] of all) await rejects(run(), 'not_on_server');
    expect(calls).toHaveLength(0);
  });
});

describe('the default token store', () => {
  const t = tokens(1);
  const KEY = 'uomi.server.tokens';

  it('keeps one JSON value in SecureStore on a phone', async () => {
    const store = defaultTokenStore();
    expect(await store.get()).toBeNull();
    await store.set(t);
    expect(SecureStore.setItemAsync).toHaveBeenCalledWith(KEY, JSON.stringify(t));
    expect(await store.get()).toEqual(t);
    expect(await AsyncStorage.getItem(KEY)).toBeNull();
    await store.clear();
    expect(await store.get()).toBeNull();
  });

  it('uses AsyncStorage in a browser, where SecureStore does not exist', async () => {
    const os = jest.replaceProperty(Platform, 'OS', 'web');
    try {
      const store = defaultTokenStore();
      await store.set(t);
      expect(JSON.parse((await AsyncStorage.getItem(KEY))!)).toEqual(t);
      expect(await store.get()).toEqual(t);
      await store.clear();
      expect(await AsyncStorage.getItem(KEY)).toBeNull();
    } finally {
      os.restore();
    }
  });

  it('reads damaged or foreign values as no tokens', async () => {
    const store = defaultTokenStore();
    await SecureStore.setItemAsync(KEY, '{not json');
    expect(await store.get()).toBeNull();
    await SecureStore.setItemAsync(KEY, JSON.stringify({ access: 1 }));
    expect(await store.get()).toBeNull();
    await store.clear();
  });
});
