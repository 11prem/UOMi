import path from 'path';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, fireEvent, waitFor } from '@testing-library/react-native';
import { renderRouter, screen } from 'expo-router/testing-library';
import { router } from 'expo-router';
import { monthKey, relDate } from '../domain/dates';
import type { User } from '../domain/types';
import { AppError, notOnServer } from '../services/errors';
import { qk, queryClient } from '../services/queries';
import { currentServices } from '../services/useServices';
import { useSession } from '../state/session';
import { FAKE_SERVER_URL, fakeDebug } from '../../test-support/server';
import { tokens } from '../theme/tokens';

jest.mock('expo-secure-store', () => {
  const values = new Map<string, string>();
  return {
    getItemAsync: jest.fn(async (k: string) => values.get(k) ?? null),
    setItemAsync: jest.fn(async (k: string, v: string) => void values.set(k, v)),
    deleteItemAsync: jest.fn(async (k: string) => void values.delete(k)),
  };
});

// The first renderRouter loads every route module; on a cold cache that alone can pass jest's 5 s default.
jest.setTimeout(30_000);

const APP = path.join(__dirname, '../../app');
const DAY = 86_400_000;
const TOIT = 'Swetha added ‘Dinner at Toit’ — your share is ₹480';
const PRIYA = 'Priya says they paid you ₹2,000';
const KABIR: User = { id: 'u_kabir', username: 'kabir.r', name: 'Kabir Rao', email: 'kabir.r@example.com', emailVerified: true, avatarUrl: null, plate: 1 };

// Every test starts from the seed, signed in as kabir.r, with the default preferences and the switches off.
beforeEach(async () => {
  queryClient.clear();
  useSession.setState({ serverUrl: FAKE_SERVER_URL, user: null, landing: '/welcome' });
  await AsyncStorage.removeItem('uomi.theme.v1'); // the theme picked in one test is kept on the phone: start each following the phone
  const s = currentServices();
  await fakeDebug().resetDemoData();
  await fakeDebug().setSimulateErrors(false);
  await fakeDebug().setOffline(false);
  await s.auth.signIn('kabir.r', 'demo1234');
  await s.profile.setPreferences({ defaultCurrency: 'INR', theme: 'system', notificationsOn: true });
});

afterEach(async () => {
  jest.restoreAllMocks();
  useSession.setState({ serverUrl: FAKE_SERVER_URL });
  const s = currentServices();
  await fakeDebug().setSimulateErrors(false);
  await fakeDebug().setOffline(false);
  await s.auth.signOut();
});

async function openApp(initialUrl = '/') {
  const r = await renderRouter(APP, { initialUrl });
  await waitFor(() => expect(r.getPathname()).toBe(initialUrl));
  return r;
}
/** Profile, once its settings have loaded (until then they are dimmed and ignore taps). */
async function openProfile() {
  const r = await openApp('/profile');
  await waitFor(() => expect(screen.getByLabelText('Default currency, INR')).toBeEnabled());
  return r;
}
const openTab = (name: RegExp) => fireEvent.press(screen.getByRole('tab', { name }));
// The dialog sits above the screen in the tree, so when its button shares a name with one on the page (Log out), it is the last.
const confirmWith = (name: string) => fireEvent.press(screen.getAllByRole('button', { name }).at(-1)!);

describe('Notifications', () => {
  it('pull to refresh reloads the list', async () => {
    await openApp('/notifications');
    expect(await screen.findByLabelText(`Accept share: ${TOIT}`)).toBeTruthy();
    const list = jest.spyOn(currentServices().notifications, 'list');
    const refresh = screen.container.queryAll((n) => n.type === 'RCTScrollView' && !!n.props.refreshControl)[0].props.refreshControl.props;
    await act(async () => refresh.onRefresh());
    await waitFor(() => expect(list).toHaveBeenCalled());
  });

  it('mark all as read clears badge', async () => {
    await openApp();
    await openTab(/^Notifications/);
    expect(screen.getByRole('tab', { name: 'Notifications, 3 unread' })).toBeTruthy();
    await fireEvent.press(await screen.findByRole('button', { name: 'Mark all as read' }));
    await waitFor(() => expect(screen.getByRole('tab', { name: 'Notifications' })).toBeTruthy()); // no dot, no count
    expect(screen.queryByRole('button', { name: 'Mark all as read' })).toBeNull();
    expect(await currentServices().notifications.unreadCount()).toBe(0);
  });

  it('shows Needs your answer first, then Earlier grouped Yesterday / by date, unread marked', async () => {
    await openApp('/notifications');
    expect(await screen.findByRole('header', { name: 'Needs your answer' })).toBeTruthy();
    expect(screen.getByText(TOIT)).toBeTruthy();
    expect(screen.getByText(PRIYA)).toBeTruthy();
    expect(screen.getByLabelText('2 to answer').props.accessible).toBe(true); // the count is read with its meaning, not as a bare number
    expect(screen.getByRole('header', { name: 'Earlier' })).toBeTruthy();
    // Group labels: Yesterday for the reminder, then the date of each older one.
    for (const label of ['Yesterday', relDate(Date.now() - 9 * DAY), relDate(Date.now() - 30 * DAY)]) {
      expect(screen.getByRole('header', { name: label })).toBeTruthy();
    }
    expect(screen.getByLabelText(/^You owe Arun ₹400, Sunday cricket · tap to settle up · Yesterday, Unread$/)).toBeTruthy();
    expect(screen.getByLabelText(/^Priya confirmed your ₹600 payment, Office lunches · [^,]+$/)).toBeTruthy(); // read: no "Unread"
  });

  it('tapping reminder opens Settle Up', async () => {
    const r = await openApp('/notifications');
    await fireEvent.press(await screen.findByLabelText(/^You owe Arun ₹400/));
    await waitFor(() => expect(r.getPathname()).toBe('/space/sp_cricket/settle'));
    expect(await currentServices().notifications.unreadCount()).toBe(2); // and it is read now
  });

  it('tapping an item marks it read and opens its expense, payment or space', async () => {
    const r = await openApp('/notifications');
    await fireEvent.press(await screen.findByLabelText(/^Swetha added ‘Dinner at Toit’/)); // the card's text, not its ✓
    await waitFor(() => expect(r.getPathname()).toBe('/expense/e_toit'));
    await act(async () => router.back());
    await fireEvent.press(await screen.findByLabelText(/^Priya confirmed your ₹600 payment/));
    await waitFor(() => expect(r.getPathname()).toBe('/payment/st_k1'));
    await act(async () => router.back());
    await fireEvent.press(await screen.findByLabelText(/^Arun added you to ‘Goa Trip’/));
    await waitFor(() => expect(r.getPathname()).toBe('/space/sp_goa'));
  });

  it('space deleted opens nothing', async () => {
    const s = currentServices();
    const list = await s.notifications.list();
    jest.spyOn(s.notifications, 'list').mockResolvedValue([
      { ...list[2], id: 'n_del', type: 'space_deleted', message: 'Arun deleted ‘Goa Trip’', spaceId: 'sp_gone', refId: null, read: false },
    ]);
    const markRead = jest.spyOn(s.notifications, 'markRead').mockResolvedValue();
    const r = await openApp('/notifications');
    await fireEvent.press(await screen.findByLabelText(/^Arun deleted ‘Goa Trip’/));
    await waitFor(() => expect(markRead).toHaveBeenCalledWith('n_del')); // it is read, but the space is gone: nowhere to go
    expect(r.getPathname()).toBe('/notifications');
  });

  it('accepting from a needs-answer card removes it and drops the badge', async () => {
    await openApp('/notifications');
    await fireEvent.press(await screen.findByLabelText(`Accept share: ${TOIT}`));
    await waitFor(() => expect(screen.queryByLabelText(`Accept share: ${TOIT}`)).toBeNull(), { timeout: 3000 });
    expect(screen.getByText('Share accepted — balance updated')).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'Notifications, 2 unread' })).toBeTruthy(); // the accepted one reads itself; the payment card and the reminder are still unread
    expect(screen.getByLabelText(`Confirm payment: ${PRIYA}`)).toBeTruthy();
  });

  it('a refetch while the card peels still toasts and refreshes', async () => {
    await openApp('/notifications');
    await fireEvent.press(await screen.findByLabelText(`Accept share: ${TOIT}`));
    const toit = async () => (await currentServices().notifications.list()).find((x) => x.refId === 'e_toit')!;
    await waitFor(async () => expect((await toit()).needsAnswer).toBe(false)); // the service has taken the answer
    await queryClient.invalidateQueries({ queryKey: qk.notifications }); // the list comes back without the answered bill, mid-peel
    expect(await screen.findByText('Share accepted — balance updated')).toBeTruthy();
    expect(await screen.findByRole('tab', { name: 'Notifications, 2 unread' })).toBeTruthy();
    await waitFor(() => expect(screen.queryByLabelText(`Accept share: ${TOIT}`)).toBeNull(), { timeout: 3000 });
    expect(screen.getByLabelText(`Confirm payment: ${PRIYA}`)).toBeTruthy(); // the other bill stays
  });

  it('an answer the server cannot take shows why and keeps the card', async () => {
    jest.spyOn(currentServices().expenses, 'acceptShare').mockRejectedValue(notOnServer());
    await openApp('/notifications');
    await fireEvent.press(await screen.findByLabelText(`Accept share: ${TOIT}`));
    expect(await screen.findByText('Not available on this server yet')).toBeTruthy();
    expect(screen.getByLabelText(`Accept share: ${TOIT}`)).toBeTruthy();
  });

  it('an answer to something already answered or removed marks the card read, refreshes and says so', async () => {
    const s = currentServices();
    const toit = (await s.notifications.list()).find((x) => x.refId === 'e_toit')!;
    jest.spyOn(s.expenses, 'acceptShare').mockRejectedValue(new AppError('not_found', 'Expense not found'));
    const markRead = jest.spyOn(s.notifications, 'markRead');
    await openApp('/notifications');
    await fireEvent.press(await screen.findByLabelText(`Accept share: ${TOIT}`));
    expect(await screen.findByText('This was already answered or removed')).toBeTruthy();
    await waitFor(() => expect(markRead).toHaveBeenCalledWith(toit.id));
    expect(await screen.findByRole('tab', { name: 'Notifications, 2 unread' })).toBeTruthy(); // refreshed: it reads itself
  });

  it('a needs-answer card that has lost what it is about has no ✕ / ✓', async () => {
    const s = currentServices();
    const list = await s.notifications.list();
    jest.spyOn(s.notifications, 'list').mockResolvedValue(list.map((x) => (x.refId === 'e_toit' ? { ...x, refId: null } : x)));
    await openApp('/notifications');
    expect(await screen.findByLabelText(`Confirm payment: ${PRIYA}`)).toBeTruthy();
    expect(screen.getByText(TOIT)).toBeTruthy();
    expect(screen.queryByLabelText(`Accept share: ${TOIT}`)).toBeNull();
    expect(screen.queryByLabelText(`Reject share: ${TOIT}`)).toBeNull();
  });

  it('empty: "No notifications yet"', async () => {
    await currentServices().auth.signIn('rohan.d', 'demo1234'); // seeded with none
    await openApp('/notifications');
    expect(await screen.findByText('No notifications yet')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Mark all as read' })).toBeNull();
  });

  it('a failed load shows Retry, which loads the list', async () => {
    await fakeDebug().setSimulateErrors(true);
    await openApp('/notifications');
    expect(await screen.findByText('Couldn’t load this')).toBeTruthy();
    await fakeDebug().setSimulateErrors(false);
    await fireEvent.press(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByText(TOIT)).toBeTruthy();
    expect(screen.queryByText('Couldn’t load this')).toBeNull();
  });
});

describe('Transactions', () => {
  it('rows are grouped by month and show the effect in the space’s currency', async () => {
    await openApp('/transactions');
    expect(await screen.findByText(monthKey(Date.now()))).toBeTruthy();
    expect(screen.getByText(monthKey(Date.now() - 21 * DAY))).toBeTruthy();
    expect(screen.getByLabelText(/^Dinner at Toit, Flat 4B · [^,]+, Pending, you owe ₹480$/)).toBeTruthy();
    expect(screen.getByLabelText(/^Wi-Fi bill, Flat 4B · [^,]+, you lent ₹786\.66$/)).toBeTruthy();
    expect(screen.getByLabelText(/^Airport taxi, Dubai stopover · [^,]+, you lent \$35$/)).toBeTruthy();
    expect(screen.getByLabelText(/^Beach shack lunch, Goa Trip · [^,]+, Disputed, not counted$/)).toBeTruthy();
    expect(screen.getByLabelText(/^Priya paid you, Goa Trip · [^,]+, Pending, you received ₹2,000$/)).toBeTruthy();
    expect(screen.getByLabelText(/^You paid Priya, Office lunches · [^,]+, you paid ₹600$/)).toBeTruthy();
    expect(screen.queryByLabelText(/Total/i)).toBeNull(); // rows may be in different currencies: no totals
  });

  it('tapping a row opens the expense or the payment', async () => {
    const r = await openApp('/transactions');
    await fireEvent.press(await screen.findByLabelText(/^Airport taxi/));
    await waitFor(() => expect(r.getPathname()).toBe('/expense/e_taxi'));
    await act(async () => router.back());
    await fireEvent.press(await screen.findByLabelText(/^You paid Priya/));
    await waitFor(() => expect(r.getPathname()).toBe('/payment/st_k1'));
  });

  it('chips filter by kind', async () => {
    await openApp('/transactions');
    await fireEvent.press(await screen.findByRole('button', { name: 'Payments' }));
    expect(await screen.findByLabelText(/^You paid Priya/)).toBeTruthy();
    expect(screen.queryByLabelText(/^Airport taxi/)).toBeNull();
    await fireEvent.press(screen.getByRole('button', { name: 'Expenses' }));
    expect(await screen.findByLabelText(/^Airport taxi/)).toBeTruthy();
    expect(screen.queryByLabelText(/^You paid Priya/)).toBeNull();
  });

  it('transactions filtered empty shows Clear filters', async () => {
    await openApp('/transactions');
    await fireEvent.press(await screen.findByRole('button', { name: 'Payments' }));
    await fireEvent.press(screen.getByLabelText('Filter by space, All spaces'));
    await fireEvent.press(await screen.findByRole('radio', { name: 'Flat 4B' })); // Flat 4B has no payments
    expect(await screen.findByText('Nothing matches these filters')).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Clear filters' }));
    expect(await screen.findByLabelText(/^You paid Priya/)).toBeTruthy();
    expect(screen.getByLabelText('Filter by space, All spaces')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'All' })).toBeSelected();
  });

  it('a filtered space the viewer has left goes back to All spaces', async () => {
    await openApp('/transactions');
    await fireEvent.press(await screen.findByLabelText('Filter by space, All spaces'));
    await fireEvent.press(await screen.findByRole('radio', { name: 'Office lunches' }));
    expect(await screen.findByLabelText('Filter by space, Office lunches')).toBeTruthy();
    await currentServices().spaces.leave('sp_office'); // settled up, not the owner
    await act(async () => queryClient.invalidateQueries());
    expect(await screen.findByLabelText('Filter by space, All spaces')).toBeTruthy();
    expect(await screen.findByLabelText(/^Airport taxi/)).toBeTruthy(); // every space's rows again
  });

  it('empty: "No transactions yet"', async () => {
    await currentServices().auth.signIn('rohan.d', 'demo1234');
    jest.spyOn(currentServices().transactions, 'list').mockResolvedValue([]);
    await openApp('/transactions');
    expect(await screen.findByText('No transactions yet')).toBeTruthy();
    expect(screen.queryByText('Nothing matches these filters')).toBeNull();
  });
});

describe('Profile', () => {
  it('shows the name, email and username with an Edit link', async () => {
    const r = await openApp('/profile');
    expect(await screen.findByText('Kabir Rao')).toBeTruthy();
    expect(screen.getByText('kabir.r@example.com')).toBeTruthy();
    expect(screen.getByText('@kabir.r')).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Edit profile' }));
    await waitFor(() => expect(r.getPathname()).toBe('/profile-edit'));
  });

  it('logout confirm returns to Welcome', async () => {
    const r = await openApp('/profile');
    await fireEvent.press(await screen.findByRole('button', { name: 'Log out' }));
    expect(await screen.findByText('Log out of UOMi?')).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Cancel' }));
    expect(r.getPathname()).toBe('/profile'); // Cancel stays signed in

    await fireEvent.press(screen.getByRole('button', { name: 'Log out' }));
    await screen.findByText('Log out of UOMi?');
    await confirmWith('Log out');
    await waitFor(() => expect(r.getPathname()).toBe('/welcome'));
    expect(useSession.getState().user).toBeNull();
    expect(await currentServices().auth.restore()).toBeNull();
  });

  it('theme toggle switches scheme', async () => {
    await openProfile();
    const title = await screen.findByRole('header', { name: 'Profile' });
    expect(title).toHaveStyle({ color: tokens.light.ink });
    expect(screen.getByText('Following your phone')).toBeTruthy();
    await fireEvent.press(screen.getByRole('radio', { name: 'Dark' }));
    await waitFor(() => expect(screen.getByRole('header', { name: 'Profile' })).toHaveStyle({ color: tokens.dark.ink }));
    expect(screen.getByRole('radio', { name: 'Dark' })).toBeChecked();
    expect(screen.getByText('Dark')).toBeTruthy(); // the row's caption
    expect((await currentServices().profile.getPreferences()).theme).toBe('dark'); // the fake keeps a copy; the phone's own copy is what launches use
    await fireEvent.press(screen.getByRole('radio', { name: 'Light' }));
    await waitFor(() => expect(screen.getByRole('header', { name: 'Profile' })).toHaveStyle({ color: tokens.light.ink }));
  });

  it('a theme that could not be saved goes back with the reason', async () => {
    await openProfile();
    jest.spyOn(currentServices().profile, 'setPreferences').mockRejectedValue(new Error('You’re offline — try again when you’re connected'));
    await fireEvent.press(await screen.findByRole('radio', { name: 'Dark' }));
    expect(await screen.findByText('You’re offline — try again when you’re connected')).toBeTruthy();
    await waitFor(() => expect(screen.getByRole('header', { name: 'Profile' })).toHaveStyle({ color: tokens.light.ink }));
  });

  it('default currency and the notifications switch are saved', async () => {
    await openProfile();
    await fireEvent.press(await screen.findByLabelText('Default currency, INR'));
    await fireEvent.press(await screen.findByRole('radio', { name: /^USD/ }));
    expect(await screen.findByText('New spaces will use USD')).toBeTruthy();
    expect(await screen.findByLabelText('Default currency, USD')).toBeTruthy();
    expect((await currentServices().profile.getPreferences()).defaultCurrency).toBe('USD');

    const sw = screen.getByRole('switch', { name: 'Notifications' });
    expect(sw).toBeChecked();
    await fireEvent.press(sw);
    expect(await screen.findByText('Notifications off')).toBeTruthy();
    await waitFor(() => expect(screen.getByRole('switch', { name: 'Notifications' })).not.toBeChecked());
    expect((await currentServices().profile.getPreferences()).notificationsOn).toBe(false);
  });

  it('a failed load of the preferences shows Retry and keeps the profile', async () => {
    jest.spyOn(currentServices().profile, 'getPreferences').mockRejectedValue(new Error('x'));
    await openApp('/profile');
    expect(await screen.findByText('Couldn’t load this')).toBeTruthy();
    expect(screen.getByText('Kabir Rao')).toBeTruthy();
  });
});

describe('server mode', () => {
  /** A signed-in server session. The server instance is the one `useServices()` returns, so spies on it reach the screens. */
  async function openServer(initialUrl: string, setup?: (s: ReturnType<typeof currentServices>) => void) {
    useSession.setState({ serverUrl: 'http://x', user: KABIR });
    const s = currentServices();
    jest.spyOn(s.auth, 'restore').mockResolvedValue(KABIR);
    jest.spyOn(s.profile, 'get').mockResolvedValue(KABIR);
    jest.spyOn(s.profile, 'getPreferences').mockResolvedValue({ defaultCurrency: 'INR', theme: 'system', notificationsOn: true });
    jest.spyOn(s.notifications, 'unreadCount').mockResolvedValue(0);
    jest.spyOn(s.spaces, 'list').mockResolvedValue([]);
    jest.spyOn(s.transactions, 'list');
    setup?.(s); // before the screen opens, so its first request is the one the test answers
    return openApp(initialUrl);
  }

  const SERVER_ROW = {
    kind: 'expense' as const,
    id: '7',
    description: 'Dinner',
    date: Date.now(),
    amountMinor: 1000,
    paidById: 'arun.n',
    paidByName: 'Arun Nair',
    myPartMinor: -1000,
    myResponse: 'pending' as const,
    disputed: false,
    spaceId: '2',
    spaceName: 'Goa Trip',
    currency: 'INR' as const,
  };

  it('Transactions lists what the server returns, and the chips ask it again', async () => {
    await openServer('/transactions', (s) => jest.spyOn(s.transactions, 'list').mockResolvedValue([SERVER_ROW]));
    expect(await screen.findByLabelText(/^Dinner, Goa Trip · [^,]+, Pending, you owe ₹10$/)).toBeTruthy();
    expect(screen.queryByText('Not available on this server yet')).toBeNull();
    expect(currentServices().transactions.list).toHaveBeenCalledWith({ kind: 'all' });
    expect(currentServices().spaces.list).toHaveBeenCalled(); // the space filter is filled from the server's spaces
    await fireEvent.press(screen.getByRole('button', { name: 'Payments' }));
    await waitFor(() => expect(currentServices().transactions.list).toHaveBeenCalledWith({ kind: 'payments' }));
  });

  it('Transactions on an older server without the endpoint shows Not available on this server yet', async () => {
    await openServer('/transactions', (s) => jest.spyOn(s.transactions, 'list').mockRejectedValue(notOnServer()));
    expect(await screen.findByText('Not available on this server yet')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Payments' })).toBeNull();
    expect(screen.queryByLabelText('Filter by space, All spaces')).toBeNull();
  });

  it('Profile shows the user with every setting live, and the theme stays on this phone', async () => {
    await openServer('/profile');
    expect(await screen.findByText('Kabir Rao')).toBeTruthy();
    expect(screen.getByText('@kabir.r')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Edit profile' })).toBeEnabled();
    expect(await screen.findByLabelText('Default currency, INR')).toBeEnabled(); // kept on this phone: the server keeps no preferences
    expect(screen.getByRole('switch', { name: 'Notifications' })).toBeEnabled();
    expect(screen.queryByText('Not available on this server yet')).toBeNull();

    const setPrefs = jest.spyOn(currentServices().profile, 'setPreferences').mockResolvedValue();
    await fireEvent.press(screen.getByRole('radio', { name: 'Dark' }));
    await waitFor(() => expect(setPrefs).toHaveBeenCalled());
    await waitFor(() => expect(screen.getByRole('header', { name: 'Profile' })).toHaveStyle({ color: tokens.dark.ink }));
    expect(screen.getByRole('radio', { name: 'Dark' })).toBeChecked();
  });
});

describe('Edit Profile', () => {
  const edit = async () => {
    const r = await openApp('/profile');
    await fireEvent.press(await screen.findByRole('button', { name: 'Edit profile' }));
    await waitFor(() => expect(r.getPathname()).toBe('/profile-edit'));
    return r;
  };

  it('saves the name and the Profile shows it', async () => {
    const r = await edit();
    expect(screen.getByLabelText('Name').props.value).toBe('Kabir Rao');
    await fireEvent.changeText(screen.getByLabelText('Name'), '  Kabir R. Rao ');
    await fireEvent.press(screen.getByRole('button', { name: 'Save profile' }));
    await waitFor(() => expect(r.getPathname()).toBe('/profile'));
    expect(await screen.findByText('Profile saved')).toBeTruthy();
    expect(await screen.findByText('Kabir R. Rao')).toBeTruthy();
    expect(useSession.getState().user?.name).toBe('Kabir R. Rao');
    expect((await currentServices().profile.get()).name).toBe('Kabir R. Rao');
  });

  it('username and email are read-only', async () => {
    await edit();
    expect(screen.getByText('@kabir.r')).toBeTruthy();
    expect(screen.getByText('kabir.r@example.com')).toBeTruthy();
    expect(screen.getByText('Your recovery key, so it can’t be changed.')).toBeTruthy();
    expect(screen.getByText('Changing your email isn’t available yet.')).toBeTruthy();
    expect(screen.queryByLabelText('Username')).toBeNull(); // no input to type in
    expect(screen.queryByLabelText('Email')).toBeNull();
  });

  it('an empty name asks for one and saves nothing', async () => {
    await edit();
    await fireEvent.changeText(screen.getByLabelText('Name'), '   ');
    await fireEvent.press(screen.getByRole('button', { name: 'Save profile' }));
    expect(await screen.findByText('Enter your name')).toBeTruthy();
    expect((await currentServices().profile.get()).name).toBe('Kabir Rao');
  });

  it('Back with a changed name asks Discard changes?; a clean form just goes back', async () => {
    const r = await edit();
    await act(async () => router.back());
    await waitFor(() => expect(r.getPathname()).toBe('/profile')); // nothing typed: straight back

    await fireEvent.press(screen.getByRole('button', { name: 'Edit profile' }));
    await waitFor(() => expect(r.getPathname()).toBe('/profile-edit'));
    await fireEvent.changeText(screen.getByLabelText('Name'), 'Someone Else');
    await act(async () => router.back());
    expect(await screen.findByText('Discard changes?')).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Keep editing' }));
    expect(r.getPathname()).toBe('/profile-edit');
    await act(async () => router.back());
    await screen.findByText('Discard changes?');
    await confirmWith('Discard');
    await waitFor(() => expect(r.getPathname()).toBe('/profile'));
    expect((await currentServices().profile.get()).name).toBe('Kabir Rao');
  });
});
