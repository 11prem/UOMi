import { useState } from 'react';
import { Text, View } from 'react-native';
import { fullDate, monthKey, relDate } from '../../domain/dates';
import { useTheme } from '../../theme/ThemeProvider';
import { BottomSheet } from '../../ui/BottomSheet';
import { Field } from '../../ui/Field';
import { Icon } from '../../ui/Icon';
import { IconButton } from '../../ui/IconButton';
import { size } from '../../ui/metrics';
import { Press } from '../../ui/Press';
import { Rows } from '../../ui/Rows';

const sameDay = (a: Date, b: Date) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
const dayName = (d: Date) => d.toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' }).replace(/,/g, '');

/** The timestamp stored for a picked day: now for today (never ahead of the clock), local noon otherwise (no zone can shift the day). */
export function dayValue(y: number, m: number, d: number, now = Date.now()): number {
  const picked = new Date(y, m, d, 12);
  return sameDay(picked, new Date(now)) ? now : Math.min(picked.getTime(), now);
}

/**
 * "Date" (specs § 8.1): today by default, and a bottom sheet listing one month's days, newest first, with ‹ › to move a
 * month. Future days are never listed. The kit has no date picker and the 7-column calendar grid can't keep 44 pt
 * targets on a 320 dp phone, so each day is a full-width row.
 */
export function DateField({ value, onChange }: { value: number; onChange: (ms: number) => void }) {
  const { colors, type, space, radius } = useTheme();
  const [open, setOpen] = useState(false);
  const [month, setMonth] = useState(() => {
    const d = new Date(value);
    return { y: d.getFullYear(), m: d.getMonth() };
  });
  const now = new Date();
  const thisMonth = month.y === now.getFullYear() && month.m === now.getMonth();
  const lastDay = thisMonth ? now.getDate() : new Date(month.y, month.m + 1, 0).getDate();
  const days = Array.from({ length: lastDay }, (_, i) => new Date(month.y, month.m, lastDay - i));
  const shift = (by: number) => setMonth(({ y, m }) => ({ y: m + by < 0 ? y - 1 : m + by > 11 ? y + 1 : y, m: (m + by + 12) % 12 }));
  const picked = new Date(value);

  return (
    <Field label="Date">
      <Press
        onPress={() => {
          setMonth({ y: picked.getFullYear(), m: picked.getMonth() });
          setOpen(true);
        }}
        accessibilityLabel={`Date, ${fullDate(value)}`}
        accessibilityHint="Opens a list of days to pick from"
        scaleTo={1}
        style={{
          minHeight: size.control,
          borderRadius: radius.sheet,
          borderWidth: size.hairline,
          borderColor: open ? colors.carbon : colors.controlEdge,
          backgroundColor: colors.sheet,
          paddingHorizontal: space.s3 + 2,
          flexDirection: 'row',
          alignItems: 'center',
          gap: space.s2,
        }}
      >
        <Icon name="calendar" size="sm" color={colors.ink2} />
        <Text style={[type.body, { flex: 1, color: colors.ink }]}>{fullDate(value)}</Text>
      </Press>

      <BottomSheet visible={open} onClose={() => setOpen(false)} title="Date">
        <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: space.s2 }}>
          <IconButton icon="back" label="Previous month" onPress={() => shift(-1)} />
          <Text style={[type.body, { flex: 1, textAlign: 'center', fontFamily: type.label.fontFamily, color: colors.ink }]} accessibilityRole="header">
            {monthKey(new Date(month.y, month.m, 1).getTime())}
          </Text>
          <IconButton icon="chev" label="Next month" onPress={() => shift(1)} disabled={thisMonth} />
        </View>
        <View accessibilityRole="radiogroup" accessibilityLabel="Day">
          <Rows nested>
            {days.map((d) => {
              const on = sameDay(d, picked);
              const rel = relDate(d.getTime());
              return (
                <Press
                  key={d.getDate()}
                  accessibilityRole="radio"
                  accessibilityState={{ checked: on }}
                  accessibilityLabel={rel === 'Today' || rel === 'Yesterday' ? `${rel}, ${dayName(d)}` : dayName(d)}
                  onPress={() => {
                    onChange(dayValue(d.getFullYear(), d.getMonth(), d.getDate()));
                    setOpen(false);
                  }}
                  scaleTo={1}
                  style={{ minHeight: size.control, paddingHorizontal: space.s3, flexDirection: 'row', alignItems: 'center', gap: space.s3 }}
                  pressedStyle={{ backgroundColor: colors.carbonWash }}
                >
                  <Text style={[type.body, { flex: 1, color: colors.ink }]}>{dayName(d)}</Text>
                  {(rel === 'Today' || rel === 'Yesterday') && <Text style={[type.label, { color: colors.ink2 }]}>{rel}</Text>}
                  {on && <Icon name="check" size="sm" color={colors.carbon} />}
                </Press>
              );
            })}
          </Rows>
        </View>
      </BottomSheet>
    </Field>
  );
}
