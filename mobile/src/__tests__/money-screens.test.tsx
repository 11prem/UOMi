import path from 'path';
import { act, fireEvent, waitFor } from '@testing-library/react-native';
import { renderRouter, screen } from 'expo-router/testing-library';
import { router } from 'expo-router';
import { qk, queryClient } from '../services/queries';
import { currentServices } from '../services/useServices';
import { useSession } from '../state/session';

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

const save = () => screen.getByLabelText('Save expense');

async function fillExpense(description: string, amount: string) {
  await fireEvent.changeText(await screen.findByLabelText('Description'), description);
  await fireEvent.changeText(screen.getByLabelText('Amount'), amount);
}

describe('Add / Edit Expense', () => {
  it('add expense equal split saves and returns with toast "Expense added"', async () => {
    const r = await open('/space/sp_flat');
    await fireEvent.press(await screen.findByLabelText('Add expense'));
    await waitFor(() => expect(r.getPathname()).toBe('/space/sp_flat/expense-new'));
    expect(await screen.findByRole('header', { name: 'Add expense' })).toBeTruthy();
    expect(save()).toBeDisabled();

    await fillExpense('Pizza night', '300');
    expect(screen.getByText('₹100.00 each')).toBeTruthy();
    expect(screen.getByRole('checkbox', { name: 'You' })).toBeChecked(); // everyone is ticked by default
    expect(screen.getByRole('checkbox', { name: 'Swetha' })).toBeChecked();
    expect(screen.getByRole('button', { name: 'You' })).toBeSelected();
    expect(save()).toBeEnabled();

    await fireEvent.press(save());
    await waitFor(() => expect(r.getPathname()).toBe('/space/sp_flat'));
    expect(await screen.findByText('Expense added')).toBeTruthy();
    expect(await screen.findByText('Pizza night')).toBeTruthy();
    // Kabir paid ₹300 for three: Rohan's ₹386.67 debt drops by ₹100, Swetha's ₹86.67 flips to her owing ₹13.33.
    expect(await screen.findByLabelText('You owe Rohan ₹286.67')).toBeTruthy();
    expect(screen.getByLabelText('Swetha owes you ₹13.33')).toBeTruthy();

    const { activity } = await currentServices().spaces.get('sp_flat');
    const row = activity.find((a) => a.kind === 'expense' && a.description === 'Pizza night')!;
    const { expense } = await currentServices().expenses.get(row.id);
    expect(expense).toMatchObject({ amountMinor: 30000, paidBy: 'u_kabir', splitType: 'equal' });
    expect(expense.shares.map((s) => [s.userId, s.amountMinor, s.input])).toEqual([
      ['u_kabir', 10000, null],
      ['u_swetha', 10000, null],
      ['u_rohan', 10000, null],
    ]);
    expect(expense.date).toBeLessThanOrEqual(Date.now());
  });

  it('exact split shows "₹40.00 left to assign" and Save disabled', async () => {
    await open('/space/sp_flat/expense-new');
    await fillExpense('Pizza', '300');
    await fireEvent.press(screen.getByRole('radio', { name: 'Exact' }));
    await fireEvent.changeText(screen.getByLabelText('Exact amount for Kabir Rao'), '100');
    await fireEvent.changeText(screen.getByLabelText('Exact amount for Swetha Iyer'), '100');
    await fireEvent.changeText(screen.getByLabelText('Exact amount for Rohan Das'), '60');
    expect(screen.getByText('₹40.00 left to assign')).toBeTruthy();
    expect(save()).toBeDisabled();

    await fireEvent.changeText(screen.getByLabelText('Exact amount for Rohan Das'), '110');
    expect(screen.getByText('₹10.00 over')).toBeTruthy();
    expect(save()).toBeDisabled();

    await fireEvent.changeText(screen.getByLabelText('Exact amount for Rohan Das'), '100.009'); // a third decimal is dropped
    expect(screen.getByLabelText('Exact amount for Rohan Das').props.value).toBe('100.00');
    expect(screen.getByText('Adds up to the total')).toBeTruthy();
    expect(save()).toBeEnabled();
  });

  it('exact and percent: a ticked row left empty or at 0 makes the split invalid, so nobody gets a ₹0 share', async () => {
    await open('/space/sp_flat/expense-new');
    await fillExpense('Pizza', '300');
    await fireEvent.press(screen.getByRole('radio', { name: 'Exact' }));
    await fireEvent.changeText(screen.getByLabelText('Exact amount for Kabir Rao'), '200');
    await fireEvent.changeText(screen.getByLabelText('Exact amount for Swetha Iyer'), '100'); // adds up, Rohan left empty
    expect(screen.getByText('Enter an amount for everyone ticked, or untick them')).toBeTruthy();
    expect(save()).toBeDisabled();
    await fireEvent.changeText(screen.getByLabelText('Exact amount for Rohan Das'), '0');
    expect(screen.getByText('Enter an amount for everyone ticked, or untick them')).toBeTruthy();
    await fireEvent.press(screen.getByRole('checkbox', { name: 'Rohan' }));
    expect(screen.getByText('Adds up to the total')).toBeTruthy();
    expect(save()).toBeEnabled();

    await fireEvent.press(screen.getByRole('radio', { name: 'Percent' }));
    await fireEvent.press(screen.getByRole('checkbox', { name: 'Rohan' }));
    await fireEvent.changeText(screen.getByLabelText('Percent for Kabir Rao'), '50');
    await fireEvent.changeText(screen.getByLabelText('Percent for Swetha Iyer'), '50');
    expect(screen.getByText('Enter an amount for everyone ticked, or untick them')).toBeTruthy();
    expect(save()).toBeDisabled();
  });

  it('switching split type keeps the ticked people and clears their values; rows show their amounts live', async () => {
    await open('/space/sp_flat/expense-new');
    await fillExpense('Pizza', '300');
    await fireEvent.press(screen.getByRole('radio', { name: 'Percent' }));
    await fireEvent.changeText(screen.getByLabelText('Percent for Kabir Rao'), '50');
    expect(screen.getByText('50% left')).toBeTruthy();
    await fireEvent.press(screen.getByRole('checkbox', { name: 'Rohan' }));
    expect(screen.queryByLabelText('Percent for Rohan Das')).toBeNull();
    expect(screen.getByText('not in this')).toBeTruthy();
    await fireEvent.changeText(screen.getByLabelText('Percent for Swetha Iyer'), '50');
    expect(screen.getByText('Adds up to 100%')).toBeTruthy();
    expect(save()).toBeEnabled();

    // Shares: the ticked people stay ticked, every value resets to 1.
    await fireEvent.press(screen.getByRole('radio', { name: 'Shares' }));
    expect(screen.getByRole('checkbox', { name: 'Rohan' })).not.toBeChecked();
    expect(screen.getByLabelText('Shares for Kabir Rao').props.value).toBe('1');
    expect(screen.getByLabelText('Shares for Swetha Iyer').props.value).toBe('1');
    expect(screen.getByText('2 shares in total')).toBeTruthy();
    await fireEvent.changeText(screen.getByLabelText('Shares for Kabir Rao'), '2');
    expect(screen.getByText('3 shares in total')).toBeTruthy();
    expect(screen.getByText('₹200.00')).toBeTruthy();
    expect(screen.getByText('₹100.00')).toBeTruthy();

    // Ticking adds a row at 1 share; the last ticked person can't be unticked.
    await fireEvent.press(screen.getByRole('checkbox', { name: 'Rohan' }));
    expect(screen.getByLabelText('Shares for Rohan Das').props.value).toBe('1');
    expect(screen.getByText('4 shares in total')).toBeTruthy();
    await fireEvent.press(screen.getByRole('checkbox', { name: 'Rohan' }));
    await fireEvent.press(screen.getByRole('checkbox', { name: 'Swetha' }));
    await fireEvent.press(screen.getByRole('checkbox', { name: 'You' }));
    expect(screen.getByRole('checkbox', { name: 'You' })).toBeChecked();
    expect(screen.getByText('At least one person must be in the split')).toBeTruthy();
  });

  it('shares: an emptied box counts as 1 share, and a ticked row with 0 makes the split invalid', async () => {
    const r = await open('/space/sp_flat', '/space/sp_flat/expense-new');
    await fillExpense('Pizza', '400');
    await fireEvent.press(screen.getByRole('radio', { name: 'Shares' }));
    await fireEvent.changeText(screen.getByLabelText('Shares for Kabir Rao'), '');
    expect(screen.getByText('3 shares in total')).toBeTruthy(); // the empty box still holds 1
    await fireEvent.changeText(screen.getByLabelText('Shares for Swetha Iyer'), '0');
    expect(screen.getByText('Each person ticked needs at least 1 share')).toBeTruthy();
    expect(save()).toBeDisabled();

    await fireEvent.changeText(screen.getByLabelText('Shares for Swetha Iyer'), '2');
    expect(screen.getByText('4 shares in total')).toBeTruthy();
    expect(save()).toBeEnabled();
    await fireEvent.press(save());
    await waitFor(() => expect(r.getPathname()).toBe('/space/sp_flat'));
    const { activity } = await currentServices().spaces.get('sp_flat');
    const row = activity.find((a) => a.kind === 'expense' && a.description === 'Pizza')!;
    const { expense } = await currentServices().expenses.get(row.id);
    expect(expense.shares.map((s) => [s.userId, s.input, s.amountMinor])).toEqual([
      ['u_kabir', 1, 10000],
      ['u_swetha', 2, 20000],
      ['u_rohan', 1, 10000],
    ]);
  });

  it('leaving Add expense with typed input asks "Discard changes?"', async () => {
    const r = await open('/space/sp_flat', '/space/sp_flat/expense-new');
    await fireEvent.changeText(await screen.findByLabelText('Description'), 'Pizza');
    await act(async () => router.back());
    expect(await screen.findByText('Discard changes?')).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Keep editing' }));
    expect(r.getPathname()).toBe('/space/sp_flat/expense-new');
    await act(async () => router.back());
    await fireEvent.press(await screen.findByRole('button', { name: 'Discard' }));
    await waitFor(() => expect(r.getPathname()).toBe('/space/sp_flat'));
  });

  it('server mode Add expense shows Not available on this server yet', async () => {
    const r = await open();
    await act(async () => useSession.setState({ mode: 'server', serverUrl: 'http://x' }));
    const get = jest.spyOn(currentServices().spaces, 'get');
    await act(async () => router.push('/space/sp_flat/expense-new'));
    await waitFor(() => expect(r.getPathname()).toBe('/space/sp_flat/expense-new'));
    expect(await screen.findByText('Not available on this server yet')).toBeTruthy();
    expect(screen.queryByLabelText('Save expense')).toBeNull();
    expect(get).not.toHaveBeenCalled(); // nothing is asked of a server that can't answer
  });
});

describe('Expense Detail', () => {
  it('an answer refreshes balances and notifications as soon as it is saved, even if the user leaves mid-animation', async () => {
    const r = await open('/space/sp_flat', '/expense/e_toit');
    const invalidate = jest.spyOn(queryClient, 'invalidateQueries');
    await fireEvent.press(await screen.findByRole('button', { name: 'Accept' }));
    // Straight after the write, long before the ~380 ms peel ends and calls onGone.
    expect(invalidate).toHaveBeenCalledWith({ queryKey: qk.spaces });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: qk.notifications });
    expect(screen.getByText('Share accepted — balance updated')).toBeTruthy();

    await act(async () => router.back()); // Back during the peel: this screen unmounts before onGone
    await waitFor(() => expect(r.getPathname()).toBe('/space/sp_flat'));
    await waitFor(() => expect(screen.queryByText('Needs your answer')).toBeNull()); // the Space Page refetched
  });

  it('non-creator sees no Edit/Delete on Expense Detail', async () => {
    await open('/expense/e_toit');
    expect(await screen.findByText('Dinner at Toit')).toBeTruthy();
    expect(screen.getAllByText('₹1,440.00')).toHaveLength(2); // the bill and the Paid by row
    expect(screen.getAllByText('₹480.00')).toHaveLength(3); // one Split row each
    expect(screen.getByText('Added by Swetha · Split equally')).toBeTruthy();
    expect(screen.queryByLabelText('Edit expense')).toBeNull();
    expect(screen.queryByLabelText('Delete expense')).toBeNull();

    // Kabir's share is pending: answer it here.
    await fireEvent.press(screen.getByRole('button', { name: 'Accept' }));
    expect(await screen.findByText('Share accepted — balance updated', {}, { timeout: 3000 })).toBeTruthy();
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Accept' })).toBeNull());
    expect((await currentServices().expenses.get('e_toit')).expense.shares[0].response).toBe('accepted');
  });

  it('an expense that names someone who has left can’t be edited, and says why', async () => {
    const s = currentServices();
    const trip = await s.spaces.create({ name: 'Trip', icon: 'trip', currency: 'INR', memberIds: ['u_swetha'] });
    const shares = ['u_kabir', 'u_swetha'].map((userId) => ({ userId, input: null, amountMinor: 5000, response: 'pending' as const }));
    const e = await s.expenses.create({ spaceId: trip.id, description: 'Taxi', amountMinor: 10000, paidBy: 'u_kabir', splitType: 'equal', date: Date.now(), shares });
    await s.debug!.actAs('u_swetha');
    await s.expenses.rejectShare(e.id); // disputed, so it no longer counts and she is settled up
    await s.spaces.leave(trip.id);
    await s.debug!.actAs('u_kabir');

    await open(`/expense/${e.id}/edit`);
    expect(await screen.findByText('Swetha has left this space, so this expense can’t be edited — delete it and add it again')).toBeTruthy();
    expect(screen.queryByLabelText('Save expense')).toBeNull();
  });

  it('the creator edits an expense, then deletes it after confirming', async () => {
    const r = await open('/space/sp_flat', '/expense/e_wifi');
    await fireEvent.press(await screen.findByLabelText('Edit expense'));
    await waitFor(() => expect(r.getPathname()).toBe('/expense/e_wifi/edit'));
    expect(await screen.findByRole('header', { name: 'Edit expense' })).toBeTruthy();
    expect(screen.getByLabelText('Description').props.value).toBe('Wi-Fi bill');
    expect(screen.getByLabelText('Amount').props.value).toBe('1180');
    await fireEvent.changeText(screen.getByLabelText('Amount'), '1200');
    expect(screen.getByText('₹400.00 each')).toBeTruthy();
    await fireEvent.press(save());
    await waitFor(() => expect(r.getPathname()).toBe('/expense/e_wifi'));
    expect(await screen.findByText('Expense updated')).toBeTruthy();
    expect(await screen.findAllByText('₹1,200.00')).toHaveLength(2); // the bill and the Paid by row
    expect(screen.getAllByText('₹400.00')).toHaveLength(3);

    await fireEvent.press(screen.getByLabelText('Delete expense'));
    expect(await screen.findByText('Delete ‘Wi-Fi bill’?')).toBeTruthy();
    expect(screen.getByText('Balances will be recalculated.')).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(r.getPathname()).toBe('/space/sp_flat'));
    expect(await screen.findByText('Expense deleted')).toBeTruthy();
    expect(queryClient.getQueryState(qk.expense('e_wifi'))).toBeUndefined(); // dropped, not refetched into an error
    await expect(currentServices().expenses.get('e_wifi')).rejects.toMatchObject({ code: 'not_found' });
  });
});

describe('Settle Up and Settlement Detail', () => {
  it('settle up prefilled with max and cannot exceed it', async () => {
    const r = await open('/space/sp_cricket', '/space/sp_cricket/settle');
    // Kabir owes only Arun here (₹400), so Arun is picked and the full amount is filled in.
    expect(await screen.findByRole('radio', { name: 'Arun Nair, you owe ₹400.00' })).toBeChecked();
    const amount = screen.getByLabelText('Amount');
    expect(amount.props.value).toBe('400.00');
    expect(screen.getByText('Up to ₹400.00. Lower it for a part payment.')).toBeTruthy();

    await fireEvent.changeText(amount, '400.01');
    expect(screen.getByText('That’s more than what’s left to pay Arun')).toBeTruthy();
    expect(screen.getByLabelText('Record payment')).toBeDisabled();
    await fireEvent.changeText(amount, '0');
    expect(screen.getByText('Enter an amount above 0')).toBeTruthy();
    expect(screen.getByLabelText('Record payment')).toBeDisabled();

    await fireEvent.changeText(amount, '150');
    expect(screen.getByLabelText('Record payment')).toBeEnabled();
    await fireEvent.press(screen.getByLabelText('Record payment'));
    await waitFor(() => expect(r.getPathname()).toMatch(/^\/payment\/st_/));
    expect(await screen.findByText('Payment recorded')).toBeTruthy();
    expect(await screen.findByText('You paid Arun')).toBeTruthy();
    expect(screen.getByText('Waiting for Arun to confirm')).toBeTruthy();
    // The pending ₹150 comes off the most that can be recorded next time.
    expect((await currentServices().settlements.payees('sp_cricket'))[0].maxMinor).toBe(25000);

    await act(async () => router.back()); // the payment replaced Settle Up: Back is the Space Page
    await waitFor(() => expect(r.getPathname()).toBe('/space/sp_cricket'));

    // Back on Settle Up the row still says what is owed, with the pending part beside it; the most left is the hint.
    await act(async () => router.push('/space/sp_cricket/settle'));
    expect(await screen.findByRole('radio', { name: 'Arun Nair, you owe ₹400.00, ₹150.00 pending' })).toBeChecked();
    expect(screen.getByText('You owe ₹400.00 · ₹150.00 pending')).toBeTruthy();
    expect(screen.getByLabelText('Amount').props.value).toBe('250.00');
    expect(screen.getByText('Up to ₹250.00. Lower it for a part payment.')).toBeTruthy();
  });

  it('receiver confirms payment from Settlement Detail', async () => {
    await open('/payment/st_pr');
    expect(await screen.findByText('Priya paid you')).toBeTruthy();
    expect(screen.getByText('₹2,000.00')).toBeTruthy();
    expect(screen.getByText('Waiting for you to confirm')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Cancel payment' })).toBeNull(); // only the payer can cancel

    await fireEvent.press(screen.getByRole('button', { name: 'Confirm' }));
    expect(await screen.findByText('Payment confirmed — balance updated', {}, { timeout: 3000 })).toBeTruthy();
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Confirm' })).toBeNull());
    expect(screen.getByText(/^Confirmed on /)).toBeTruthy();
    expect((await currentServices().settlements.get('st_pr')).settlement.status).toBe('confirmed');
  });

  it('the payer cancels a pending payment after confirming', async () => {
    const s = await currentServices().settlements.create({ spaceId: 'sp_cricket', toUserId: 'u_arun', amountMinor: 10000 });
    await open(`/payment/${s.id}`);
    expect(await screen.findByText('You paid Arun')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Confirm' })).toBeNull(); // only the receiver answers
    await fireEvent.press(screen.getByRole('button', { name: 'Cancel payment' }));
    expect(await screen.findByText('Cancel this payment?')).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Keep it' }));
    expect(screen.getByRole('button', { name: 'Cancel payment' })).toBeTruthy();

    await fireEvent.press(screen.getByRole('button', { name: 'Cancel payment' }));
    const buttons = await screen.findAllByRole('button', { name: 'Cancel payment' });
    await fireEvent.press(buttons[buttons.length - 1]); // the dialog's, mounted last
    expect(await screen.findByText('Payment cancelled')).toBeTruthy();
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Cancel payment' })).toBeNull());
    expect((await currentServices().settlements.get(s.id)).settlement.status).toBe('cancelled');
  });
});

describe('Members & Space Settings', () => {
  it('owner remove member disabled with "Settle up first" when unsettled', async () => {
    await open('/space/sp_flat/members');
    expect(await screen.findByText('Rohan Das')).toBeTruthy();
    await fireEvent.press(screen.getByLabelText('Options for Rohan Das'));
    expect(await screen.findByRole('button', { name: 'Remove from space' })).toBeDisabled();
    expect(screen.getByText(/^Settle up first/)).toBeTruthy();
  });

  it('the owner removes a settled member after confirming', async () => {
    const sp = await currentServices().spaces.create({ name: 'Trek', icon: 'trip', currency: 'INR', memberIds: ['u_swetha', 'u_arun'] });
    await open(`/space/${sp.id}/members`);
    await fireEvent.press(await screen.findByLabelText('Options for Swetha Iyer'));
    await fireEvent.press(await screen.findByRole('button', { name: 'Remove from space' }));
    expect(await screen.findByText('Remove Swetha Iyer?')).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Remove' }));
    expect(await screen.findByText('Swetha removed')).toBeTruthy();
    await waitFor(() => expect(screen.queryByText('Swetha Iyer')).toBeNull());
    expect((await currentServices().spaces.get(sp.id)).space.memberIds).toEqual(['u_kabir', 'u_arun']);
  });

  it('currency is read-only once there are expenses; the owner has no Leave and can’t delete until settled', async () => {
    await open('/space/sp_flat/members');
    expect(await screen.findByText('Can’t change after expenses are added')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Currency/ })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Leave space' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Delete space' })).toBeDisabled();
    expect(screen.getByText('You can delete this space once everyone is settled up. As owner you can’t leave it.')).toBeTruthy();
  });

  it('a member who is not settled can’t leave, and sees no member options', async () => {
    await open('/space/sp_goa/members'); // Arun owns Goa Trip; Arun and Priya owe Kabir
    expect(await screen.findByRole('button', { name: 'Leave space' })).toBeDisabled();
    expect(screen.getByText('Settle up first — you have open balances here.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Delete space' })).toBeNull();
    expect(screen.queryByLabelText(/^Options for/)).toBeNull();
    expect(screen.getByText('@arun.n · owes you ₹6,460')).toBeTruthy();
  });

  it('any member renames the space and adds people from the search', async () => {
    await open('/space/sp_goa/members'); // Kabir is a member, not the owner
    await fireEvent.press(await screen.findByRole('button', { name: 'Edit name and icon, Goa Trip' }));
    await fireEvent.changeText(await screen.findByLabelText('Space name'), '  Goa 2026 ');
    await fireEvent.press(screen.getByRole('radio', { name: 'Party' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText('Space updated')).toBeTruthy();
    expect((await currentServices().spaces.get('sp_goa')).space).toMatchObject({ name: 'Goa 2026', icon: 'party' });

    await fireEvent.press(screen.getByRole('button', { name: 'Add people' }));
    await fireEvent.changeText(await screen.findByLabelText('Find people'), 'meera');
    await fireEvent.press(await screen.findByLabelText('Add Meera Shah, @meera.s'));
    await fireEvent.press(screen.getByRole('button', { name: 'Add 1 person' }));
    expect(await screen.findByText('1 person added')).toBeTruthy();
    expect(await screen.findByText('@meera.s')).toBeTruthy();
    expect((await currentServices().spaces.get('sp_goa')).space.memberIds).toContain('u_meera');
  });

  it('the owner of a space with no expenses changes its currency, then deletes it and lands on Home', async () => {
    const sp = await currentServices().spaces.create({ name: 'Trek', icon: 'trip', currency: 'INR', memberIds: ['u_swetha'] });
    const r = await open(`/space/${sp.id}`, `/space/${sp.id}/members`);
    await fireEvent.press(await screen.findByRole('button', { name: 'Currency, Indian rupee. Only you can change this' }));
    await fireEvent.press(await screen.findByRole('radio', { name: 'US dollar, USD' }));
    expect(await screen.findByText('Currency changed to USD')).toBeTruthy();
    expect(await screen.findByText('US dollar')).toBeTruthy();

    expect(screen.getByText('Deleting removes its expenses and payments for everyone. Everyone must be settled up.')).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Delete space' }));
    expect(await screen.findByText('Delete Trek?')).toBeTruthy();
    const buttons = screen.getAllByRole('button', { name: 'Delete space' });
    await fireEvent.press(buttons[buttons.length - 1]); // the dialog's, mounted last
    await waitFor(() => expect(r.getPathname()).toBe('/'));
    expect(await screen.findByText('Trek deleted')).toBeTruthy();
    expect((await currentServices().spaces.list()).some((x) => x.space.id === sp.id)).toBe(false);
  });

  it('a settled member leaves the space after confirming and lands on Home', async () => {
    const r = await open('/space/sp_office', '/space/sp_office/members'); // Priya owns it; Kabir is settled up there
    expect(await screen.findByText('You’re settled up, so you can leave.')).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Leave space' }));
    expect(await screen.findByText('Leave Office lunches?')).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Leave' }));
    await waitFor(() => expect(r.getPathname()).toBe('/'));
    expect(await screen.findByText('You left Office lunches')).toBeTruthy();
    await expect(currentServices().spaces.get('sp_office')).rejects.toMatchObject({ code: 'not_found' });
  });

  it('server mode Members lists the members with every action off', async () => {
    const data = await currentServices().spaces.get('sp_flat');
    const r = await open();
    await act(async () => useSession.setState({ mode: 'server', serverUrl: 'http://x' }));
    jest.spyOn(currentServices().spaces, 'get').mockResolvedValue(data);
    await act(async () => router.push('/space/sp_flat/members'));
    await waitFor(() => expect(r.getPathname()).toBe('/space/sp_flat/members'));
    expect(await screen.findByText('Rohan Das')).toBeTruthy();
    expect(screen.getByText('Not available on this server yet')).toBeTruthy();
    expect(screen.queryByLabelText(/^Options for/)).toBeNull();
    expect(screen.queryByRole('button', { name: 'Add people' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Delete space' })).toBeNull();
  });
});
