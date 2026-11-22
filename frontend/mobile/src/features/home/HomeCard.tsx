import { useRef, useState } from 'react';
import { Text, View } from 'react-native';
import { useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import type { AppNotification } from '../../domain/types';
import { useServices } from '../../services/useServices';
import { answerFailed } from '../notifications/model';
import { useTheme } from '../../theme/ThemeProvider';
import { CarbonCopy } from '../../ui/CarbonCopy';
import { IconButton } from '../../ui/IconButton';
import { Press } from '../../ui/Press';
import { Sheet } from '../../ui/Sheet';
import { Skeleton } from '../../ui/Skeleton';
import { Stamp } from '../../ui/Stamp';
import { toast } from '../../ui/Toast';

/** The Home strip (DESIGN.md § Layout): the bill beside a fixed Create Space sheet, both this tall. */
export const STRIP = { height: 150, tile: 124 } as const;

const openNotifications = () => router.navigate('/notifications');

/** The card's second line; a deleted space's card names the space in its message already. */
const subOf = (n: AppNotification) => (n.type === 'space_deleted' ? 'Everyone was settled up' : (n.spaceName ?? ''));

/**
 * The Home notification card (specs § 5.1–5.2): the latest notification that needs an answer, as a carbon-copied bill
 * with ✕ / ✓; otherwise the latest one, plain; otherwise "You’re all caught up". `notifications` is newest first.
 * An answer goes to the service first, so a refusal (server mode's `not_on_server`, offline) only shows a toast;
 * once it succeeds the toast and the refresh happen at once, and the copies peel (✓) or tear (✕) under a landing stamp;
 * the card keeps the answered bill until the peel is over, then the next card shows.
 */
export function HomeCard({ notifications }: { notifications: AppNotification[] }) {
  const { colors, type, space } = useTheme();
  const services = useServices();
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [leaving, setLeaving] = useState<{ n: AppNotification; yes: boolean } | null>(null);
  const refreshing = useRef<Promise<unknown>>(Promise.resolve());
  const n = leaving?.n ?? notifications.find((x) => x.needsAnswer) ?? notifications[0];
  const bill = { flex: 1, minHeight: STRIP.height } as const;

  if (!n) {
    return (
      <Sheet perf padded style={[bill, { justifyContent: 'center' }]}>
        <Text style={[type.body, { color: colors.ink2 }]}>You’re all caught up</Text>
      </Sheet>
    );
  }

  const sub = subOf(n);
  const body = (
    <Press onPress={openNotifications} scaleTo={1} accessibilityLabel={[n.message, sub].filter(Boolean).join(', ')} accessibilityHint="Opens Notifications">
      <Text style={[type.body, { color: colors.ink }]}>{n.message}</Text>
      {!!sub && <Text style={[type.label, { color: colors.ink2, marginTop: space.s1 }]}>{sub}</Text>}
    </Press>
  );
  // A card with no ref has nothing to answer (the item has lost its id): plain, without ✕ / ✓.
  if ((!n.needsAnswer || !n.refId) && !leaving) return <Sheet perf padded style={bill}>{body}</Sheet>;

  const pay = n.type === 'payment_to_confirm';
  const what = pay ? 'payment' : 'share';

  async function answer(yes: boolean) {
    if (busy || !n.refId) return;
    setBusy(true);
    try {
      if (pay) await (yes ? services.settlements.confirm(n.refId) : services.settlements.reject(n.refId));
      else await (yes ? services.expenses.acceptShare(n.refId) : services.expenses.rejectShare(n.refId));
    } catch (e) {
      answerFailed(e, n, services, queryClient);
      return setBusy(false);
    }
    // Now, not when the peel ends: Back or a tab switch mid-peel can unmount this before `gone` runs, and the toast and refresh would be lost.
    toast(
      pay
        ? yes ? 'Payment confirmed — balance updated' : 'Payment marked as not received'
        : yes ? 'Share accepted — balance updated' : 'Share rejected — the person who added it will be told',
    );
    refreshing.current = queryClient.invalidateQueries(); // an answer moves the badge, the balances and every list that shows them
    setLeaving({ n, yes });
  }

  async function gone() {
    await refreshing.current; // drop the answered bill only once the refreshed list is in, so it can't flash back
    setLeaving(null);
    setBusy(false);
  }

  return (
    <CarbonCopy
      key={n.id} // fresh copies for the next card
      kind={pay ? 'payment' : 'share'}
      leaving={leaving ? (leaving.yes ? 'peel' : 'tear') : null}
      onGone={gone}
      style={{ flex: 1 }}
    >
      <Sheet perf padded style={bill}>
        {body}
        <View style={{ marginTop: 'auto', paddingTop: space.s2 + 2, flexDirection: 'row', gap: space.s2, justifyContent: 'flex-end' }}>
          <IconButton variant="reject" icon="x" iconSize="sm" label={`Reject ${what}: ${n.message}`} onPress={() => answer(false)} disabled={busy} />
          <IconButton variant="accept" icon="check" iconSize="sm" label={`${pay ? 'Confirm' : 'Accept'} ${what}: ${n.message}`} onPress={() => answer(true)} disabled={busy} />
        </View>
        {leaving && (
          <Stamp
            land
            red={!leaving.yes}
            label={pay ? (leaving.yes ? 'Received' : 'Not received') : leaving.yes ? 'Agreed' : 'Rejected'}
            style={{ right: space.s3 + 2, top: space.s10 + 2 }}
          />
        )}
      </Sheet>
    </CarbonCopy>
  );
}

/** The card's loading shape: a bill with two text bars. */
export function HomeCardSkeleton() {
  const { space } = useTheme();
  return (
    <Sheet perf padded style={{ flex: 1, minHeight: STRIP.height, gap: space.s2 + 2 }}>
      <Skeleton width="80%" />
      <Skeleton width="60%" />
    </Sheet>
  );
}
