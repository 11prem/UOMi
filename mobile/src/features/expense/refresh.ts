import type { QueryClient, QueryKey } from '@tanstack/react-query';
import { qk } from '../../services/queries';

/**
 * After a write that moves money or members: refetch what shows it — every space query (list, overall, each page),
 * notifications (and the unread badge), transactions and the Settle Up maxima — plus any `extra` keys (the expense or
 * payment just changed). Always invalidation, never `setQueryData`, so every screen reads the one calculator's result.
 */
export function refreshMoney(queryClient: QueryClient, ...extra: QueryKey[]) {
  const keys: QueryKey[] = [qk.spaces, qk.notifications, ['transactions'], ['settlements', 'payees'], ...extra];
  return Promise.all(keys.map((queryKey) => queryClient.invalidateQueries({ queryKey })));
}

/** The message to toast for a refused write (`forbidden` carries the rule's reason, `network` says offline). */
export const errorText = (e: unknown) => (e instanceof Error && e.message ? e.message : 'Something went wrong. Your data is safe.');
