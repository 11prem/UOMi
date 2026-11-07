import { useRef, useState } from 'react';
import { Text, View } from 'react-native';
import { useQueryClient } from '@tanstack/react-query';
import type { AppNotification } from '../../domain/types';
import { useServices } from '../../services/useServices';
import { useTheme } from '../../theme/ThemeProvider';
import { CarbonCopy } from '../../ui/CarbonCopy';
import { IconButton } from '../../ui/IconButton';
import { Press } from '../../ui/Press';
import { Sheet } from '../../ui/Sheet';
import { Stamp } from '../../ui/Stamp';
import { toast } from '../../ui/Toast';
import { answerFailed, subOf } from './model';

/**
 * A notification that needs an answer (app.js `pendingCard`), as on Home: a carbon-copied bill with ✕ / ✓. Tapping the
 * text opens its target (`onOpen`). An answer goes to the service first, so a refusal (`not_on_server`, offline) only
 * shows a toast and the buttons come back; once it succeeds the toast and the refresh happen at once, and the copies peel
 * (✓) or tear (✕) under a landing stamp. The refreshed list no longer asks for this card, so the page keeps it (`onLeaving`)
 * until the peel is over. (Home's own card is separate: it can't take a different tap.)
 */
export function NeedsAnswerCard({ n, onOpen, onLeaving }: { n: AppNotification; onOpen: (n: AppNotification) => void; onLeaving: (leaving: boolean) => void }) {
  const { colors, type, space } = useTheme();
  const services = useServices();
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [leaving, setLeaving] = useState<boolean | null>(null); // the answer (true = ✓) while the copies go
  const refreshing = useRef<Promise<unknown>>(Promise.resolve());

  const pay = n.type === 'payment_to_confirm';
  const what = pay ? 'payment' : 'share';
  const sub = subOf(n);

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
    // Now, not when the peel ends: a refetch or Back mid-peel can unmount this before `gone` runs, and the toast and refresh would be lost.
    toast(
      pay
        ? yes ? 'Payment confirmed — balance updated' : 'Payment marked as not received'
        : yes ? 'Share accepted — balance updated' : 'Share rejected — the person who added it will be told',
    );
    refreshing.current = queryClient.invalidateQueries(); // an answer moves the badge, the balances and every list that shows them
    onLeaving(true);
    setLeaving(yes);
  }

  async function gone() {
    await refreshing.current; // let the page drop the bill only once the refreshed list is in, so the old one can't flash back
    setLeaving(null);
    setBusy(false);
    onLeaving(false);
  }

  return (
    <CarbonCopy kind={pay ? 'payment' : 'share'} leaving={leaving === null ? null : leaving ? 'peel' : 'tear'} onGone={gone}>
      <Sheet perf padded>
        <Press onPress={() => onOpen(n)} scaleTo={1} accessibilityLabel={[n.message, sub].filter(Boolean).join(', ')}>
          <Text style={[type.body, { color: colors.ink }]}>{n.message}</Text>
          {!!sub && <Text style={[type.label, { color: colors.ink2, marginTop: space.s1 }]}>{sub}</Text>}
        </Press>
        {/* Without a ref there is nothing to answer (the item has lost its id): no ✕ / ✓. */}
        {!!n.refId && (
          <View style={{ paddingTop: space.s2 + 2, flexDirection: 'row', gap: space.s2, justifyContent: 'flex-end' }}>
            <IconButton variant="reject" icon="x" iconSize="sm" label={`Reject ${what}: ${n.message}`} onPress={() => void answer(false)} disabled={busy} />
            <IconButton variant="accept" icon="check" iconSize="sm" label={`${pay ? 'Confirm' : 'Accept'} ${what}: ${n.message}`} onPress={() => void answer(true)} disabled={busy} />
          </View>
        )}
        {leaving !== null && (
          <Stamp
            land
            red={!leaving}
            label={pay ? (leaving ? 'Received' : 'Not received') : leaving ? 'Agreed' : 'Rejected'}
            style={{ right: space.s3 + 2, top: space.s10 + 2 }}
          />
        )}
      </Sheet>
    </CarbonCopy>
  );
}
