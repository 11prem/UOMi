import type { ReactNode } from 'react';
import { Text, View } from 'react-native';
import { fullDate } from '../../domain/dates';
import { formatMoney } from '../../domain/money';
import type { Currency } from '../../domain/types';
import { useTheme } from '../../theme/ThemeProvider';
import { Icon } from '../../ui/Icon';
import { Sheet } from '../../ui/Sheet';
import { Skeleton } from '../../ui/Skeleton';
import { serial } from '../space/format';

export type BillProps = {
  spaceSerial: number;
  date: number;
  title: string;
  amountMinor: number;
  currency: Currency;
  /** The faded line under the amount ("Added by you · Split equally", "Waiting for Swetha to confirm"). */
  note: string;
  /** A `<Stamp>` (absolutely placed) and/or the answer buttons. */
  children?: ReactNode;
};

/**
 * The original bill at the top of Expense and Payment detail (app.js `R.exp` / `R.pay`): perforated sheet, the space's
 * serial and the full date, the title, the 40 px hero amount, a faded note. Put it inside `<CarbonCopy>` while it awaits
 * an answer.
 */
export function Bill({ spaceSerial, date, title, amountMinor, currency, note, children }: BillProps) {
  const { colors, type, space } = useTheme();
  return (
    <Sheet perf style={{ padding: space.s4, overflow: 'visible' /* the stamp may overhang */ }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: space.s3 }}>
        <Text style={[type.serial, { color: colors.ink2 }]}>{serial(spaceSerial)}</Text>
        <Text style={[type.label, { color: colors.ink2, fontFamily: type.body.fontFamily }]}>{fullDate(date)}</Text>
      </View>
      <Text style={[type.title, { color: colors.ink, marginTop: space.s3 }]} accessibilityRole="header">
        {title}
      </Text>
      <Text style={[type.heroFigure, { color: colors.carbon, paddingTop: space.s2, paddingBottom: space.s1 }]}>{formatMoney(amountMinor, currency)}</Text>
      <Text style={[type.label, { color: colors.ink2 }]}>{note}</Text>
      {children}
    </Sheet>
  );
}

/** A detail screen's loading shape: the bill's lines, then a list. */
export function BillSkeleton() {
  const { space, type } = useTheme();
  return (
    <View style={{ gap: space.s6, marginTop: space.s1 }}>
      <Sheet perf style={{ padding: space.s4, gap: space.s3 }}>
        <Skeleton width="40%" />
        <Skeleton width="60%" />
        <Skeleton width="50%" height={type.heroFigure.lineHeight} />
      </Sheet>
      <Skeleton rows={2} />
    </View>
  );
}

/** Two answer buttons side by side under a bill (Reject / Accept, Not received / Confirm). */
export function AnswerRow({ children }: { children: ReactNode }) {
  const { space } = useTheme();
  return <View style={{ flexDirection: 'row', gap: space.s2 + 2, marginTop: space.s4 }}>{children}</View>;
}

/** The yellow notice above a bill (app.css `.banner`): a disputed expense. */
export function Notice({ text }: { text: string }) {
  const { colors, type, space, radius, scheme } = useTheme();
  const ink = scheme === 'dark' ? colors.ink : colors.onBadge;
  return (
    <View
      accessibilityRole="alert"
      style={{ marginTop: space.s1, marginBottom: space.s3, paddingVertical: space.s2 + 2, paddingHorizontal: space.s3, borderRadius: radius.sheet, backgroundColor: colors.dupYellow, flexDirection: 'row', alignItems: 'center', gap: space.s2 }}
    >
      <Icon name="alert" size="sm" color={ink} />
      <Text style={[type.label, { color: ink, flex: 1 }]}>{text}</Text>
    </View>
  );
}
