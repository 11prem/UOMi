import { Text, View } from 'react-native';
import { useTheme } from '../theme/ThemeProvider';
import { lift } from '../theme/tokens';
import { Icon, type IconName } from './Icon';
import { size } from './metrics';
import { Press } from './Press';

export type SegmentedOption<T extends string> = { value: T; label?: string; icon?: IconName; accessibilityLabel?: string };

export type SegmentedProps<T extends string> = {
  options: SegmentedOption<T>[];
  value: T;
  onChange: (value: T) => void;
  /** Names the group for screen readers ("Split type", "Theme"). */
  label: string;
};

/** The segmented control (`.seg`): a sheet-2 track; the chosen segment is a sheet with a carbon ring and Lift 1. */
export function Segmented<T extends string>({ options, value, onChange, label }: SegmentedProps<T>) {
  const { colors, type, space, radius, scheme } = useTheme();
  return (
    <View
      accessibilityRole="radiogroup"
      accessibilityLabel={label}
      style={{ flexDirection: 'row', padding: 3, borderRadius: radius.segment, backgroundColor: colors.sheet2, borderWidth: size.hairline, borderColor: colors.hair }}
    >
      {options.map((o) => {
        const on = o.value === value;
        return (
          <Press
            key={o.value}
            onPress={() => onChange(o.value)}
            accessibilityRole="radio"
            accessibilityLabel={o.accessibilityLabel ?? o.label}
            accessibilityState={{ checked: on }}
            scaleTo={1}
            style={[
              {
                flex: 1,
                minHeight: size.target,
                borderRadius: radius.sheet,
                borderWidth: size.focusRing,
                borderColor: 'transparent',
                flexDirection: 'row',
                alignItems: 'center',
                justifyContent: 'center',
                gap: space.s2 - 2,
              },
              on && { backgroundColor: colors.sheet, borderColor: colors.carbon, boxShadow: lift[scheme].lift1 },
            ]}
          >
            {o.icon && <Icon name={o.icon} size="sm" color={on ? colors.carbon : colors.ink2} />}
            {!!o.label && (
              <Text style={[type.label, { color: on ? colors.carbon : colors.ink2 }]} numberOfLines={1}>
                {o.label}
              </Text>
            )}
          </Press>
        );
      })}
    </View>
  );
}
