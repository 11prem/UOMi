import { useState } from 'react';
import { Text, View } from 'react-native';
import { useTheme } from '../../theme/ThemeProvider';
import { BottomSheet } from '../../ui/BottomSheet';
import { Icon } from '../../ui/Icon';
import { size } from '../../ui/metrics';
import { Press } from '../../ui/Press';
import { Rows } from '../../ui/Rows';

export type SelectOption<T extends string> = { value: T; label: string; sub?: string };

/** app.css `.select` in a settings row is 120 px wide; elsewhere it fills its parent. */
const COMPACT_WIDTH = 120;

/**
 * A dropdown (app.css `.select`): a field showing the choice, which opens a bottom sheet of radio rows. The kit has no
 * dropdown, and a sheet keeps a long list (every space, every currency) on one tappable surface instead of nesting a
 * Modal inside another. `label` names the control for screen readers and titles the sheet.
 */
export function Select<T extends string>({
  label,
  value,
  options,
  onChange,
  disabled,
  compact,
}: {
  label: string;
  value: T;
  options: SelectOption<T>[];
  onChange: (value: T) => void;
  disabled?: boolean;
  compact?: boolean;
}) {
  const { colors, type, space, radius } = useTheme();
  const [open, setOpen] = useState(false);
  const current = options.find((o) => o.value === value) ?? options[0];

  return (
    <>
      <Press
        onPress={() => setOpen(true)}
        disabled={disabled}
        accessibilityLabel={`${label}, ${current?.label ?? ''}`}
        accessibilityHint={disabled ? undefined : 'Opens a list of choices'}
        accessibilityState={{ disabled: !!disabled, expanded: open }}
        scaleTo={1}
        style={{
          minHeight: compact ? size.target : size.control,
          width: compact ? COMPACT_WIDTH : undefined,
          borderRadius: radius.sheet,
          borderWidth: size.hairline,
          borderColor: colors.controlEdge,
          backgroundColor: colors.sheet,
          paddingLeft: space.s3 + 2,
          paddingRight: space.s2,
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: space.s2,
        }}
      >
        <Text style={[type.body, { color: colors.ink, flexShrink: 1 }]} numberOfLines={1}>
          {current?.label}
        </Text>
        <View style={{ transform: [{ rotate: '90deg' }] }}>
          <Icon name="chev" size="sm" color={colors.ink2} />
        </View>
      </Press>
      <BottomSheet visible={open} onClose={() => setOpen(false)} title={label}>
        <View accessibilityRole="radiogroup" accessibilityLabel={label}>
          <Rows nested>
            {options.map((o) => {
              const on = o.value === value;
              return (
                <Press
                  key={o.value}
                  accessibilityRole="radio"
                  accessibilityLabel={o.sub ? `${o.label}, ${o.sub}` : o.label}
                  accessibilityState={{ checked: on }}
                  onPress={() => {
                    setOpen(false);
                    if (!on) onChange(o.value);
                  }}
                  scaleTo={1}
                  style={{ minHeight: size.target + space.s3, paddingHorizontal: space.s3, flexDirection: 'row', alignItems: 'center', gap: space.s3 }}
                  pressedStyle={{ backgroundColor: colors.carbonWash }}
                >
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={[type.body, { color: on ? colors.carbon : colors.ink, fontFamily: on ? type.label.fontFamily : type.body.fontFamily }]}>{o.label}</Text>
                    {!!o.sub && <Text style={[type.label, { color: colors.ink2 }]}>{o.sub}</Text>}
                  </View>
                  {on && <Icon name="check" size="sm" color={colors.carbon} />}
                </Press>
              );
            })}
          </Rows>
        </View>
      </BottomSheet>
    </>
  );
}
