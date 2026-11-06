import type {
  ActivityRow,
  AppNotification,
  Currency,
  Expense,
  OverallLine,
  Preferences,
  Settlement,
  Space,
  SpaceBalance,
  SpaceIcon,
  User,
} from '../domain/types';

/**
 * The one interface every screen reads and writes through. `demo/` serves it from AsyncStorage, `server/` over HTTP.
 * Everything is "as the signed-in user": calls other than `auth.*` throw `AppError('session_expired')` when nobody is signed in.
 * Money is integer minor units. `Share.input` units: exact = MAJOR units (700 = ₹700.00), percent = a percentage, shares = a whole count.
 */
export interface Services {
  mode: 'demo' | 'server';
  auth: {
    signUp(i: { username: string; name: string; phone: string; password: string }): Promise<{ pendingId: string; maskedPhone: string }>;
    verifySignUpOtp(pendingId: string, code: string): Promise<User>;
    /** `ref` is a `pendingId` or a `resetId`. */
    resendOtp(ref: string): Promise<{ resendAfterSeconds: number }>;
    signIn(username: string, password: string): Promise<User>;
    signOut(): Promise<void>;
    /** On launch: the signed-in user, or null. */
    restore(): Promise<User | null>;
    /** Both resolve to `true` when the value is FREE to register ("✓ available"), `false` when taken. */
    checkUsername(u: string): Promise<boolean>;
    checkPhone(e164: string): Promise<boolean>;
    requestResetOtp(username: string): Promise<{ resetId: string; maskedPhone: string }>;
    verifyResetOtp(resetId: string, code: string): Promise<{ resetToken: string }>;
    resetPassword(resetToken: string, newPassword: string): Promise<{ username: string }>;
  };
  /** Never returns the viewer. */
  users: { search(q: string): Promise<User[]> };
  spaces: {
    /** Sorted, newest activity first. */
    list(): Promise<{ space: Space; balance: SpaceBalance; lastActivity: number }[]>;
    overall(): Promise<OverallLine[]>;
    get(id: string): Promise<{ space: Space; members: User[]; balance: SpaceBalance; activity: ActivityRow[] }>;
    create(i: { name: string; icon: SpaceIcon; currency: Currency; memberIds: string[] }): Promise<Space>;
    update(id: string, p: Partial<Pick<Space, 'name' | 'icon' | 'currency'>>): Promise<Space>;
    addMembers(id: string, userIds: string[]): Promise<void>;
    removeMember(id: string, userId: string): Promise<void>;
    leave(id: string): Promise<void>;
    remove(id: string): Promise<void>;
  };
  expenses: {
    get(id: string): Promise<{ expense: Expense; space: Space; members: User[] }>;
    create(i: Omit<Expense, 'id' | 'createdBy' | 'updatedAt'>): Promise<Expense>;
    update(id: string, i: Omit<Expense, 'id' | 'createdBy' | 'updatedAt'>): Promise<Expense>;
    remove(id: string): Promise<void>;
    acceptShare(id: string): Promise<void>;
    rejectShare(id: string): Promise<void>;
  };
  settlements: {
    get(id: string): Promise<{ settlement: Settlement; space: Space; from: User; to: User }>;
    /** The people the viewer owes in this space, with the most they can record paying each now. */
    payees(spaceId: string): Promise<{ user: User; maxMinor: number }[]>;
    create(i: { spaceId: string; toUserId: string; amountMinor: number }): Promise<Settlement>;
    confirm(id: string): Promise<void>;
    reject(id: string): Promise<void>;
    cancel(id: string): Promise<void>;
  };
  notifications: {
    list(): Promise<AppNotification[]>;
    markRead(id: string): Promise<void>;
    markAllRead(): Promise<void>;
    unreadCount(): Promise<number>;
  };
  transactions: {
    list(f: { kind: 'all' | 'expenses' | 'payments'; spaceId?: string }): Promise<(ActivityRow & { spaceId: string; spaceName: string; currency: Currency })[]>;
  };
  profile: {
    get(): Promise<User>;
    update(p: { name?: string; avatarUrl?: string | null }): Promise<User>;
    getPreferences(): Promise<Preferences>;
    setPreferences(p: Preferences): Promise<void>;
  };
  /** Demo only; `null` in server mode. */
  debug: null | {
    users(): Promise<User[]>;
    actAs(userId: string): Promise<User>;
    resetDemoData(): Promise<void>;
    setSimulateErrors(on: boolean): Promise<void>;
    setOffline(on: boolean): Promise<void>;
    state(): Promise<{ simulateErrors: boolean; offline: boolean }>;
  };
}
