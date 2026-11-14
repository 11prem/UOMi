import {
  SPACE_ICONS,
  type ActivityRow,
  type AppNotification,
  type Currency,
  type NotificationType,
  type OverallLine,
  type Pair,
  type ShareResponse,
  type Settlement,
  type SettlementStatus,
  type Space,
  type SpaceBalance,
  type SpaceIcon,
  type User,
} from '../../domain/types';

// ---- the backend's JSON (snake_case), as documented in the plan's "Backend contract" table ----

export type PersonDto = { username: string; name: string };
export type MeDto = PersonDto & { phone: string; currency: string };
export type SpaceCardDto = {
  id: number;
  name: string;
  icon: string;
  currency: string;
  member_count: number;
  balance_minor: number;
  open_balances: number;
  counterparty_name: string | null;
  counterparty_count: number;
  last_activity_at: string;
};
export type OverallDto = { currency: string; net_minor: number; owe_minor: number; owed_minor: number };
export type SpaceListDto = { overall: OverallDto[]; spaces: SpaceCardDto[] };
export type ExpenseRowDto = {
  id: number;
  description: string;
  amount_minor: number;
  paid_by: PersonDto;
  date: string; // YYYY-MM-DD
  my_share_minor: number | null;
  my_share_status: ShareResponse | null;
  disputed: boolean;
};
export type SettlementRowDto = {
  id: number;
  from_user: PersonDto;
  to_user: PersonDto;
  amount_minor: number;
  status: SettlementStatus;
  created_at: string;
};
export type SpaceDetailDto = {
  id: number;
  name: string;
  icon: string;
  currency: string;
  owner_username: string;
  created_at: string;
  balance_minor: number;
  members: (PersonDto & { position: number })[];
  expenses: ExpenseRowDto[];
  settlements: SettlementRowDto[];
  pairwise: { debtor: PersonDto; creditor: PersonDto; amount_minor: number }[];
};
export type NotificationDto = {
  id: number;
  type: NotificationType;
  message: string;
  space_id: number | null;
  space_name: string | null;
  ref_id: number | null;
  needs_answer: boolean;
  read: boolean;
  created_at: string;
};
export type NotificationListDto = { items: NotificationDto[]; next_before: number | null; unread_count: number };
export type SearchResultDto = PersonDto & { is_friend: boolean };
export type SpaceHeaderDto = { id: number; name: string; icon: string; currency: string; owner_username: string; created_at: string };
export type SettlementDetailDto = {
  id: number;
  space: SpaceHeaderDto;
  from_user: PersonDto;
  to_user: PersonDto;
  amount_minor: number;
  status: SettlementStatus;
  created_at: string;
  answered_at: string | null;
};
export type PayeeDto = { user: PersonDto; owed_minor: number; max_minor: number };

/** A row of GET /transactions: the Space page's expense or payment row, with the space it belongs to. */
export type TransactionSpaceDto = { space_id: number; space_name: string; currency: string };
export type TransactionDto = ((ExpenseRowDto & { kind: 'expense' }) | (SettlementRowDto & { kind: 'payment' })) & TransactionSpaceDto;
/** `next_before` is an opaque marker for the next page, null on the last one. */
export type TransactionListDto = { items: TransactionDto[]; next_before: string | null };

// ---- small conversions ----

/** An ISO-8601 time as epoch ms. Hermes may not take more than 3 fractional digits (the backend sends 6), and a time with no zone is UTC. */
export function ms(iso: string): number {
  const s = iso.replace(/(\.\d{3})\d+/, '$1');
  return Date.parse(/(Z|[+-]\d\d:?\d\d)$/.test(s) ? s : `${s}Z`);
}

/** `2026-11-03` as midnight that day on the device, so the day shown is the day typed (UTC midnight would shift it west of Greenwich). */
export function dayMs(date: string): number {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(y, m - 1, d).getTime();
}

const icon = (key: string): SpaceIcon => ((SPACE_ICONS as readonly string[]).includes(key) ? (key as SpaceIcon) : 'other');

/** Avatar colour 1 to 6: by place in the space where there is one, otherwise from the username (the same person always gets the same colour). */
export function plateOf(username: string, position?: number): User['plate'] {
  const n = position !== undefined ? position - 1 : [...username].reduce((sum, ch) => sum + ch.charCodeAt(0), 0);
  return ((n % 6) + 1) as User['plate'];
}

/** `phone` is only known for the signed-in user. */
export const toUser = (p: PersonDto, o: { position?: number; phone?: string } = {}): User => ({
  id: p.username,
  username: p.username,
  name: p.name,
  phone: o.phone ?? null,
  phoneVerified: true,
  avatarUrl: null,
  plate: plateOf(p.username, o.position),
});

// ---- Home ----

/** Home cards only know who is in the space by count, so owner and members are empty: screens read them from `spaces.get`. */
export const cardSpace = (c: SpaceCardDto): Space => ({
  id: String(c.id),
  name: c.name,
  icon: icon(c.icon),
  currency: c.currency as Currency,
  ownerId: '',
  memberIds: [],
  serial: c.id,
  createdAt: ms(c.last_activity_at),
});

export const cardBalance = (c: SpaceCardDto): SpaceBalance => ({
  spaceId: String(c.id),
  currency: c.currency as Currency,
  netMinor: c.balance_minor,
  pairs: [],
  openBalances: c.open_balances,
  counterpartyName: c.counterparty_name,
  counterpartyCount: c.counterparty_count,
  settled: c.open_balances === 0,
});

export const toOverall = (l: OverallDto): OverallLine => ({
  currency: l.currency as Currency,
  netMinor: l.net_minor,
  oweMinor: l.owe_minor,
  owedMinor: l.owed_minor,
});

// ---- Space page ----

/** What the viewer's row of an expense shows: negative = they owe their share, positive = the others owe them; null = not involved. */
const myPart = (e: ExpenseRowDto, me: string): number | null =>
  e.paid_by.username === me ? e.amount_minor - (e.my_share_minor ?? 0) : e.my_share_minor === null ? null : 0 - e.my_share_minor; // 0 − x: never −0

/** One expense as a row of the Space page or the Transactions page. The day is that day on this device. */
export const expenseActivity = (e: ExpenseRowDto, me: string): ActivityRow => ({
  kind: 'expense',
  id: String(e.id),
  description: e.description,
  date: dayMs(e.date),
  amountMinor: e.amount_minor,
  paidById: e.paid_by.username,
  paidByName: e.paid_by.name,
  myPartMinor: myPart(e, me),
  myResponse: e.my_share_status,
  disputed: e.disputed,
});

/** One payment as a row of the Space page or the Transactions page. */
export const paymentActivity = (s: SettlementRowDto): ActivityRow => ({
  kind: 'payment',
  id: String(s.id),
  date: ms(s.created_at),
  fromId: s.from_user.username,
  fromName: s.from_user.name,
  toId: s.to_user.username,
  toName: s.to_user.name,
  amountMinor: s.amount_minor,
  status: s.status,
});

export function toSpaceDetail(d: SpaceDetailDto, me: User) {
  const id = String(d.id);
  const space: Space = {
    id,
    name: d.name,
    icon: icon(d.icon),
    currency: d.currency as Currency,
    ownerId: d.owner_username,
    memberIds: d.members.map((m) => m.username),
    serial: d.id,
    createdAt: ms(d.created_at),
  };
  const members = d.members.map((m) => toUser(m, { position: m.position, phone: m.username === me.username ? (me.phone ?? undefined) : undefined }));

  // The viewer's side of each pairwise line (+ = they owe the viewer), in member order, then anyone who has left with a
  // balance still open (the server lists only open pairs).
  const lines = new Map<string, Pair>();
  for (const p of d.pairwise) {
    if (p.creditor.username === me.username) lines.set(p.debtor.username, { userId: p.debtor.username, name: p.debtor.name, netMinor: p.amount_minor });
    else if (p.debtor.username === me.username) lines.set(p.creditor.username, { userId: p.creditor.username, name: p.creditor.name, netMinor: -p.amount_minor });
  }
  const pairs = [...space.memberIds.flatMap((m) => lines.get(m) ?? []), ...[...lines.values()].filter((p) => !space.memberIds.includes(p.userId))];
  const open = pairs.filter((p) => p.netMinor !== 0);
  const side = open.filter((p) => Math.sign(p.netMinor) === Math.sign(d.balance_minor)); // the people on the side of the net; nobody when it is 0
  const balance: SpaceBalance = {
    spaceId: id,
    currency: space.currency,
    netMinor: d.balance_minor,
    pairs,
    openBalances: open.length,
    counterpartyName: side.length === 1 ? side[0].name : null,
    counterpartyCount: side.length,
    settled: open.length === 0,
  };

  const expenses = d.expenses.map((e) => expenseActivity(e, me.username));
  const payments = d.settlements.map(paymentActivity);
  // Newest first; the sort is stable, so rows of the same day keep the server's order (newest id first).
  const activity = [...expenses, ...payments].sort((a, b) => b.date - a.date);
  // Every pair in the space, the viewer's or not: who still owes or is owed anyone.
  const openPairs = d.pairwise.filter((p) => p.amount_minor !== 0);
  const inOpenPair = new Set(openPairs.flatMap((p) => [p.debtor.username, p.creditor.username]));
  const settledMemberIds = space.memberIds.filter((m) => !inOpenPair.has(m));
  return { space, members, balance, activity, settledMemberIds, allSettled: openPairs.length === 0 };
}

// ---- Notifications ----

export const toNotification = (n: NotificationDto, userId: string): AppNotification => ({
  id: String(n.id),
  userId,
  type: n.type,
  message: n.message,
  spaceId: n.space_id === null ? null : String(n.space_id),
  spaceName: n.space_name,
  refId: n.ref_id === null ? null : String(n.ref_id),
  needsAnswer: n.needs_answer,
  read: n.read,
  createdAt: ms(n.created_at),
});

// ---- Settle up ----

export const toPayee = (p: PayeeDto) => ({ user: toUser(p.user), owedMinor: p.owed_minor, maxMinor: p.max_minor });

/** The payment screen. The space comes as a header only (no member list), like a Home card, so `memberIds` is empty. */
export function toSettlementDetail(d: SettlementDetailDto) {
  const space: Space = {
    id: String(d.space.id),
    name: d.space.name,
    icon: icon(d.space.icon),
    currency: d.space.currency as Currency,
    ownerId: d.space.owner_username,
    memberIds: [],
    serial: d.space.id,
    createdAt: ms(d.space.created_at),
  };
  const settlement: Settlement = {
    id: String(d.id),
    spaceId: space.id,
    fromUserId: d.from_user.username,
    toUserId: d.to_user.username,
    amountMinor: d.amount_minor,
    date: ms(d.created_at),
    status: d.status,
    answeredAt: d.answered_at === null ? null : ms(d.answered_at),
  };
  return { settlement, space, from: toUser(d.from_user), to: toUser(d.to_user) };
}

// ---- Transactions ----

export const toTransaction = (t: TransactionDto, me: User): ActivityRow & { spaceId: string; spaceName: string; currency: Currency } => ({
  ...(t.kind === 'expense' ? expenseActivity(t, me.username) : paymentActivity(t)),
  spaceId: String(t.space_id),
  spaceName: t.space_name,
  currency: t.currency as Currency,
});
