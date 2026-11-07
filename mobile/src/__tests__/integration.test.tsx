import path from 'path';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { AccessibilityInfo, StyleSheet } from 'react-native';
import { act, fireEvent, waitFor, within } from '@testing-library/react-native';
import { renderRouter, screen } from 'expo-router/testing-library';
import { router } from 'expo-router';
import { queryClient } from '../services/queries';
import { currentServices } from '../services/useServices';
import { useSession } from '../state/session';
import { tokens } from '../theme/tokens';
import { toast } from '../ui/Toast';

jest.mock('expo-secure-store', () => {
  const values = new Map<string, string>();
  return {
    getItemAsync: jest.fn(async (k: string) => values.get(k) ?? null),
    setItemAsync: jest.fn(async (k: string, v: string) => void values.set(k, v)),
    deleteItemAsync: jest.fn(async (k: string) => void values.delete(k)),
  };
});

// The first renderRouter loads every route module; on a cold cache or a busy machine that alone can pass jest's 5 s default.
jest.setTimeout(30_000);

const APP = path.join(__dirname, '../../app');
const TOIT = 'Swetha added ‘Dinner at Toit’ — your share is ₹480';
const THEME_KEY = 'uomi.theme.v1';
/** What a held service call waits on: `release()` lets it through to the real one. */
function gate() {
  let release!: () => void;
  const opened = new Promise<void>((r) => (release = r));
  return { opened, release };
}

// Every test starts from the seed, signed in as kabir.r, following the phone's theme.
beforeEach(async () => {
  queryClient.clear();
  useSession.setState({ mode: 'demo', serverUrl: '', user: null, landing: '/welcome' });
  await AsyncStorage.removeItem(THEME_KEY);
  const s = currentServices();
  await s.debug!.resetDemoData();
  await s.debug!.setSimulateErrors(false);
  await s.auth.signIn('kabir.r', 'demo1234');
});

afterEach(async () => {
  jest.restoreAllMocks();
  useSession.setState({ mode: 'demo', serverUrl: '' });
  await currentServices().auth.signOut();
});

/** Opens Home, then pushes each url in turn (so Back has somewhere to go), and waits for the last. */
async function open(...urls: string[]) {
  const r = await renderRouter(APP);
  await waitFor(() => expect(r.getPathname()).toBe('/'));
  for (const url of urls) {
    await act(async () => router.push(url));
    await waitFor(() => expect(r.getPathname()).toBe(url.split('?')[0]));
  }
  return r;
}

describe('Members gating sees every pair in the space (item 1)', () => {
  it('a member who owes someone else but is square with the owner can’t be removed, and the space can’t be deleted', async () => {
    const s = currentServices();
    const sp = await s.spaces.create({ name: 'Trek', icon: 'trip', currency: 'INR', memberIds: ['u_swetha', 'u_rohan'] });
    const share = (userId: string) => ({ userId, input: null, amountMinor: 15000, response: 'pending' as const });
    await s.expenses.create({ spaceId: sp.id, description: 'Cab', amountMinor: 30000, paidBy: 'u_rohan', splitType: 'equal', date: Date.now(), shares: [share('u_swetha'), share('u_rohan')] });
    expect(await s.spaces.get(sp.id)).toMatchObject({ settledMemberIds: ['u_kabir'], allSettled: false }); // Swetha owes Rohan

    await open(`/space/${sp.id}/members`);
    expect(await screen.findByRole('button', { name: 'Delete space' })).toBeDisabled();
    await fireEvent.press(screen.getByLabelText('Options for Swetha Iyer'));
    expect(await screen.findByRole('button', { name: 'Remove from space' })).toBeDisabled();
    expect(screen.getByText(/^Settle up first/)).toBeTruthy();
  });
});

describe('Theme kept on this phone (item 2)', () => {
  it('Profile shows the theme saved on this phone as picked, whatever the stored preferences say', async () => {
    await AsyncStorage.setItem(THEME_KEY, 'dark'); // the demo preferences still say "system"
    const r = await renderRouter(APP, { initialUrl: '/profile' });
    await waitFor(() => expect(r.getPathname()).toBe('/profile'));
    await waitFor(() => expect(screen.getByRole('radio', { name: 'Dark' })).toBeChecked());
    expect(screen.getByRole('header', { name: 'Profile' })).toHaveStyle({ color: tokens.dark.ink });
  });
});

describe('Toast placement (item 3)', () => {
  /** The `bottom` of the toast's absolutely placed host. */
  const toastBottom = async (message: string) => {
    await act(async () => toast(message));
    let n = (await screen.findByText(message)).parent;
    while (n && StyleSheet.flatten(n.props.style)?.position !== 'absolute') n = n.parent;
    return StyleSheet.flatten(n!.props.style).bottom;
  };

  it('sits above the tab bar on the Space page as on Home, and above the FAB on a pushed screen', async () => {
    await open();
    const home = await toastBottom('On Home');
    await act(async () => router.push('/space/sp_flat'));
    expect(await screen.findByText('Flat 4B')).toBeTruthy();
    expect(await toastBottom('On the Space page')).toBe(home);
    await act(async () => router.push('/space/sp_flat/members'));
    expect(await screen.findByText('Rohan Das')).toBeTruthy();
    expect(await toastBottom('On Members')).not.toBe(home);
  });
});

describe('Home notifications heading (item 4)', () => {
  it('is a header that still opens Notifications, and its badge caps font scale', async () => {
    const r = await open();
    const heading = await screen.findByRole('header', { name: 'Notifications, 3 unread notifications' });
    expect(within(heading).getByText('3').props.maxFontSizeMultiplier).toBe(1.5);
    await fireEvent.press(heading);
    await waitFor(() => expect(r.getPathname()).toBe('/notifications'));
  });
});

// Save and Record await their request inside the press handler, and `fireEvent.press` resolves only when the handler does.
// Its act() renders the busy state a few microtasks in, so those two look after one real macrotask (an act of their own
// would overlap the press's), then release the request and await the press inside act().
const settle = () => new Promise((r) => jest.requireActual('timers').setImmediate(r)); // real: renderRouter turns on fake timers

describe('Busy FABs (item 6)', () => {
  it('Create space shows a spinner while the space is created', async () => {
    const g = gate();
    const { create } = currentServices().spaces;
    jest.spyOn(currentServices().spaces, 'create').mockImplementation(async (i) => {
      await g.opened;
      return create(i);
    });
    const r = await open();
    await fireEvent.press(await screen.findByLabelText('Create Space'));
    await fireEvent.changeText(screen.getByLabelText('Space name'), 'Trek');
    await fireEvent.press(screen.getByLabelText('Next: add people'));
    await waitFor(() => expect(r.getPathname()).toBe('/space/add-people'));
    await fireEvent.changeText(screen.getByLabelText('Find people'), 'swe');
    await fireEvent.press(await screen.findByLabelText('Add Swetha Iyer, @swetha.i'));
    await fireEvent.press(screen.getByLabelText('Create space'));
    await waitFor(() => expect(screen.getByLabelText('Create space')).toBeBusy());
    expect(screen.getByLabelText('Create space')).toBeDisabled();
    await act(async () => g.release());
    await waitFor(() => expect(r.getPathname()).toMatch(/^\/space\/sp_/));
    expect(await screen.findByText('Space created')).toBeTruthy();
  });

  it('Save expense shows a spinner while the expense is saved', async () => {
    const g = gate();
    const { create } = currentServices().expenses;
    jest.spyOn(currentServices().expenses, 'create').mockImplementation(async (i) => {
      await g.opened;
      return create(i);
    });
    const r = await open('/space/sp_flat', '/space/sp_flat/expense-new');
    await fireEvent.changeText(await screen.findByLabelText('Description'), 'Pizza night');
    await fireEvent.changeText(screen.getByLabelText('Amount'), '300');
    const press = fireEvent.press(screen.getByLabelText('Save expense'));
    await settle();
    expect(screen.getByLabelText('Save expense')).toBeBusy();
    expect(screen.getByLabelText('Save expense')).toBeDisabled();
    await act(async () => {
      g.release();
      await press;
    });
    await waitFor(() => expect(r.getPathname()).toBe('/space/sp_flat'));
    expect(await screen.findByText('Expense added')).toBeTruthy();
  });

  it('Record payment shows a spinner while the payment is recorded', async () => {
    const g = gate();
    const { create } = currentServices().settlements;
    jest.spyOn(currentServices().settlements, 'create').mockImplementation(async (i) => {
      await g.opened;
      return create(i);
    });
    const r = await open('/space/sp_cricket', '/space/sp_cricket/settle');
    expect(await screen.findByRole('radio', { name: 'Arun Nair, you owe ₹400.00' })).toBeChecked();
    const press = fireEvent.press(screen.getByLabelText('Record payment'));
    await settle();
    expect(screen.getByLabelText('Record payment')).toBeBusy();
    expect(screen.getByLabelText('Record payment')).toBeDisabled();
    await act(async () => {
      g.release();
      await press;
    });
    await waitFor(() => expect(r.getPathname()).toMatch(/^\/payment\/st_/));
    expect(await screen.findByText('Payment recorded')).toBeTruthy();
  });
});

describe('Busy FAB on Edit profile', () => {
  it('Save profile shows a spinner while the profile is saved', async () => {
    const g = gate();
    const { update } = currentServices().profile;
    jest.spyOn(currentServices().profile, 'update').mockImplementation(async (p) => {
      await g.opened;
      return update(p);
    });
    const r = await open('/profile', '/profile-edit');
    await fireEvent.changeText(await screen.findByLabelText('Name'), 'Kabir R. Rao');
    const press = fireEvent.press(screen.getByLabelText('Save profile'));
    await settle();
    expect(screen.getByLabelText('Save profile')).toBeBusy();
    expect(screen.getByLabelText('Save profile')).toBeDisabled();
    await act(async () => {
      g.release();
      await press;
    });
    await waitFor(() => expect(r.getPathname()).toBe('/profile'));
  });
});

describe('Home card answer (item 7)', () => {
  it('toasts and refreshes as soon as the answer is saved, even if Home goes before the peel ends', async () => {
    const r = await open();
    const button = await screen.findByLabelText(`Accept share: ${TOIT}`);
    const invalidate = jest.spyOn(queryClient, 'invalidateQueries');
    const announce = jest.spyOn(AccessibilityInfo, 'announceForAccessibility'); // every toast is announced
    await fireEvent.press(button); // resolves with the handler: the service has taken the answer and the copies start to peel
    await r.unmount(); // Back / a tab switch mid-peel: onGone never runs
    expect(invalidate).toHaveBeenCalledWith();
    expect(announce).toHaveBeenCalledWith('Share accepted — balance updated');
  });
});
