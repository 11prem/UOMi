import { Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { useTheme } from '../theme/ThemeProvider';
import { Icon, type IconName } from './Icon';
import { size } from './metrics';
import { Press } from './Press';
import { Spinner } from './Spinner';

export type ButtonProps = {
  label: string;
  onPress?: () => void;
  /** `primary` carbon fill · `secondary` sheet + carbon label · `danger` sheet + owe label · `text` a 44 px carbon text button. */
  variant?: 'primary' | 'secondary' | 'danger' | 'text';
  /** `text` only: an owe-red label (destructive dialog actions). */
  danger?: boolean;
  disabled?: boolean;
  /** Shows the spinner instead of the label and ignores presses (no double submit). */
  busy?: boolean;
  icon?: IconName;
  /** Full width by default (`.btn`); `false` sizes to the label (Retry, text buttons). */
  block?: boolean;
  accessibilityLabel?: string;
  style?: StyleProp<ViewStyle>;
};

/** DESIGN.md § Buttons: 52 px, 6 px corners, 20 px side padding, label at 600; press scales to 0.98. */
export function Button({ label, onPress, variant = 'primary', danger, disabled, busy, icon, block, accessibilityLabel, style }: ButtonProps) {
  const { colors, type, space, radius } = useTheme();
  const text = variant === 'text';
  const ink =
    variant === 'primary' ? colors.onCarbon : variant === 'danger' || (text && danger) ? colors.owe : colors.carbon;
  const full = block ?? !text;

  return (
    <Press
      onPress={busy ? undefined : onPress}
      disabled={disabled}
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ disabled: !!disabled, busy: !!busy }}
      scaleTo={0.98}
      style={[
        {
          minHeight: text ? size.target : size.control,
          paddingHorizontal: text ? space.s1 : space.s5,
          borderRadius: radius.sheet,
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'center',
          gap: space.s2,
          alignSelf: full ? 'stretch' : 'flex-start',
        },
        variant === 'primary' && { backgroundColor: colors.carbon },
        (variant === 'secondary' || variant === 'danger') && {
          backgroundColor: colors.sheet,
          borderWidth: size.hairline,
          borderColor: colors.controlEdge,
        },
        style,
      ]}
      pressedStyle={variant === 'primary' ? { backgroundColor: colors.carbonPress } : !text && { backgroundColor: colors.carbonWash }}
    >
      {busy ? (
        <Spinner color={ink} />
      ) : (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.s2 }}>
          {icon && <Icon name={icon} size="sm" color={ink} />}
          <Text style={[type.body, { fontFamily: type.label.fontFamily, color: ink }]} numberOfLines={1}>
            {label}
          </Text>
        </View>
      )}
    </Press>
  );
}
