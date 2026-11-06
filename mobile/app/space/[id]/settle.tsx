import { useState } from 'react';
import { Text, View } from 'react-native';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { AmountField } from '../../../src/features/expense/AmountField';
import { hundredths, minorToText } from '../../../src/features/expense/amountText';
import { errorText, refreshMoney } from '../../../src/features/expense/refresh';
import { PayeeList } from '../../../src/features/settle/PayeeList';
import { SectionHeading } from '../../../src/features/space/SectionHeading';
import { firstName } from '../../../src/features/space/format';
import { formatMoney, parseAmountInput } from '../../../src/domain/money';
import { AppError } from '../../../src/services/errors';
import { qk } from '../../../src/services/queries';
import { useServices } from '../../../src/services/useServices';
import { useTheme } from '../../../src/theme/ThemeProvider';
import { AppBar } from '../../../src/ui/AppBar';
import { Fab } from '../../../src/ui/Fab';
import { NotOnServer, isNotOnServer } from '../../../src/ui/NotOnServer';
import { OfflineBanner } from '../../../src/ui/OfflineBanner';
import { Screen } from '../../../src/ui/Screen';
import { Sheet } from '../../../src/ui/Sheet';
import { Skeleton } from '../../../src/ui/Skeleton';
import { StateBox } from '../../../src/ui/StateBox';
import { toast } from '../../../src/ui/Toast';
import { useDiscardGuard } from '../../../src/ui/useDiscardGuard';

/**
 * Settle Up (specs § 9; app.js `R.settle`): record a payment made outside the app to someone the viewer owes. The only
 * person owed (or `?to=`) is picked for you, and the amount starts at the most you can record — what you owe them minus
 * payments still waiting for their answer. It can be lowered, never raised past that.
 */
export default function SettleUp() {
  const { id, to } = useLocalSearchParams<{ id: string; to?: string }>();
  const { colors, type, space } = useTheme();
  const services = useServices();
  const queryClient = useQueryClient();
  const server = services.mode === 'server';
  const spaceQ = useQuery({ queryKey: qk.space(id), queryFn: () => services.spaces.get(id), enabled: !server });
  const payeesQ = useQuery({ queryKey: qk.payees(id), queryFn: () => services.settlements.payees(id), enabled: !server });
  const [picked, setPicked] = useState<string | null>(null);
  const [text, setText] = useState<string | null>(null); // null: still the pre-filled maximum
  const [saving, setSaving] = useState(false);

  const payees = payeesQ.data ?? [];
  const preset = payees.find((p) => p.user.id === to)?.user.id ?? (payees.length === 1 ? payees[0].user.id : null);
  const payee = payees.find((p) => p.user.id === (picked ?? preset));
  const max = payee?.maxMinor ?? 0;
  const full = minorToText(max, true);
  const amountText = text ?? (payee ? full : '');
  const value = parseAmountInput(amountText);
  const typed = hundredths(amountText);
  let error: string | undefined;
  if (payee && typed !== null && typed > max) error = `That’s more than you owe ${firstName(payee.user.name)}`;
  else if (payee && value === null) error = 'Enter an amount above 0';
  const leave = useDiscardGuard((picked !== null && picked !== preset) || (text !== null && text !== full));

  const pick = (userId: string) => {
    setPicked(userId);
    setText(null); // the new person's maximum
  };

  async function record() {
    if (!payee || value === null || value > max || saving) return;
    setSaving(true);
    let paymentId: string;
    try {
      paymentId = (await services.settlements.create({ spaceId: id, toUserId: payee.user.id, amountMinor: value })).id;
    } catch (e) {
      setSaving(false);
      return toast(errorText(e));
    }
    void refreshMoney(queryClient);
    leave(() => router.replace(`/payment/${paymentId}?fresh=1`)); // Back from the payment is the Space Page
    toast('Payment recorded');
  }

  const d = spaceQ.data;
  const failed = spaceQ.error ?? payeesQ.error;
  let body;
  if (server || isNotOnServer(failed)) body = <NotOnServer />;
  else if (d && payeesQ.data) {
    const owesSomeone = d.balance.pairs.some((p) => p.netMinor < 0);
    body = (
      <>
        <Text style={[type.label, { fontFamily: type.body.fontFamily, color: colors.ink2, marginTop: space.s1 }]}>
          Record a payment you made outside UOMi — cash, UPI or bank. It counts once they confirm they received it.
        </Text>
        <SectionHeading>Pay to</SectionHeading>
        {payees.length ? (
          <PayeeList payees={payees} currency={d.space.currency} selected={payee?.user.id ?? null} onSelect={pick} />
        ) : (
          <Sheet>
            <StateBox
              kind="empty"
              title="Nothing to settle"
              body={owesSomeone ? 'Payments you’ve recorded are waiting to be confirmed.' : 'You don’t owe anyone in this space.'}
            />
          </Sheet>
        )}
        {payee && (
          <View style={{ marginTop: space.s6 }}>
            <AmountField
              label="Amount"
              currency={d.space.currency}
              value={amountText}
              onChangeText={setText}
              helper={`Up to ${formatMoney(max, d.space.currency)}. Lower it for a part payment.`}
              error={error}
            />
          </View>
        )}
      </>
    );
  } else if (failed instanceof AppError && failed.code === 'not_found') body = <StateBox kind="empty" title="This space no longer exists" />;
  else if (failed) {
    body = (
      <StateBox
        kind="error"
        onRetry={() => {
          if (spaceQ.isError) spaceQ.refetch();
          if (payeesQ.isError) payeesQ.refetch();
        }}
      />
    );
  } else {
    body = (
      <View style={{ gap: space.s3, marginTop: space.s1 }}>
        <Skeleton width="90%" />
        <Skeleton width="60%" />
        <View style={{ marginTop: space.s6 }}>
          <Skeleton rows={2} />
        </View>
      </View>
    );
  }

  return (
    <Screen
      header={
        <>
          <AppBar title="Settle up" backTo={d?.space.name} />
          <OfflineBanner />
        </>
      }
      fab={payee && !server && <Fab icon="check" label="Record payment" onPress={record} disabled={!!error || saving} />}
    >
      {body}
    </Screen>
  );
}
