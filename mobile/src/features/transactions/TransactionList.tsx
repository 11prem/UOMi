import { Text, View } from 'react-native';
import { monthKey } from '../../domain/dates';
import { useTheme } from '../../theme/ThemeProvider';
import { Rows } from '../../ui/Rows';
import { TransactionRow, type Transaction } from './TransactionRow';

/** The rows grouped by month, newest first as given: a small-caps month heading over one ruled sheet per month (app.js `R.trans`). No totals: rows may be in different currencies. */
export function TransactionList({ rows, meId }: { rows: Transaction[]; meId: string }) {
  const { colors, type, space } = useTheme();
  const months: { key: string; rows: Transaction[] }[] = [];
  for (const r of rows) {
    const key = monthKey(r.date);
    const last = months[months.length - 1];
    if (last?.key === key) last.rows.push(r);
    else months.push({ key, rows: [r] });
  }
  return months.map((m) => (
    <View key={m.key}>
      <Text accessibilityRole="header" style={[type.serial, { color: colors.ink2, paddingTop: space.s4, paddingBottom: space.s2 }]}>
        {m.key}
      </Text>
      <Rows>
        {m.rows.map((r) => (
          <TransactionRow key={`${r.kind}-${r.id}`} tx={r} meId={meId} />
        ))}
      </Rows>
    </View>
  ));
}
