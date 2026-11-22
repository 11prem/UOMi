import { Text, View } from 'react-native';
import { router } from 'expo-router';
import { relDate, monthKey } from '../../domain/dates';
import { formatMoney } from '../../domain/money';
import type { ActivityRow, Currency } from '../../domain/types';
import { useTheme } from '../../theme/ThemeProvider';
import { size } from '../../ui/metrics';
import { Press } from '../../ui/Press';
import { Rows } from '../../ui/Rows';
import { SpaceIcon } from '../../ui/SpaceIcon';
import { firstName, myPartText } from './format';
import { Tag, type TagTone } from './Tag';

/** The Space Page activity (specs § 7; app.js `activityRows`): newest first as given, one ruled sheet per month. */
export function ActivityList({ rows, currency, meId }: { rows: ActivityRow[]; currency: Currency; meId: string }) {
  const { colors, type, space } = useTheme();
  const months: { key: string; rows: ActivityRow[] }[] = [];
  for (const r of rows) {
    const key = monthKey(r.date);
    const last = months[months.length - 1];
    if (last?.key === key) last.rows.push(r);
    else months.push({ key, rows: [r] });
  }
  return months.map((m) => (
    <View key={m.key}>
      <Text style={[type.serial, { color: colors.ink2, paddingTop: space.s4, paddingBottom: space.s2 }]} accessibilityRole="header">
        {m.key}
      </Text>
      <Rows>
        {m.rows.map((r) => (
          <ActivityItem key={`${r.kind}-${r.id}`} row={r} currency={currency} meId={meId} />
        ))}
      </Rows>
    </View>
  ));
}

function ActivityItem({ row: r, currency, meId }: { row: ActivityRow; currency: Currency; meId: string }) {
  const { colors, type, space } = useTheme();
  const money = (minor: number) => formatMoney(minor, currency, { compact: true });
  const tags: { label: string; tone: TagTone }[] = [];
  let title: string, sub: string, right: string, rightColor: string;

  if (r.kind === 'expense') {
    const part = myPartText(r, currency, meId);
    title = r.description;
    sub = `Paid by ${r.paidById === meId ? 'you' : firstName(r.paidByName)} · ${money(r.amountMinor)} · ${relDate(r.date)}`;
    if (r.myResponse === 'pending') tags.push({ label: 'Needs your answer', tone: 'pending' });
    if (r.disputed) tags.push({ label: 'Disputed', tone: 'disputed' });
    right = part.text;
    rightColor = { owe: colors.owe, owed: colors.owed, muted: colors.ink2 }[part.tone];
  } else {
    title = `${r.fromId === meId ? 'You' : firstName(r.fromName)} paid ${r.toId === meId ? 'you' : firstName(r.toName)}`;
    sub = relDate(r.date);
    if (r.status === 'pending') tags.push({ label: 'Pending', tone: 'pending' });
    if (r.status === 'rejected') tags.push({ label: 'Rejected', tone: 'disputed' });
    if (r.status === 'cancelled') tags.push({ label: 'Cancelled', tone: 'muted' });
    right = money(r.amountMinor);
    rightColor = colors.ink;
  }

  return (
    <Press
      onPress={() => router.push(r.kind === 'expense' ? `/expense/${r.id}` : `/payment/${r.id}`)}
      accessibilityLabel={[title, sub, ...tags.map((t) => t.label), right].join(', ')}
      scaleTo={1}
      style={{ flexDirection: 'row', alignItems: 'center', gap: space.s3, minHeight: size.row, padding: space.s3 }}
      pressedStyle={{ backgroundColor: colors.carbonWash }}
    >
      {r.kind === 'expense' ? <SpaceIcon name="receipt" muted /> : <SpaceIcon name="swap" />}
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={[type.body, { color: colors.ink }]} numberOfLines={1}>
          {title}
        </Text>
        <Text style={[type.label, { color: colors.ink2, marginTop: space.s1 / 2 }]}>{sub}</Text>
        {tags.length > 0 && (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.s1, marginTop: space.s2 - 2 }}>
            {tags.map((t) => (
              <Tag key={t.label} {...t} />
            ))}
          </View>
        )}
      </View>
      <Text style={[type.label, { color: rightColor, textAlign: 'right', flexShrink: 0, maxWidth: '40%' }]}>{right}</Text>
    </Press>
  );
}
