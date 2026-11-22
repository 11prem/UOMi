import { Children, type ReactNode } from 'react';
import { Text, View } from 'react-native';
import type { Tone } from '../domain/phrases';
import { useTheme } from '../theme/ThemeProvider';
import { Icon } from './Icon';
import { size } from './metrics';
import { Press } from './Press';
import { Sheet } from './Sheet';

/** A list as one sheet of ruled rows, divided by hairlines (DESIGN.md § Ledger Rows). */
export function Rows({ children, nested }: { children: ReactNode; nested?: boolean }) {
  const { colors } = useTheme();
  return (
    <Sheet nested={nested}>
      {Children.toArray(children).map((row, i) => (
        <View key={i} style={i > 0 && { borderTopWidth: size.hairline, borderTopColor: colors.hair }}>
          {row}
        </View>
      ))}
    </Sheet>
  );
}

export type LedgerRowProps = {
  /** A `SpaceIcon` or `MemberPlate`. */
  left?: ReactNode;
  title: string;
  sub?: string;
  /** Right-aligned amount (owe / owed / muted tone; colour is never the only signal, so the words carry it too). */
  amount?: string;
  amountSub?: string;
  tone?: Tone | 'ink';
  /** Anything else on the right (a tag, a switch). */
  right?: ReactNode;
  chevron?: boolean;
  onPress?: () => void;
  /** Defaults to the visible text joined, for a pressable row. */
  accessibilityLabel?: string;
};

/** A ruled row: min 68 px, 12 px padding, pressed tint carbon-wash. */
export function LedgerRow({ left, title, sub, amount, amountSub, tone = 'ink', right, chevron, onPress, accessibilityLabel }: LedgerRowProps) {
  const { colors, type, space } = useTheme();
  const amountColor = { owe: colors.owe, owed: colors.owed, muted: colors.ink2, ink: colors.ink }[tone];
  const body = (
    <>
      {left}
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={[type.body, { color: colors.ink }]} numberOfLines={1}>
          {title}
        </Text>
        {!!sub && <Text style={[type.label, { color: colors.ink2, marginTop: 2 }]}>{sub}</Text>}
      </View>
      {(amount || amountSub) && (
        <View style={{ alignItems: 'flex-end', flexShrink: 0, maxWidth: '58%' }}>
          {!!amount && <Text style={[type.body, { fontFamily: type.label.fontFamily, color: amountColor, textAlign: 'right' }]}>{amount}</Text>}
          {!!amountSub && <Text style={[type.label, { color: colors.ink2, marginTop: 2, textAlign: 'right' }]}>{amountSub}</Text>}
        </View>
      )}
      {right}
      {chevron && <Icon name="chev" size="sm" color={colors.ink2} />}
    </>
  );
  const style = { flexDirection: 'row', alignItems: 'center', gap: space.s3, minHeight: size.row, padding: space.s3 } as const;
  if (!onPress) return <View style={style}>{body}</View>;
  return (
    <Press
      onPress={onPress}
      scaleTo={1}
      accessibilityLabel={accessibilityLabel ?? [title, sub, amount, amountSub].filter(Boolean).join(', ')}
      style={style}
      pressedStyle={{ backgroundColor: colors.carbonWash }}
    >
      {body}
    </Press>
  );
}
