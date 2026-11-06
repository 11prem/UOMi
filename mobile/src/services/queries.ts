import { QueryClient } from '@tanstack/react-query';
import type { Services } from './types';

/**
 * The app's one cache. Switching mode or signing out clears it (`state/session.ts`), so data never crosses modes or users.
 * No automatic retries: a failed load shows its Error state with Retry straight away (specs § 3.2).
 */
export const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: false, staleTime: 30_000 }, mutations: { retry: false } },
});

type TxFilter = Parameters<Services['transactions']['list']>[0];

/** Query keys. Invalidate a prefix (`qk.spaces`, `['notifications']`) after a write that changes it. */
export const qk = {
  spaces: ['spaces'] as const,
  overall: ['spaces', 'overall'] as const,
  space: (id: string) => ['spaces', id] as const,
  expense: (id: string) => ['expenses', id] as const,
  settlement: (id: string) => ['settlements', id] as const,
  payees: (spaceId: string) => ['settlements', 'payees', spaceId] as const,
  notifications: ['notifications'] as const,
  unread: ['notifications', 'unread'] as const,
  transactions: (f: TxFilter) => ['transactions', f] as const,
  userSearch: (q: string) => ['users', q] as const,
  profile: ['profile'] as const,
  preferences: ['preferences'] as const,
  debug: ['debug'] as const,
};
