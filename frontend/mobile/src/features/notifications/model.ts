import type { QueryClient } from '@tanstack/react-query';
import { relDate } from '../../domain/dates';
import type { AppNotification } from '../../domain/types';
import { AppError } from '../../services/errors';
import type { Services } from '../../services/types';
import type { IconName } from '../../ui/Icon';
import { toast } from '../../ui/Toast';

/** Where a tap on a notification goes (specs § 11.1; app.js `openNotif`). Null: nowhere. Branches on `type`, never on `spaceId`. */
export function targetOf(n: AppNotification): string | null {
  switch (n.type) {
    case 'expense_share':
    case 'share_rejected':
      if (n.refId) return `/expense/${n.refId}`;
      break;
    case 'payment_to_confirm':
    case 'payment_answered':
      if (n.refId) return `/payment/${n.refId}`;
      break;
    case 'reminder':
      return n.spaceId ? `/space/${n.spaceId}/settle` : null; // a Reminder opens Settle Up, not the space
    case 'space_deleted':
      return null; // the space is gone
  }
  return n.spaceId ? `/space/${n.spaceId}` : null; // space_added, or an item that has lost its id
}

export const ICON: Record<AppNotification['type'], IconName> = {
  expense_share: 'receipt',
  share_rejected: 'alert',
  payment_to_confirm: 'swap',
  payment_answered: 'swap',
  space_added: 'users',
  space_deleted: 'trash',
  reminder: 'bell',
};

/** The line under the message: the space (a deleted one has no page to name, so the card says how it ended). */
export function subOf(n: AppNotification): string {
  if (n.type === 'space_deleted') return 'Everyone was settled up';
  return n.type === 'reminder' && n.spaceName ? `${n.spaceName} · tap to settle up` : (n.spaceName ?? '');
}

const dayKey = (ms: number) => {
  const d = new Date(ms);
  return d.getFullYear() * 10_000 + d.getMonth() * 100 + d.getDate();
};

/** The Earlier list as groups: "Today", "Yesterday", then each older day by its date. `rows` is newest first. */
export function groupByDay(rows: AppNotification[]): { key: number; label: string; items: AppNotification[] }[] {
  const groups: { key: number; label: string; items: AppNotification[] }[] = [];
  for (const n of rows) {
    const key = dayKey(n.createdAt);
    const last = groups[groups.length - 1];
    if (last?.key === key) last.items.push(n);
    else groups.push({ key, label: relDate(n.createdAt), items: [n] });
  }
  return groups;
}

/**
 * An answer to a needs-answer card (Home or Notifications) that the service refused. `not_found`: it was already answered
 * or removed, so the card is marked read and the lists refresh. Anything else is only shown.
 */
export function answerFailed(e: unknown, n: AppNotification, services: Services, queryClient: QueryClient) {
  if (e instanceof AppError && e.code === 'not_found') {
    toast('This was already answered or removed');
    void services.notifications
      .markRead(n.id)
      .catch(() => {})
      .finally(() => queryClient.invalidateQueries());
    return;
  }
  toast(e instanceof Error ? e.message : 'Something went wrong. Your data is safe.');
}
