import path from 'path';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { AppState, BackHandler, Text } from 'react-native';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { renderRouter, screen as routerScreen } from 'expo-router/testing-library';
import { Stack, router } from 'expo-router';
import { QueryClientProvider, focusManager, useQuery } from '@tanstack/react-query';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import type { ReactNode } from 'react';
import type { User } from '../domain/types';
import { ThemeProvider } from '../theme/ThemeProvider';
import { useSession } from '../state/session';
import { FAKE_SERVER_URL } from '../../test-support/server';
import { markActivity, refetchOnForeground, useIdleSignOut } from '../state/idle';
import { currentServices } from '../services/useServices';
import { qk, queryClient } from '../services/queries';
import { TabBar } from '../ui/TabBar';
import { OtpInput } from '../ui/OtpInput';
import { StateBox } from '../ui/StateBox';
import { ConfirmHost } from '../ui/ConfirmDialog';
import { ToastHost } from '../ui/Toast';
import { ServerSettingsSheet } from '../ui/ServerSettingsSheet';
import { useDiscardGuard } from '../ui/useDiscardGuard';

jest.mock('expo-secure-store', () => {
  const values = new Map<string, string>();
  return {
    getItemAsync: jest.fn(async (k: string) => values.get(k) ?? null),
    setItemAsync: jest.fn(async (k: string, v: string) => void values.set(k, v)),
    deleteItemAsync: jest.fn(async (k: string) => void values.delete(k)),
  };
});

const APP = path.join(__dirname, '../../app');
const KABIR: User = { id: 'u_kabir', username: 'kabir.r', name: 'Kabir Rao', email: null, emailVerified: true, avatarUrl: null, plate: 1 };
const METRICS = { frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 47, left: 0, right: 0, bottom: 34 } };

function Providers({ children }: { children: ReactNode }) {
  return (
    <ThemeProvider>
      <QueryClientProvider client={queryClient}>
        <SafeAreaProvider initialMetrics={METRICS}>{children}</SafeAreaProvider>
      </QueryClientProvider>
    </ThemeProvider>
  );
}

/** Captures BackHandler listeners (the router's and ours) so a test can press the Android back button. */
type BackListener = Parameters<typeof BackHandler.addEventListener>[1];
let backHandlers: BackListener[] = [];
function pressHardwareBack() {
  for (const h of [...backHandlers].reverse()) if (h({} as Parameters<BackListener>[0])) return true;
  return false;
}

beforeEach(async () => {
  backHandlers = [];
  jest.spyOn(BackHandler, 'addEventListener').mockImplementation((_event, handler) => {
    backHandlers.push(handler);
    return { remove: () => void (backHandlers = backHandlers.filter((h) => h !== handler)) };
  });
  jest.mocked(AppState.addEventListener).mockClear();
  queryClient.clear();
  useSession.setState({ serverUrl: FAKE_SERVER_URL, user: null, landing: '/welcome' });
});

/** Brings the app back to the foreground with the clock `ms` ahead (background timers don't run). */
async function resumeAfter(ms: number) {
  const real = Date.now;
  const spy = jest.spyOn(Date, 'now').mockImplementation(() => real() + ms);
  for (const [event, handler] of jest.mocked(AppState.addEventListener).mock.calls) {
    if (event === 'change') await act(async () => void handler('active'));
  }
  spy.mockRestore();
}

afterEach(async () => {
  jest.restoreAllMocks();
  jest.useRealTimers();
  // Tests that sign in to the fake backend leave it signed out again, so the next launch doesn't restore them.
  useSession.setState({ serverUrl: FAKE_SERVER_URL });
  await currentServices().auth.signOut();
});

describe('navigation gate', () => {
  it('signed out shows Welcome', async () => {
    const r = await renderRouter(APP);
    await waitFor(() => expect(r.getPathname()).toBe('/welcome'));
    expect(routerScreen.getByText('UOMi')).toBeTruthy();
  });

  it('signing in leaves the auth screens; signing out returns to Welcome with the reason', async () => {
    const r = await renderRouter(APP);
    await waitFor(() => expect(r.getPathname()).toBe('/welcome'));
    await act(async () => useSession.getState().signedIn(KABIR));
    await waitFor(() => expect(r.getPathname()).toBe('/'));
    await act(async () => router.push('/space/s1/settle'));
    expect(r.getPathname()).toBe('/space/s1/settle');
    await act(async () => useSession.getState().signedOut('You were signed out'));
    await waitFor(() => expect(r.getPathname()).toBe('/welcome'));
    expect(routerScreen.getByText('You were signed out')).toBeTruthy();
  });

  it('a restored session opens Home with the tab bar', async () => {
    await currentServices().auth.signIn('kabir.r', 'demo1234');
    const r = await renderRouter(APP);
    await waitFor(() => expect(r.getPathname()).toBe('/'));
    expect(useSession.getState().user?.username).toBe('kabir.r');
    expect(routerScreen.getByRole('tab', { name: 'Home' })).toBeTruthy();
  });

  it('idle expiry on a deep screen lands on Sign In with the toast, and Back reaches Welcome', async () => {
    await currentServices().auth.signIn('kabir.r', 'demo1234');
    const r = await renderRouter(APP);
    await waitFor(() => expect(r.getPathname()).toBe('/'));
    // A signed-in user is all the idle timer watches; no server round trip is needed.
    await act(async () => useSession.setState({ serverUrl: 'http://x' }));
    await act(async () => router.push('/space/s1/settle'));
    expect(r.getPathname()).toBe('/space/s1/settle');

    await resumeAfter(600_000);
    await waitFor(() => expect(r.getPathname()).toBe('/signin'));
    expect(routerScreen.getByText('You were signed out after 10 minutes of inactivity.')).toBeTruthy();
    await act(async () => router.back());
    expect(r.getPathname()).toBe('/welcome');

  });

  it('a session that expired while the app was closed opens Sign In; Logout still opens Welcome', async () => {
    useSession.setState({ serverUrl: 'http://x', user: KABIR }); // no stored tokens: restore() returns null
    const r = await renderRouter(APP);
    await waitFor(() => expect(r.getPathname()).toBe('/signin'));
    expect(useSession.getState().user).toBeNull();
    await act(async () => router.back());
    expect(r.getPathname()).toBe('/welcome');

    await act(async () => useSession.getState().signedIn(KABIR));
    await waitFor(() => expect(r.getPathname()).toBe('/'));
    await act(async () => useSession.getState().signedOut()); // Logout
    await waitFor(() => expect(r.getPathname()).toBe('/welcome'));
  });

  it.each([
    ['cannot be read', () => jest.spyOn(AsyncStorage, 'getItem').mockRejectedValueOnce(new Error('disk'))],
    ['is corrupt', () => jest.spyOn(AsyncStorage, 'getItem').mockResolvedValueOnce('{not json')],
  ])('a saved session that %s still opens Welcome', async (_, breakStorage) => {
    useSession.setState({ hydrated: false });
    const r = await renderRouter(APP);
    expect(routerScreen.queryByText('UOMi')).toBeNull(); // still behind the splash, waiting for the session
    breakStorage();
    await act(() => useSession.persist.rehydrate());
    await waitFor(() => expect(r.getPathname()).toBe('/welcome'));
    expect(useSession.getState()).toMatchObject({ hydrated: true, user: null });
  });
});

describe('session', () => {
  it('signing out clears the cache and the user; the address and the user are what is saved on the phone', async () => {
    await act(async () => useSession.getState().signedIn(KABIR));
    queryClient.setQueryData(qk.spaces, [{ id: 's1' }]);
    const saved = async () => JSON.parse((await AsyncStorage.getItem('uomi.session.v4')) ?? '{}').state;
    expect(await saved()).toEqual({ serverUrl: FAKE_SERVER_URL, user: KABIR });

    await act(async () => useSession.getState().signedOut());

    expect(queryClient.getQueryCache().getAll()).toHaveLength(0);
    expect(useSession.getState()).toMatchObject({ user: null, landing: '/welcome' });
    expect(await saved()).toEqual({ serverUrl: FAKE_SERVER_URL, user: null });
  });

  it('changing the server signs out of the old one, clears the cache and saves the new address', async () => {
    useSession.setState({ user: KABIR });
    const signOut = jest.spyOn(currentServices().auth, 'signOut');
    queryClient.setQueryData(qk.spaces, [{ id: 's1' }]);

    await act(() => useSession.getState().setServerUrl('http://x'));

    expect(queryClient.getQueryCache().getAll()).toHaveLength(0);
    expect(useSession.getState()).toMatchObject({ serverUrl: 'http://x', user: null });
    expect(signOut).toHaveBeenCalledTimes(1);
    expect(JSON.parse((await AsyncStorage.getItem('uomi.session.v4')) ?? '{}').state).toEqual({ serverUrl: 'http://x', user: null });
  });

  it('signs out after the idle limit, and activity or resume re-checks it', async () => {
    jest.useFakeTimers({ now: 1_800_000_000_000 });
    useSession.setState({ serverUrl: 'http://x', user: KABIR });
    markActivity();
    function Idle() {
      useIdleSignOut();
      return <ToastHost />;
    }
    await render(
      <Providers>
        <Idle />
      </Providers>,
    );

    await act(async () => void jest.advanceTimersByTime(500_000));
    markActivity(); // a successful request restarts the 570 s count
    await act(async () => void jest.advanceTimersByTime(500_000));
    expect(useSession.getState().user).not.toBeNull();

    // Backgrounded: timers don't run, so coming back to the foreground checks the clock.
    jest.setSystemTime(Date.now() + 100_000);
    const onChange = jest.mocked(AppState.addEventListener).mock.calls.at(-1)![1];
    await act(async () => void onChange('active'));
    expect(useSession.getState().user).toBeNull();
    expect(screen.getByText('You were signed out after 10 minutes of inactivity.')).toBeTruthy();
  });

  it('coming back to the foreground refetches what is on screen, after the idle check has had its say', async () => {
    jest.useFakeTimers({ now: 1_800_000_000_000 });
    useSession.setState({ serverUrl: 'http://x', user: KABIR });
    markActivity();
    const queryFn = jest.fn(async () => 'data');
    function Screen() {
      useIdleSignOut();
      useQuery({ queryKey: ['probe'], queryFn, staleTime: 0 });
      return null;
    }
    await render(
      <Providers>
        <Screen />
      </Providers>,
    );
    refetchOnForeground();
    const onChange = jest.mocked(AppState.addEventListener).mock.calls.at(-1)![1];
    // What the focus refetch finds when it runs: is anyone signed in, and how many queries are there to refetch.
    const atFocus: [boolean, number][] = [];
    const setFocused = focusManager.setFocused.bind(focusManager);
    jest.spyOn(focusManager, 'setFocused').mockImplementation((focused) => {
      if (focused) atFocus.push([useSession.getState().user !== null, queryClient.getQueryCache().getAll().length]);
      setFocused(focused);
    });
    try {
      await waitFor(() => expect(queryFn).toHaveBeenCalledTimes(1));
      await act(async () => void onChange('background'));
      await act(async () => void onChange('active')); // a minute later: still signed in, so the screen refetches
      await waitFor(() => expect(queryFn).toHaveBeenCalledTimes(2));

      jest.setSystemTime(Date.now() + 600_000);
      await act(async () => void onChange('background'));
      await act(async () => void onChange('active')); // idle too long: signed out, cache cleared, before the refetch runs
      expect(atFocus).toEqual([
        [true, 1],
        [false, 0],
      ]);
      expect(useSession.getState()).toMatchObject({ user: null, landing: '/signin' });
    } finally {
      setFocused(undefined);
    }
  });
});

describe('discard guard', () => {
  function Form({ dirty }: { dirty: boolean }) {
    const leave = useDiscardGuard(dirty);
    return <Text onPress={() => leave(() => router.back())}>Save</Text>;
  }
  const app = (dirty: boolean) => ({
    _layout: () => (
      <Providers>
        <Stack />
        <ConfirmHost />
      </Providers>
    ),
    index: () => <Text>Start</Text>,
    form: () => <Form dirty={dirty} />,
  });

  it('confirms when dirty', async () => {
    const r = await renderRouter(app(true), { initialUrl: '/' });
    await act(async () => void router.push('/form'));
    expect(r.getPathname()).toBe('/form');

    await act(async () => void pressHardwareBack());
    expect(routerScreen.getByText('Discard changes?')).toBeTruthy();
    await fireEvent.press(routerScreen.getByRole('button', { name: 'Keep editing' }));
    expect(routerScreen.queryByText('Discard changes?')).toBeNull();
    expect(r.getPathname()).toBe('/form');

    await act(async () => void pressHardwareBack());
    await fireEvent.press(routerScreen.getByRole('button', { name: 'Discard' }));
    await waitFor(() => expect(r.getPathname()).toBe('/'));
  });

  it('lets a saved form leave without asking', async () => {
    const r = await renderRouter(app(true), { initialUrl: '/' });
    await act(async () => void router.push('/form'));
    await fireEvent.press(routerScreen.getByText('Save'));
    expect(routerScreen.queryByText('Discard changes?')).toBeNull();
    await waitFor(() => expect(r.getPathname()).toBe('/'));
  });

  it('goes straight back when clean', async () => {
    const r = await renderRouter(app(false), { initialUrl: '/' });
    await act(async () => void router.push('/form'));
    await act(async () => void pressHardwareBack());
    expect(routerScreen.queryByText('Discard changes?')).toBeNull();
    await waitFor(() => expect(r.getPathname()).toBe('/'));
  });
});

describe('ui kit', () => {
  it('TabBar labels cap font scale', async () => {
    await render(
      <Providers>
        <TabBar active="index" onSelect={jest.fn()} />
      </Providers>,
    );
    for (const label of ['Home', 'Notifications', 'Transactions', 'Profile']) {
      expect(screen.getByText(label).props.maxFontSizeMultiplier).toBe(1.5);
    }
  });

  it('OtpInput digits cap font scale', async () => {
    await render(
      <Providers>
        <OtpInput value="12" onChange={jest.fn()} />
      </Providers>,
    );
    expect(screen.getByText('1', { includeHiddenElements: true }).props.maxFontSizeMultiplier).toBe(1.5);
    expect(screen.getByLabelText('6-digit code').props.maxFontSizeMultiplier).toBe(1.5);
  });

  it('error StateBox calls onRetry', async () => {
    const onRetry = jest.fn();
    await render(
      <Providers>
        <StateBox kind="error" onRetry={onRetry} />
      </Providers>,
    );
    expect(screen.getByText('Couldn’t load this')).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Retry' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});

describe('ServerSettingsSheet', () => {
  const open = (onClose = jest.fn()) =>
    render(
      <Providers>
        <ServerSettingsSheet visible onClose={onClose} />
      </Providers>,
    );

  it('starts from the saved address, validates it, tests /health and saves it', async () => {
    useSession.setState({ serverUrl: 'http://old:8000' });
    const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue({ ok: true } as Response);
    const onClose = jest.fn();
    await open(onClose);
    expect(screen.getByLabelText('Server URL').props.value).toBe('http://old:8000');

    await fireEvent.changeText(screen.getByLabelText('Server URL'), '192.168.1.20:8000');
    await fireEvent.press(screen.getByRole('button', { name: 'Save' }));
    expect(screen.getByText('Enter a URL that starts with http:// or https://')).toBeTruthy();
    expect(useSession.getState().serverUrl).toBe('http://old:8000');
    expect(onClose).not.toHaveBeenCalled();

    await fireEvent.changeText(screen.getByLabelText('Server URL'), 'https://uomi-1.onrender.com/');
    await fireEvent.press(screen.getByRole('button', { name: 'Test connection' }));
    expect(await screen.findByText('Connected')).toBeTruthy();
    expect(fetchMock.mock.calls[0][0]).toBe('https://uomi-1.onrender.com/health');

    fetchMock.mockRejectedValueOnce(new TypeError('Network request failed'));
    await fireEvent.press(screen.getByRole('button', { name: 'Test connection' }));
    expect(await screen.findByText('Couldn’t reach the server')).toBeTruthy();

    await fireEvent.press(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(useSession.getState()).toMatchObject({ serverUrl: 'https://uomi-1.onrender.com' });
  });

  it('saving the address that is already saved changes nothing, and does not sign out', async () => {
    useSession.setState({ serverUrl: 'http://old:8000', user: KABIR });
    const onClose = jest.fn();
    await open(onClose);
    await fireEvent.press(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(useSession.getState().user).toEqual(KABIR);
  });
});
