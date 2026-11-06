import { useState } from 'react';
import { Text, TextInput, View, useWindowDimensions } from 'react-native';
import { formatMoney } from '../../domain/money';
import type { Currency, SplitType, User } from '../../domain/types';
import { useTheme } from '../../theme/ThemeProvider';
import { Icon } from '../../ui/Icon';
import { MemberPlate } from '../../ui/MemberPlate';
import { size } from '../../ui/metrics';
import { Press } from '../../ui/Press';
import { Segmented } from '../../ui/Segmented';
import { Sheet } from '../../ui/Sheet';
import { FORM } from './metrics';
import type { SplitValues } from './split';

const TYPES: { value: SplitType; label: string }[] = [
  { value: 'equal', label: 'Equally' },
  { value: 'exact', label: 'Exact' },
  { value: 'percent', label: 'Percent' },
  { value: 'shares', label: 'Shares' },
];
const VALUE_NAME = { exact: 'Exact amount', percent: 'Percent', shares: 'Shares' } as const;

export type SplitTone = 'ink' | 'muted' | 'owed' | 'pending' | 'owe';

export type SplitEditorProps = {
  memberIds: string[];
  people: Record<string, User>;
  meId: string;
  currency: Currency;
  type: SplitType;
  on: Record<string, boolean>;
  values: SplitValues;
  /** What each ticked person will owe, from `computeSplit`. */
  amounts: Record<string, number>;
  helper: string;
  tone: SplitTone;
  onType: (t: SplitType) => void;
  onToggle: (userId: string) => void;
  onValue: (userId: string, text: string) => void;
};

/**
 * "Split" (specs § 8.1–8.2; app.js `expenseForm`): the four split types as a segmented control, one row per member in
 * member-list order (tick, name, the typed value, the live amount), and the helper line from `computeSplit` underneath.
 */
export function SplitEditor(p: SplitEditorProps) {
  const { colors, type, space } = useTheme();
  const ticked = p.memberIds.filter((id) => p.on[id]).length;
  const toneColor = { ink: colors.ink, muted: colors.ink2, owed: colors.owed, pending: colors.pending, owe: colors.owe }[p.tone];
  return (
    <View style={{ gap: space.s2 - 2 }}>
      <Text style={[type.label, { color: colors.ink }]}>Split</Text>
      <Segmented options={TYPES} value={p.type} onChange={p.onType} label="Split type" />
      <Sheet style={{ marginTop: space.s1 }}>
        {p.memberIds.map((id, i) => (
          <SplitRow key={id} first={i === 0} userId={id} {...p} />
        ))}
        <View
          accessibilityLiveRegion="polite"
          style={{
            flexDirection: 'row',
            justifyContent: 'space-between',
            gap: space.s3,
            paddingVertical: space.s2 + 2,
            paddingHorizontal: space.s3,
            borderTopWidth: size.hairline,
            borderTopColor: colors.hair,
            backgroundColor: colors.sheet2,
          }}
        >
          <Text style={[type.label, { flex: 1, color: toneColor }]}>{p.helper}</Text>
          {p.type === 'equal' && p.tone === 'ink' && (
            <Text style={[type.label, { color: colors.ink2 }]}>{ticked === 1 ? '1 person' : `${ticked} people`}</Text>
          )}
        </View>
      </Sheet>
    </View>
  );
}

function SplitRow({ userId, first, people, meId, currency, type: split, on, values, amounts, onToggle, onValue }: SplitEditorProps & { userId: string; first: boolean }) {
  const { colors, type, space, radius } = useTheme();
  const { width, fontScale } = useWindowDimensions();
  const [focused, setFocused] = useState(false);
  const person = people[userId];
  const fullName = person?.name ?? 'Someone';
  const name = userId === meId ? 'You' : fullName.split(/\s+/)[0];
  const ticked = !!on[userId];
  // 320 dp at 2× text leaves no room for a name beside the value box and the amount: they move to a second line.
  const stacked = width / fontScale < FORM.stackBelow;

  return (
    <View
      style={[
        { minHeight: FORM.splitRow, paddingVertical: space.s2, paddingHorizontal: space.s3, gap: space.s3 },
        stacked ? { alignItems: 'stretch' } : { flexDirection: 'row', alignItems: 'center' },
        !first && { borderTopWidth: size.hairline, borderTopColor: colors.hair },
      ]}
    >
      <Press
        accessibilityRole="checkbox"
        accessibilityLabel={name}
        accessibilityState={{ checked: ticked }}
        onPress={() => onToggle(userId)}
        scaleTo={1}
        style={{ flex: stacked ? undefined : 1, minWidth: 0, minHeight: size.target, flexDirection: 'row', alignItems: 'center', gap: space.s2 + 2 }}
      >
        <View
          style={{
            width: FORM.check,
            height: FORM.check,
            borderRadius: radius.sheet,
            borderWidth: size.focusRing,
            alignItems: 'center',
            justifyContent: 'center',
            borderColor: ticked ? colors.carbon : colors.controlEdge,
            backgroundColor: ticked ? colors.carbon : 'transparent',
          }}
        >
          {ticked && <Icon name="check" size="sm" color={colors.onCarbon} />}
        </View>
        {person && <MemberPlate user={person} />}
        <Text style={[type.body, { flex: 1, minWidth: 0, color: ticked ? colors.ink : colors.ink2 }]} numberOfLines={1}>
          {name}
        </Text>
      </Press>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: space.s3 }}>
        {ticked && split !== 'equal' && (
          <TextInput
            accessibilityLabel={`${VALUE_NAME[split]} for ${fullName}`}
            value={values[userId] ?? ''}
            onChangeText={(t) => onValue(userId, t)}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            inputMode={split === 'shares' ? 'numeric' : 'decimal'}
            keyboardType={split === 'shares' ? 'number-pad' : 'decimal-pad'}
            maxLength={split === 'shares' ? 4 : split === 'percent' ? 6 : 10}
            placeholder={split === 'percent' ? '%' : split === 'shares' ? '1' : '0'}
            placeholderTextColor={colors.ink2}
            selectionColor={colors.selection}
            cursorColor={colors.carbon}
            style={[
              type.body,
              {
                width: FORM.splitValue,
                minHeight: size.target,
                paddingHorizontal: space.s2 + 2,
                paddingVertical: 0,
                textAlign: 'right',
                color: colors.ink,
                backgroundColor: colors.sheet2,
                borderRadius: radius.sheet,
                borderWidth: size.hairline,
                borderColor: focused ? colors.carbon : colors.controlEdge,
              },
            ]}
          />
        )}
        <Text
          style={[
            type.label,
            { minWidth: FORM.splitResult, textAlign: 'right', color: ticked ? colors.ink : colors.ink2 },
            !ticked && { fontFamily: type.body.fontFamily },
          ]}
        >
          {ticked ? formatMoney(amounts[userId] ?? 0, currency) : 'not in this'}
        </Text>
      </View>
    </View>
  );
}
