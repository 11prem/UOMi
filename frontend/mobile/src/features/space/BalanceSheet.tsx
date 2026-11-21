import { useState } from 'react';
import { Text, View } from 'react-native';
import { CURRENCY_INFO } from '../../domain/money';
import { balanceText } from '../../domain/phrases';
import type { Space, SpaceBalance, User } from '../../domain/types';
import { useTheme } from '../../theme/ThemeProvider';
import { Button } from '../../ui/Button';
import { MemberPlate } from '../../ui/MemberPlate';
import { size } from '../../ui/metrics';
import { Sheet } from '../../ui/Sheet';
import { Stamp } from '../../ui/Stamp';
import { pairLine, serial } from './format';

/**
 * The Space Page balance (specs § 7): the viewer's net here, then who they owe / who owes them, largest first, collapsed to 3
 * with "See all". Pairs may leave out zero pairs (server mode), so only non-zero ones are listed. Settle up shows only
 * while the viewer owes someone.
 */
export function BalanceSheet({ space: s, members, balance, onSettle }: { space: Space; members: User[]; balance: SpaceBalance; onSettle: () => void }) {
  const { colors, type, space } = useTheme();
  const [all, setAll] = useState(false);
  const open = balance.pairs.filter((p) => p.netMinor !== 0).sort((a, b) => Math.abs(b.netMinor) - Math.abs(a.netMinor));
  const ph = balanceText(balance, false);
  const headline = balance.settled ? 'Settled up' : balance.netMinor === 0 ? 'Balanced, with open debts' : ph.text;

  return (
    <Sheet style={{ padding: space.s4, marginTop: space.s1, overflow: 'visible' /* the stamp may overhang */ }}>
      <Text style={[type.serial, { color: colors.ink2 }]}>
        {serial(s.serial)} · {CURRENCY_INFO[s.currency].symbol} {s.currency}
      </Text>
      <Text style={[type.figure, { marginTop: space.s2 - 2, color: ph.tone === 'owe' ? colors.owe : ph.tone === 'owed' ? colors.owed : colors.ink }]}>{headline}</Text>
      {balance.settled && <Stamp label="Settled" style={{ right: space.s4, top: space.s5 }} />}

      {open.length > 0 && (
        <View style={{ marginTop: space.s2 + 2, borderTopWidth: size.hairline, borderTopColor: colors.hair }}>
          {(all ? open : open.slice(0, 3)).map((p) => {
            const line = pairLine(p.name, p.netMinor, s.currency);
            const who = members.find((u) => u.id === p.userId);
            return (
              <View
                key={p.userId}
                accessible
                accessibilityLabel={`${line.text} ${line.amount}`}
                style={{ flexDirection: 'row', alignItems: 'center', gap: space.s2 + 2, paddingVertical: space.s2 + 2, borderBottomWidth: size.hairline, borderBottomColor: colors.hair }}
              >
                {who && <MemberPlate user={who} />}
                <Text style={[type.body, { flex: 1, color: colors.ink }]}>{line.text}</Text>
                <Text style={[type.body, { fontFamily: type.label.fontFamily, color: line.tone === 'owe' ? colors.owe : colors.owed }]}>{line.amount}</Text>
              </View>
            );
          })}
          {open.length > 3 && !all && <Button variant="text" label={`See all ${open.length}`} onPress={() => setAll(true)} />}
        </View>
      )}

      {open.some((p) => p.netMinor < 0) && <Button variant="secondary" icon="swap" label="Settle up" onPress={onSettle} style={{ marginTop: space.s3 + 2 }} />}
    </Sheet>
  );
}
