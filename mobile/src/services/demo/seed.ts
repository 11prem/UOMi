import type { AppNotification, Currency, Expense, Settlement, Share, ShareResponse, Space, SpaceIcon, SplitType, User } from '../../domain/types';
import type { DemoDb } from './db';
import { messages } from './messages';

// Ported from prototype/js/data.js seed(). Dates are offsets from `now`, so the data always looks recent and the
// balances do not depend on the day (they are the "Seed expected values" table of the plan).

const DAY = 86_400_000;
export const DEMO_PASSWORD = 'demo1234';

type Plate = User['plate'];
const USERS: [id: string, username: string, name: string, phone: string, plate: Plate][] = [
  ['u_kabir', 'kabir.r', 'Kabir Rao', '+919845012331', 1],
  ['u_swetha', 'swetha.i', 'Swetha Iyer', '+919880213344', 2],
  ['u_arun', 'arun.n', 'Arun Nair', '+919446078812', 3],
  ['u_meera', 'meera.s', 'Meera Shah', '+971501234567', 4],
  ['u_rohan', 'rohan.d', 'Rohan Das', '+919830045566', 5],
  ['u_priya', 'priya.m', 'Priya Menon', '+919567001122', 6],
];

export function seed(now: number): DemoDb {
  const ago = (days: number) => Math.round(now - days * DAY);

  const users: User[] = USERS.map(([id, username, name, phone, plate]) => ({ id, username, name, phone, phoneVerified: true, avatarUrl: null, plate }));
  const passwords = Object.fromEntries(users.map((u) => [u.id, DEMO_PASSWORD]));
  const first = (id: string) => users.find((u) => u.id === id)!.name.split(' ')[0];

  const sp = (id: string, name: string, icon: SpaceIcon, currency: Currency, ownerId: string, memberIds: string[], serial: number, days: number): Space => ({
    id, name, icon, currency, ownerId, memberIds, serial, createdAt: ago(days),
  });
  const spaces = [
    sp('sp_flat', 'Flat 4B', 'home', 'INR', 'u_kabir', ['u_kabir', 'u_swetha', 'u_rohan'], 412, 60),
    sp('sp_goa', 'Goa Trip', 'trip', 'INR', 'u_arun', ['u_kabir', 'u_arun', 'u_swetha', 'u_priya'], 398, 30),
    sp('sp_office', 'Office lunches', 'food', 'INR', 'u_priya', ['u_kabir', 'u_priya', 'u_rohan'], 371, 90),
    sp('sp_dubai', 'Dubai stopover', 'trip', 'USD', 'u_kabir', ['u_kabir', 'u_meera'], 420, 12),
    sp('sp_cricket', 'Sunday cricket', 'friends', 'INR', 'u_arun', ['u_kabir', 'u_arun', 'u_rohan'], 377, 45),
  ];
  const spaceOf = (id: string) => spaces.find((s) => s.id === id)!;

  const ex = (id: string, spaceId: string, description: string, amountMinor: number, paidBy: string, splitType: SplitType, shares: Share[], createdBy: string, days: number): Expense => ({
    id, spaceId, description, amountMinor, paidBy, splitType, shares, createdBy, date: ago(days), updatedAt: ago(days),
  });
  // `input` is what was typed: major units for exact (700 = ₹700.00), a percentage, or a share count; null for equal.
  const sh = (userId: string, amountMinor: number, response: ShareResponse, input: number | null = null): Share => ({ userId, input, amountMinor, response });
  const expenses = [
    ex('e_groc', 'sp_flat', 'Groceries — DMart', 234000, 'u_rohan', 'equal',
      [sh('u_kabir', 78000, 'accepted'), sh('u_swetha', 78000, 'accepted'), sh('u_rohan', 78000, 'accepted')], 'u_rohan', 6),
    ex('e_wifi', 'sp_flat', 'Wi-Fi bill', 118000, 'u_kabir', 'equal',
      [sh('u_kabir', 39334, 'accepted'), sh('u_swetha', 39333, 'accepted'), sh('u_rohan', 39333, 'accepted')], 'u_kabir', 4),
    ex('e_toit', 'sp_flat', 'Dinner at Toit', 144000, 'u_swetha', 'equal',
      [sh('u_kabir', 48000, 'pending'), sh('u_swetha', 48000, 'accepted'), sh('u_rohan', 48000, 'accepted')], 'u_swetha', 0.1),
    ex('e_villa', 'sp_goa', 'Villa booking, Anjuna', 1840000, 'u_kabir', 'shares',
      [sh('u_kabir', 368000, 'accepted', 1), sh('u_arun', 736000, 'accepted', 2), sh('u_swetha', 368000, 'accepted', 1), sh('u_priya', 368000, 'accepted', 1)], 'u_kabir', 21),
    ex('e_scoot', 'sp_goa', 'Scooter rentals', 360000, 'u_arun', 'equal',
      [sh('u_kabir', 90000, 'accepted'), sh('u_arun', 90000, 'accepted'), sh('u_swetha', 90000, 'accepted'), sh('u_priya', 90000, 'accepted')], 'u_arun', 19),
    ex('e_shack', 'sp_goa', 'Beach shack lunch', 268000, 'u_swetha', 'exact',
      [sh('u_kabir', 70000, 'accepted', 700), sh('u_arun', 82000, 'accepted', 820), sh('u_swetha', 56000, 'accepted', 560), sh('u_priya', 60000, 'rejected', 600)], 'u_swetha', 18),
    ex('e_lunch', 'sp_office', 'Team lunch — Meghana Foods', 180000, 'u_priya', 'equal',
      [sh('u_kabir', 60000, 'accepted'), sh('u_priya', 60000, 'accepted'), sh('u_rohan', 60000, 'accepted')], 'u_priya', 11),
    ex('e_taxi', 'sp_dubai', 'Airport taxi', 7000, 'u_kabir', 'percent',
      [sh('u_kabir', 3500, 'accepted', 50), sh('u_meera', 3500, 'accepted', 50)], 'u_kabir', 3),
    ex('e_ground', 'sp_cricket', 'Ground booking', 80000, 'u_arun', 'equal',
      [sh('u_kabir', 40000, 'accepted'), sh('u_arun', 40000, 'accepted')], 'u_arun', 8),
    ex('e_ball', 'sp_cricket', 'New ball and tape', 80000, 'u_kabir', 'equal',
      [sh('u_kabir', 40000, 'accepted'), sh('u_rohan', 40000, 'accepted')], 'u_kabir', 7),
  ];
  const expenseOf = (id: string) => expenses.find((e) => e.id === id)!;

  const st = (id: string, spaceId: string, fromUserId: string, toUserId: string, amountMinor: number, status: Settlement['status'], days: number, answeredDays: number | null): Settlement => ({
    id, spaceId, fromUserId, toUserId, amountMinor, status, date: ago(days), answeredAt: answeredDays == null ? null : ago(answeredDays),
  });
  const settlements = [
    st('st_sw', 'sp_goa', 'u_swetha', 'u_kabir', 368000, 'confirmed', 14, 13),
    st('st_pr', 'sp_goa', 'u_priya', 'u_kabir', 200000, 'pending', 0.2, null),
    st('st_k1', 'sp_office', 'u_kabir', 'u_priya', 60000, 'confirmed', 10, 9),
    st('st_r1', 'sp_office', 'u_rohan', 'u_priya', 60000, 'confirmed', 10, 10),
  ];
  const settlementOf = (id: string) => settlements.find((s) => s.id === id)!;

  // Newest first, like the live list. `message` is the card's one line of text (specs § 11.2).
  let n = 0;
  const nt = (userId: string, type: AppNotification['type'], message: string, spaceId: string, refId: string | null, needsAnswer: boolean, read: boolean, days: number): AppNotification => ({
    id: `n_seed${++n}`, userId, type, message, spaceId, spaceName: spaceOf(spaceId).name, refId, needsAnswer, read, createdAt: ago(days),
  });
  const toit = expenseOf('e_toit');
  const shack = expenseOf('e_shack');
  const notifications = [
    nt('u_kabir', 'expense_share', messages.expenseShare(first(toit.createdBy), toit.description, toit.shares[0].amountMinor, 'INR'), 'sp_flat', 'e_toit', true, false, 0.1),
    nt('u_kabir', 'payment_to_confirm', messages.paymentToConfirm(first('u_priya'), settlementOf('st_pr').amountMinor, 'INR'), 'sp_goa', 'st_pr', true, false, 0.2),
    nt('u_kabir', 'reminder', messages.reminder(first('u_arun'), 40000, 'INR'), 'sp_cricket', null, false, false, 1),
    nt('u_kabir', 'payment_answered', messages.paymentAnswered(first('u_priya'), 'confirmed', settlementOf('st_k1').amountMinor, 'INR'), 'sp_office', 'st_k1', false, true, 9),
    nt('u_kabir', 'space_added', messages.spaceAdded(first('u_arun'), 'Goa Trip'), 'sp_goa', null, false, true, 30),
    nt('u_swetha', 'share_rejected', messages.shareRejected(first('u_priya'), shack.shares[3].amountMinor, shack.description, 'INR'), 'sp_goa', 'e_shack', false, false, 17),
    nt('u_meera', 'space_added', messages.spaceAdded(first('u_kabir'), 'Dubai stopover'), 'sp_dubai', null, false, false, 12),
  ];

  return {
    version: 1,
    users,
    passwords,
    spaces,
    expenses,
    settlements,
    notifications,
    session: { userId: null },
    prefs: { defaultCurrency: 'INR', theme: 'system', notificationsOn: true },
  };
}
