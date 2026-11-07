import path from 'path';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { renderRouter, screen } from 'expo-router/testing-library';
import { router } from 'expo-router';
import type { Space, SpaceBalance } from '../domain/types';
import { BalanceSheet } from '../features/space/BalanceSheet';
import { AppError, notOnServer } from '../services/errors';
import { queryClient } from '../services/queries';
import { currentServices } from '../services/useServices';
import { useSession } from '../state/session';
import { ThemeProvider } from '../theme/ThemeProvider';

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

// Every test starts from the seed, signed in as kabir.r (context.md "Seed expected values").
beforeEach(async () => {
  queryClient.clear();
  useSession.setState({ mode: 'demo', serverUrl: '', user: null, landing: '/welcome' });
  const s = currentServices();
  await s.debug!.resetDemoData();
  await s.debug!.setSimulateErrors(false);
  await s.auth.signIn('kabir.r', 'demo1234');
});

afterEach(async () => {
  jest.restoreAllMocks();
  await currentServices().auth.signOut();
});

async function openHome() {
  const r = await renderRouter(APP);
  await waitFor(() => expect(r.getPathname()).toBe('/'));
  return r;
}
/** The screen's pull to refresh (the RefreshControl handed to its scroll view). */
const pull = () => screen.container.queryAll((n) => n.type === 'RCTScrollView' && !!n.props.refreshControl)[0].props.refreshControl.props;

describe('Home', () => {
  it('home shows overall net per currency', async () => {
    await openHome();
    expect(await screen.findByText('Overall, you’re owed ₹9,666.66')).toBeTruthy();
    expect(screen.getByText('Overall, you’re owed $35')).toBeTruthy();
    // Space cards read balanceText: one counterparty by first name, several as a count, net 0 with open pairs.
    expect(screen.getByLabelText('Flat 4B, NO. 0412, You owe ₹473.34, 2 people')).toBeTruthy();
    expect(screen.getByLabelText('Goa Trip, NO. 0398, You’re owed ₹10,140, 2 people')).toBeTruthy();
    expect(screen.getByLabelText('Office lunches, NO. 0371, Settled up')).toBeTruthy();
    expect(screen.getByLabelText('Dubai stopover, NO. 0420, You’re owed $35, Meera')).toBeTruthy();
    expect(screen.getByLabelText('Sunday cricket, NO. 0377, ₹0 net, 2 open balances')).toBeTruthy();
  });

  it('accept on home card removes it and decrements badge', async () => {
    await openHome();
    expect(await screen.findByText(TOIT)).toBeTruthy();
    expect(screen.getByLabelText('Notifications, 3 unread notifications')).toBeTruthy();

    await fireEvent.press(screen.getByLabelText(`Accept share: ${TOIT}`));
    await waitFor(() => expect(screen.queryByText(TOIT)).toBeNull(), { timeout: 3000 });
    expect(await screen.findByText('Priya says they paid you ₹2,000')).toBeTruthy(); // the next one slides in
    expect(screen.getByLabelText('Notifications, 2 unread notifications')).toBeTruthy();
    expect(screen.getByText('Share accepted — balance updated')).toBeTruthy();
  });

  it('an answer the server cannot take shows why as a toast and keeps the card', async () => {
    jest.spyOn(currentServices().expenses, 'acceptShare').mockRejectedValue(notOnServer());
    await openHome();
    await fireEvent.press(await screen.findByLabelText(`Accept share: ${TOIT}`));
    expect(await screen.findByText('Not available on this server yet')).toBeTruthy();
    expect(screen.getByText(TOIT)).toBeTruthy();
    expect(screen.getByLabelText('Notifications, 3 unread notifications')).toBeTruthy();
  });

  it('an answer to something already answered or removed marks the home card read and says so', async () => {
    const s = currentServices();
    jest.spyOn(s.expenses, 'acceptShare').mockRejectedValue(new AppError('not_found', 'Expense not found'));
    const markRead = jest.spyOn(s.notifications, 'markRead');
    await openHome();
    await fireEvent.press(await screen.findByLabelText(`Accept share: ${TOIT}`));
    expect(await screen.findByText('This was already answered or removed')).toBeTruthy();
    await waitFor(() => expect(markRead).toHaveBeenCalled());
    expect(await screen.findByLabelText('Notifications, 2 unread notifications')).toBeTruthy();
  });

  it('a home card with nothing to answer about shows no ✕ / ✓', async () => {
    const s = currentServices();
    const list = await s.notifications.list();
    jest.spyOn(s.notifications, 'list').mockResolvedValue(list.map((x) => ({ ...x, refId: x.refId === 'e_toit' ? null : x.refId })));
    await openHome();
    expect(await screen.findByText(TOIT)).toBeTruthy();
    expect(screen.queryByLabelText(`Accept share: ${TOIT}`)).toBeNull();
    expect(screen.queryByLabelText(`Reject share: ${TOIT}`)).toBeNull();
  });

  it('a failed load shows Retry, which loads the page', async () => {
    await currentServices().debug!.setSimulateErrors(true);
    await openHome();
    expect(await screen.findByText('Couldn’t load this')).toBeTruthy();
    await currentServices().debug!.setSimulateErrors(false);
    await fireEvent.press(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByText('Overall, you’re owed $35')).toBeTruthy();
    expect(screen.queryByText('Couldn’t load this')).toBeNull();
  });
});

describe('Pull to refresh', () => {
  it('Home reloads its spaces and notifications, with the spinner until they are in', async () => {
    await openHome();
    expect(await screen.findByText(TOIT)).toBeTruthy();
    let release!: () => void;
    const opened = new Promise<void>((resolve) => (release = resolve));
    const { list } = currentServices().spaces;
    const spaces = jest.spyOn(currentServices().spaces, 'list').mockImplementation(async () => {
      await opened;
      return list();
    });
    const notifications = jest.spyOn(currentServices().notifications, 'list');
    await act(async () => pull().onRefresh());
    expect(pull().refreshing).toBe(true); // the spaces are still loading
    expect(spaces).toHaveBeenCalled();
    expect(notifications).toHaveBeenCalled();
    await act(async () => release());
    await waitFor(() => expect(pull().refreshing).toBe(false));
  });

  it('the Space page reloads the space', async () => {
    const r = await openHome();
    await act(async () => router.push('/space/sp_flat'));
    await waitFor(() => expect(r.getPathname()).toBe('/space/sp_flat'));
    expect(await screen.findByText('You owe ₹473.34')).toBeTruthy();
    const get = jest.spyOn(currentServices().spaces, 'get');
    await act(async () => pull().onRefresh());
    await waitFor(() => expect(get).toHaveBeenCalledWith('sp_flat'));
    await waitFor(() => expect(pull().refreshing).toBe(false));
  });
});

describe('Create Space', () => {
  it('create space: confirm disabled until one person added; creates and opens Space Page with toast', async () => {
    const r = await openHome();
    await fireEvent.press(await screen.findByLabelText('Create Space'));
    expect(screen.getByLabelText('Next: add people')).toBeDisabled();
    await fireEvent.changeText(screen.getByLabelText('Space name'), '  Trek  ');
    expect(await screen.findByLabelText('Currency, Indian rupee')).toBeTruthy(); // the default from preferences
    await fireEvent.press(screen.getByLabelText('Next: add people'));
    await waitFor(() => expect(r.getPathname()).toBe('/space/add-people'));
    expect(screen.queryByLabelText('Space name')).toBeNull(); // the pop-up closed behind it

    expect(screen.getByText('You')).toBeTruthy(); // row 1, no remove button
    expect(screen.getByLabelText('Create space')).toBeDisabled();
    await fireEvent.changeText(screen.getByLabelText('Find people'), 'swe');
    await fireEvent.press(await screen.findByLabelText('Add Swetha Iyer, @swetha.i'));
    expect(screen.getByLabelText('Remove Swetha Iyer')).toBeTruthy();
    expect(screen.getByLabelText('Create space')).toBeEnabled();

    await fireEvent.press(screen.getByLabelText('Create space'));
    await waitFor(() => expect(r.getPathname()).toMatch(/^\/space\/sp_/));
    expect(await screen.findByText('Space created')).toBeTruthy();
    expect(await screen.findByText('Trek')).toBeTruthy();
    const created = (await currentServices().spaces.list()).find((x) => x.space.name === 'Trek')!;
    expect(created.space).toMatchObject({ icon: 'home', currency: 'INR', memberIds: ['u_kabir', 'u_swetha'] });

    await act(async () => router.back()); // the Space Page replaced Add People: Back is Home, the draft is gone
    await waitFor(() => expect(r.getPathname()).toBe('/'));
    expect(screen.queryByLabelText('Space name')).toBeNull();
  });

  it('closing the pop-up drops the draft, and the next one starts clean', async () => {
    await openHome();
    await fireEvent.press(await screen.findByLabelText('Create Space'));
    await fireEvent.changeText(screen.getByLabelText('Space name'), '   ');
    await fireEvent(screen.getByLabelText('Space name'), 'blur');
    expect(screen.getByText('Give the space a name')).toBeTruthy();
    expect(screen.getByLabelText('Next: add people')).toBeDisabled();
    await fireEvent.press(screen.getByLabelText('Close'));
    expect(screen.queryByLabelText('Space name')).toBeNull();

    await fireEvent.press(screen.getByLabelText('Create Space'));
    expect(screen.getByLabelText('Space name').props.value).toBe('');
    expect(screen.queryByText('Give the space a name')).toBeNull();
  });

  it('Back from Add People returns to the pop-up with the draft kept', async () => {
    const r = await openHome();
    await fireEvent.press(await screen.findByLabelText('Create Space'));
    await fireEvent.changeText(screen.getByLabelText('Space name'), 'Trek');
    await fireEvent.press(screen.getByRole('radio', { name: 'Party' }));
    await fireEvent.press(screen.getByLabelText('Next: add people'));
    await waitFor(() => expect(r.getPathname()).toBe('/space/add-people'));
    expect(screen.getByRole('header', { name: 'Trek' })).toBeTruthy();
    expect(screen.queryByLabelText('Space name')).toBeNull();

    // Someone added: Back asks first (Review Focus 4), and Discard still lands on the pop-up.
    await fireEvent.changeText(screen.getByLabelText('Find people'), 'arun');
    await fireEvent.press(await screen.findByLabelText('Add Arun Nair, @arun.n'));
    await act(async () => router.back());
    expect(await screen.findByText('Discard changes?')).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Discard' }));
    await waitFor(() => expect(r.getPathname()).toBe('/'));
    expect((await screen.findByLabelText('Space name')).props.value).toBe('Trek');
    expect(screen.getByRole('radio', { name: 'Party' })).toBeChecked();
  });
});

describe('Space Page', () => {
  it('space page shows "You owe Swetha ₹…" breakdown and Settle up only when owing', async () => {
    const r = await openHome();
    await fireEvent.press(await screen.findByLabelText(/^Flat 4B/));
    await waitFor(() => expect(r.getPathname()).toBe('/space/sp_flat'));
    expect(await screen.findByText('You owe ₹473.34')).toBeTruthy();
    expect(screen.getByLabelText('You owe Rohan ₹386.67')).toBeTruthy();
    expect(screen.getByLabelText('You owe Swetha ₹86.67')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Settle up' })).toBeTruthy();
    expect(screen.getByText('Needs your answer')).toBeTruthy(); // Dinner at Toit, kabir's share is pending
    // The seed dates it 2.4 h ago: "Today" or, just after midnight, "Yesterday".
    expect(screen.getByLabelText(/^Dinner at Toit, Paid by Swetha · ₹1,440 · [^,]+, Needs your answer, you owe ₹480$/)).toBeTruthy();

    await act(async () => router.back());
    await fireEvent.press(await screen.findByLabelText(/^Goa Trip/));
    await waitFor(() => expect(r.getPathname()).toBe('/space/sp_goa'));
    expect(await screen.findByLabelText('Arun owes you ₹6,460')).toBeTruthy();
    expect(screen.getByLabelText('Priya owes you ₹3,680')).toBeTruthy();
    expect(screen.queryByLabelText(/Swetha owes you|You owe Swetha/)).toBeNull(); // a zero pair is not shown
    expect(screen.queryByRole('button', { name: 'Settle up' })).toBeNull();
    expect(screen.getByText('Disputed')).toBeTruthy(); // Beach shack lunch
    expect(screen.getByLabelText(/^Priya paid you, .*Pending, ₹2,000$/)).toBeTruthy();
  });

  it('the breakdown lists the 3 largest open pairs, then See all', async () => {
    const pair = (userId: string, name: string, netMinor: number) => ({ userId, name, netMinor });
    const pairs = [pair('a', 'Asha Rao', -1000), pair('b', 'Bala K', 4000), pair('c', 'Chitra', 0), pair('d', 'Dev', 3000), pair('e', 'Esha', -2000)];
    const space: Space = { id: 's', name: 'Big', icon: 'home', currency: 'INR', ownerId: '', memberIds: [], serial: 7, createdAt: 0 };
    const balance: SpaceBalance = { spaceId: 's', currency: 'INR', netMinor: 4000, pairs, openBalances: 4, counterpartyName: null, counterpartyCount: 2, settled: false };
    await render(
      <ThemeProvider>
        <BalanceSheet space={space} members={[]} balance={balance} onSettle={() => {}} />
      </ThemeProvider>,
    );
    expect(screen.getByText('You’re owed ₹40.00')).toBeTruthy();
    expect(screen.getAllByLabelText(/owes you|You owe/).map((e) => e.props.accessibilityLabel)).toEqual([
      'Bala owes you ₹40',
      'Dev owes you ₹30',
      'You owe Esha ₹20',
    ]);
    await fireEvent.press(screen.getByRole('button', { name: 'See all 4' }));
    expect(screen.getByLabelText('You owe Asha ₹10')).toBeTruthy();
    expect(screen.queryByLabelText(/Chitra/)).toBeNull(); // a zero pair never shows
    expect(screen.getByRole('button', { name: 'Settle up' })).toBeTruthy();
  });

  it('empty space shows "No expenses yet — tap + to add the first one."', async () => {
    const space = await currentServices().spaces.create({ name: 'Trek', icon: 'trip', currency: 'INR', memberIds: ['u_swetha'] });
    const r = await openHome();
    await act(async () => router.push(`/space/${space.id}`));
    expect(await screen.findByText('No expenses yet')).toBeTruthy();
    expect(screen.getByText('Tap + to add the first one.')).toBeTruthy();
    expect(screen.getByText('Settled up')).toBeTruthy();
    await fireEvent.press(screen.getByLabelText('Add expense'));
    await waitFor(() => expect(r.getPathname()).toBe(`/space/${space.id}/expense-new`));
  });
});
