import { useRef, useState, type ReactNode } from 'react';
import { Text, View } from 'react-native';
import { useQueryClient } from '@tanstack/react-query';
import { formatMoney } from '../../domain/money';
import type { Expense, Share, Space, User } from '../../domain/types';
import { qk } from '../../services/queries';
import { useServices } from '../../services/useServices';
import { useTheme } from '../../theme/ThemeProvider';
import { Button } from '../../ui/Button';
import { CarbonCopy } from '../../ui/CarbonCopy';
import { MemberPlate } from '../../ui/MemberPlate';
import { LedgerRow, Rows } from '../../ui/Rows';
import { Stamp } from '../../ui/Stamp';
import { toast } from '../../ui/Toast';
import { SectionHeading } from '../space/SectionHeading';
import { firstName } from '../space/format';
import { AnswerRow, Bill, Notice } from './Bill';
import { errorText, refreshMoney } from './refresh';

const TYPE_NAME = { equal: 'Split equally', exact: 'Exact amounts', percent: 'By percent', shares: 'By shares' } as const;

export type ExpenseData = { expense: Expense; space: Space; members: User[] };

/**
 * Expense Detail below the app bar (specs § 8.3; app.js `R.exp`): the bill — carbon-copied while the viewer's share
 * waits for their answer, with Reject / Accept — then who paid, then one row per share with its answer; the viewer's
 * own row is tinted. The answer goes to the service first, so a refusal only toasts; then the copies peel or tear
 * under a landing stamp and the queries refresh.
 */
export function ExpenseDetailBody({ data: { expense: e, space: s, members }, meId }: { data: ExpenseData; meId: string }) {
  const { colors, type, space } = useTheme();
  const services = useServices();
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [leaving, setLeaving] = useState<'peel' | 'tear' | null>(null);
  const refreshing = useRef<Promise<unknown>>(Promise.resolve());
  // app.js `youOr`: "You", or the person's first name.
  const nameOf = (id: string) => (id === meId ? 'You' : firstName(members.find((u) => u.id === id)?.name ?? 'Someone'));
  const mine = e.shares.find((x) => x.userId === meId);
  const pending = mine?.response === 'pending';
  const disputed = e.shares.some((x) => x.response === 'rejected');
  const agreed = !disputed && e.shares.every((x) => x.response === 'accepted');
  const creator = e.createdBy === meId;

  async function answer(yes: boolean) {
    if (busy) return;
    setBusy(true);
    try {
      await (yes ? services.expenses.acceptShare(e.id) : services.expenses.rejectShare(e.id));
    } catch (err) {
      toast(errorText(err));
      return setBusy(false);
    }
    // Refresh and confirm now, not when the peel ends: Back mid-animation unmounts this before onGone runs.
    refreshing.current = refreshMoney(queryClient, qk.expense(e.id));
    toast(yes ? 'Share accepted — balance updated' : `Share rejected — ${nameOf(e.createdBy)} will be told`);
    setLeaving(yes ? 'peel' : 'tear');
  }

  async function gone() {
    await refreshing.current; // drop the copies only once the answered expense is back, so the old one can't flash
    setLeaving(null);
    setBusy(false);
  }

  const bill = (
    <Bill
      spaceSerial={s.serial}
      date={e.date}
      title={e.description}
      amountMinor={e.amountMinor}
      currency={s.currency}
      note={`Added by ${creator ? 'you' : nameOf(e.createdBy)} · ${TYPE_NAME[e.splitType]}`}
    >
      {leaving ? (
        <Stamp land red={leaving === 'tear'} label={leaving === 'peel' ? 'Agreed' : 'Rejected'} style={{ right: space.s4, top: space.s10 + space.s3 }} />
      ) : (
        agreed && <Stamp label="Agreed" style={{ right: space.s4, top: space.s10 + space.s3 }} />
      )}
      {pending && (
        <AnswerRow>
          <Button variant="danger" icon="x" label="Reject" onPress={() => answer(false)} disabled={busy} style={{ flex: 1 }} />
          <Button icon="check" label="Accept" onPress={() => answer(true)} disabled={busy} style={{ flex: 1 }} />
        </AnswerRow>
      )}
    </Bill>
  );

  return (
    <>
      {disputed && (
        <Notice text={`Someone rejected their share. This doesn’t count until ${creator ? 'you edit or delete' : `${nameOf(e.createdBy)} edits or deletes`} it.`} />
      )}
      {pending || leaving ? (
        <CarbonCopy kind="share" leaving={leaving} onGone={gone} style={{ marginTop: space.s1, marginRight: space.s3, marginBottom: space.s3 }}>
          {bill}
        </CarbonCopy>
      ) : (
        <View style={{ marginTop: space.s1, marginRight: space.s3 }}>{bill}</View>
      )}

      <SectionHeading>Paid by</SectionHeading>
      <Rows>
        <PersonRow user={members.find((u) => u.id === e.paidBy)} name={nameOf(e.paidBy)} amount={formatMoney(e.amountMinor, s.currency)} />
      </Rows>

      <SectionHeading>Split</SectionHeading>
      <Rows>
        {e.shares.map((x) => (
          <View key={x.userId} style={x.userId === meId && { backgroundColor: colors.carbonWash }}>
            <PersonRow
              user={members.find((u) => u.id === x.userId)}
              name={nameOf(x.userId)}
              sub={shareSub(e, x)}
              amount={formatMoney(x.amountMinor, s.currency)}
              answer={x.userId === e.paidBy ? <Text style={[type.label, { color: colors.ink2 }]}>Paid</Text> : <AnswerText response={x.response} />}
            />
          </View>
        ))}
      </Rows>
    </>
  );
}

/** "50%" or "2 shares" under a name; nothing for equal and exact splits. */
function shareSub(e: Expense, x: Share): string | undefined {
  if (x.input === null) return undefined;
  if (e.splitType === 'percent') return `${x.input}%`;
  if (e.splitType === 'shares') return `${x.input} share${x.input === 1 ? '' : 's'}`;
  return undefined;
}

function AnswerText({ response }: { response: Share['response'] }) {
  const { colors, type } = useTheme();
  const [label, color] = { accepted: ['Accepted', colors.owed], pending: ['Pending', colors.pending], rejected: ['Rejected', colors.owe] }[response];
  return <Text style={[type.label, { color }]}>{label}</Text>;
}

function PersonRow({ user, name, sub, amount, answer }: { user?: User; name: string; sub?: string; amount: string; answer?: ReactNode }) {
  const { colors, type } = useTheme();
  return (
    <LedgerRow
      left={user && <MemberPlate user={user} />}
      title={name}
      sub={sub}
      right={
        <View style={{ alignItems: 'flex-end', flexShrink: 0, maxWidth: '58%' }}>
          <Text style={[type.body, { fontFamily: type.label.fontFamily, color: colors.ink, textAlign: 'right' }]}>{amount}</Text>
          {answer}
        </View>
      }
    />
  );
}
