import { Text, View } from 'react-native';
import { router } from 'expo-router';
import { relDate } from '../../domain/dates';
import { formatMoney } from '../../domain/money';
import type { Services } from '../../services/types';
import { useTheme } from '../../theme/ThemeProvider';
import { size } from '../../ui/metrics';
import { Press } from '../../ui/Press';
import { SpaceIcon } from '../../ui/SpaceIcon';
import { firstName, myPartText } from '../space/format';
import { Tag, type TagTone } from '../space/Tag';

export type Transaction = Awaited<ReturnType<Services['transactions']['list']>>[number];

/**
 * One row of the Transactions list (specs § 12; app.js `R.trans`): the item, its space and date, and what it does to
 * the viewer, in the space's own currency ("you owe ₹480", "you lent $35", "you paid ₹600", "you received ₹2,000").
 * Tags: Pending, Disputed (and a payment's Rejected / Cancelled). Opens the expense or the payment.
 */
export function TransactionRow({ tx: t, meId }: { tx: Transaction; meId: string }) {
  const { colors, type, space } = useTheme();
  const money = (minor: number) => formatMoney(minor, t.currency, { compact: true });
  const tags: { label: string; tone: TagTone }[] = [];
  let title: string;
  let effect: string;
  let ink: string;

  if (t.kind === 'expense') {
    const part = myPartText(t, t.currency, meId);
    title = t.description;
    effect = part.text;
    ink = { owe: colors.owe, owed: colors.owed, muted: colors.ink2 }[part.tone];
    if (t.disputed) tags.push({ label: 'Disputed', tone: 'disputed' });
    if (t.myResponse === 'pending') tags.push({ label: 'Pending', tone: 'pending' }); // the viewer's own share is waiting for them
  } else {
    const paid = t.fromId === meId;
    title = `${paid ? 'You' : firstName(t.fromName)} paid ${t.toId === meId ? 'you' : firstName(t.toName)}`;
    effect = `${paid ? 'you paid' : 'you received'} ${money(t.amountMinor)}`;
    ink = paid ? colors.ink : colors.owed;
    if (t.status === 'pending') tags.push({ label: 'Pending', tone: 'pending' });
    if (t.status === 'rejected') tags.push({ label: 'Rejected', tone: 'disputed' });
    if (t.status === 'cancelled') tags.push({ label: 'Cancelled', tone: 'muted' });
  }
  const sub = `${t.spaceName} · ${relDate(t.date)}`;

  return (
    <Press
      onPress={() => router.push(t.kind === 'expense' ? `/expense/${t.id}` : `/payment/${t.id}`)}
      accessibilityLabel={[title, sub, ...tags.map((x) => x.label), effect].join(', ')}
      scaleTo={1}
      style={{ flexDirection: 'row', alignItems: 'center', gap: space.s3, minHeight: size.row, padding: space.s3 }}
      pressedStyle={{ backgroundColor: colors.carbonWash }}
    >
      {t.kind === 'expense' ? <SpaceIcon name="receipt" muted /> : <SpaceIcon name="swap" />}
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={[type.body, { color: colors.ink }]} numberOfLines={1}>
          {title}
        </Text>
        <Text style={[type.label, { color: colors.ink2, marginTop: space.s1 / 2 }]}>{sub}</Text>
        {tags.length > 0 && (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.s1, marginTop: space.s2 - 2 }}>
            {tags.map((x) => (
              <Tag key={x.label} {...x} />
            ))}
          </View>
        )}
      </View>
      <Text style={[type.label, { color: ink, textAlign: 'right', flexShrink: 0, maxWidth: '40%' }]}>{effect}</Text>
    </Press>
  );
}
