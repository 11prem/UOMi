import { useRef, useState } from 'react';
import { Text, View } from 'react-native';
import { useQueryClient } from '@tanstack/react-query';
import { fullDate } from '../../domain/dates';
import type { Settlement, Space, User } from '../../domain/types';
import { qk } from '../../services/queries';
import { useServices } from '../../services/useServices';
import { useTheme } from '../../theme/ThemeProvider';
import { Button } from '../../ui/Button';
import { CarbonCopy } from '../../ui/CarbonCopy';
import { useConfirm } from '../../ui/ConfirmDialog';
import { size } from '../../ui/metrics';
import { Sheet } from '../../ui/Sheet';
import { Stamp } from '../../ui/Stamp';
import { toast } from '../../ui/Toast';
import { AnswerRow, Bill } from '../expense/Bill';
import { errorText, refreshMoney } from '../expense/refresh';
import { firstName } from '../space/format';

export type PaymentData = { settlement: Settlement; space: Space; from: User; to: User };

const STAMP = { pending: 'Pending', confirmed: 'Received', rejected: 'Not received', cancelled: 'Cancelled' } as const;
const ANSWERED = { confirmed: 'Confirmed', rejected: 'Rejected', cancelled: 'Cancelled' } as const;

/**
 * Settlement Detail below the app bar (specs § 9.1; app.js `R.pay`): the payment as a bill with its status stamp — one
 * yellow copy beneath while it waits — then From / To / Space. The receiver answers a pending payment here (Not received /
 * Confirm); the payer can cancel it while it is pending, after a confirm. `fresh` lands the stamp (just recorded).
 */
export function PaymentDetailBody({ data: { settlement: x, space: s, from, to }, meId, fresh }: { data: PaymentData; meId: string; fresh?: boolean }) {
  const { colors, type, space } = useTheme();
  const services = useServices();
  const queryClient = useQueryClient();
  const confirm = useConfirm();
  const [busy, setBusy] = useState(false);
  const [leaving, setLeaving] = useState<'peel' | 'tear' | null>(null);
  const refreshing = useRef<Promise<unknown>>(Promise.resolve());
  const pending = x.status === 'pending';
  const receiver = x.toUserId === meId;
  const payer = x.fromUserId === meId;
  const who = (u: User) => (u.id === meId ? 'You' : firstName(u.name));

  async function answer(yes: boolean) {
    if (busy) return;
    setBusy(true);
    try {
      await (yes ? services.settlements.confirm(x.id) : services.settlements.reject(x.id));
    } catch (e) {
      toast(errorText(e));
      return setBusy(false);
    }
    // Refresh and confirm now, not when the peel ends: Back mid-animation unmounts this before onGone runs.
    refreshing.current = refreshMoney(queryClient, qk.settlement(x.id));
    toast(yes ? 'Payment confirmed — balance updated' : 'Payment marked as not received');
    setLeaving(yes ? 'peel' : 'tear');
  }

  async function gone() {
    await refreshing.current; // drop the copy only once the answered payment is back, so the old one can't flash
    setLeaving(null);
    setBusy(false);
  }

  async function cancel() {
    if (busy) return;
    const ok = await confirm({
      title: 'Cancel this payment?',
      body: `It will be removed and ${firstName(to.name)} won’t be asked to confirm it.`,
      ok: 'Cancel payment',
      cancel: 'Keep it',
      danger: true,
    });
    if (!ok) return;
    setBusy(true);
    try {
      await services.settlements.cancel(x.id);
      toast('Payment cancelled');
      await refreshMoney(queryClient, qk.settlement(x.id));
    } catch (e) {
      toast(errorText(e));
    }
    setBusy(false);
  }

  const note = x.status === 'pending'
    ? `Waiting for ${receiver ? 'you' : firstName(to.name)} to confirm`
    : `${ANSWERED[x.status]} on ${fullDate(x.answeredAt ?? x.date)}`;
  const stampAt = { right: space.s4, top: space.s10 + space.s3 };
  const bill = (
    <Bill spaceSerial={s.serial} date={x.date} title={`${who(from)} paid ${who(to) === 'You' ? 'you' : who(to)}`} amountMinor={x.amountMinor} currency={s.currency} note={note}>
      {leaving ? (
        <Stamp land red={leaving === 'tear'} label={leaving === 'peel' ? 'Received' : 'Not received'} style={stampAt} />
      ) : (
        <Stamp land={fresh} red={x.status === 'rejected' || x.status === 'cancelled'} label={STAMP[x.status]} style={stampAt} />
      )}
      {receiver && pending && (
        <AnswerRow>
          <Button variant="danger" label="Not received" onPress={() => answer(false)} disabled={busy} style={{ flex: 1 }} />
          <Button icon="check" label="Confirm" onPress={() => answer(true)} disabled={busy} style={{ flex: 1 }} />
        </AnswerRow>
      )}
    </Bill>
  );

  const kv = (k: string, v: string) => (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: space.s3, padding: space.s3 }}>
      <Text style={[type.body, { color: colors.ink2 }]}>{k}</Text>
      <Text style={[type.body, { color: colors.ink, flexShrink: 1, textAlign: 'right' }]}>{v}</Text>
    </View>
  );

  return (
    <>
      {pending || leaving ? (
        <CarbonCopy kind="payment" leaving={leaving} onGone={gone} style={{ marginTop: space.s1, marginRight: space.s3 }}>
          {bill}
        </CarbonCopy>
      ) : (
        <View style={{ marginTop: space.s1, marginRight: space.s3 }}>{bill}</View>
      )}
      <Sheet style={{ marginTop: space.s6 }}>
        {[kv('From', from.name), kv('To', to.name), kv('Space', s.name)].map((row, i) => (
          <View key={i} style={i > 0 && { borderTopWidth: size.hairline, borderTopColor: colors.hair }}>
            {row}
          </View>
        ))}
      </Sheet>
      {payer && pending && !leaving && (
        <Button variant="danger" label="Cancel payment" onPress={() => void cancel()} busy={busy} style={{ marginTop: space.s6 }} />
      )}
    </>
  );
}
