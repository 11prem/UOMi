import { z } from 'zod';

// Entities are Zod schemas (the demo store validates what it reads back from AsyncStorage); the
// types are inferred from them. Money is integer minor units, timestamps are epoch ms.

export const CURRENCIES = ['INR', 'USD', 'EUR', 'GBP', 'AED', 'SGD', 'AUD', 'CAD'] as const;
export type Currency = (typeof CURRENCIES)[number];

export const SPACE_ICONS = ['home', 'trip', 'food', 'office', 'friends', 'car', 'party', 'other'] as const;
export type SpaceIcon = (typeof SPACE_ICONS)[number];

const minor = z.number().int();

export const UserSchema = z.object({
  id: z.string(),
  username: z.string(),
  name: z.string(),
  phone: z.string().nullable(),
  phoneVerified: z.boolean(),
  avatarUrl: z.string().nullable(),
  plate: z.literal([1, 2, 3, 4, 5, 6]),
});
export type User = z.infer<typeof UserSchema>;

export const SpaceSchema = z.object({
  id: z.string(),
  name: z.string(),
  icon: z.enum(SPACE_ICONS),
  currency: z.enum(CURRENCIES),
  ownerId: z.string(),
  memberIds: z.array(z.string()),
  serial: z.number(),
  createdAt: z.number(),
});
export type Space = z.infer<typeof SpaceSchema>;

export const SplitTypeSchema = z.enum(['equal', 'exact', 'percent', 'shares']);
export type SplitType = z.infer<typeof SplitTypeSchema>;
export const ShareResponseSchema = z.enum(['pending', 'accepted', 'rejected']);
export type ShareResponse = z.infer<typeof ShareResponseSchema>;

export const ShareSchema = z.object({
  userId: z.string(),
  input: z.number().nullable(), // what was typed: null for equal, major-unit amount, percent, or share count
  amountMinor: minor,
  response: ShareResponseSchema,
});
export type Share = z.infer<typeof ShareSchema>;

export const ExpenseSchema = z.object({
  id: z.string(),
  spaceId: z.string(),
  description: z.string(),
  amountMinor: minor,
  paidBy: z.string(),
  splitType: SplitTypeSchema,
  shares: z.array(ShareSchema),
  date: z.number(),
  createdBy: z.string(),
  updatedAt: z.number(),
});
export type Expense = z.infer<typeof ExpenseSchema>;

export const SettlementStatusSchema = z.enum(['pending', 'confirmed', 'rejected', 'cancelled']);
export type SettlementStatus = z.infer<typeof SettlementStatusSchema>;

export const SettlementSchema = z.object({
  id: z.string(),
  spaceId: z.string(),
  fromUserId: z.string(),
  toUserId: z.string(),
  amountMinor: minor,
  date: z.number(),
  status: SettlementStatusSchema,
  answeredAt: z.number().nullable(),
});
export type Settlement = z.infer<typeof SettlementSchema>;

export const NotificationTypeSchema = z.enum([
  'expense_share',
  'share_rejected',
  'payment_to_confirm',
  'payment_answered',
  'space_added',
  'space_deleted',
  'reminder',
]);
export type NotificationType = z.infer<typeof NotificationTypeSchema>;

export const AppNotificationSchema = z.object({
  id: z.string(),
  userId: z.string(),
  type: NotificationTypeSchema,
  message: z.string(),
  spaceId: z.string().nullable(),
  spaceName: z.string().nullable(),
  refId: z.string().nullable(),
  needsAnswer: z.boolean(),
  read: z.boolean(),
  createdAt: z.number(),
});
export type AppNotification = z.infer<typeof AppNotificationSchema>;

export const PreferencesSchema = z.object({
  defaultCurrency: z.enum(CURRENCIES),
  theme: z.enum(['system', 'light', 'dark']),
  notificationsOn: z.boolean(),
});
export type Preferences = z.infer<typeof PreferencesSchema>;

// View models shared by both service implementations (computed, never persisted).
export type Pair = { userId: string; name: string; netMinor: number }; // + = they owe the viewer
export type SpaceBalance = {
  spaceId: string;
  currency: Currency;
  netMinor: number;
  pairs: Pair[];
  openBalances: number;
  counterpartyName: string | null;
  counterpartyCount: number;
  settled: boolean;
};
export type OverallLine = { currency: Currency; netMinor: number; oweMinor: number; owedMinor: number };
export type ActivityRow =
  | {
      kind: 'expense';
      id: string;
      description: string;
      date: number;
      amountMinor: number;
      paidById: string;
      paidByName: string;
      myPartMinor: number | null; // signed from the viewer's side: + what the others owe them (they paid), − their own share (someone else paid), null = not involved
      myResponse: ShareResponse | null;
      disputed: boolean;
    }
  | {
      kind: 'payment';
      id: string;
      date: number;
      fromId: string;
      fromName: string;
      toId: string;
      toName: string;
      amountMinor: number;
      status: SettlementStatus;
    };
