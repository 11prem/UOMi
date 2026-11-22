import { useTheme } from '../theme/ThemeProvider';
import { Icon, type IconName } from './Icon';
import { size } from './metrics';
import { Press } from './Press';

export type IconButtonProps = {
  icon: IconName;
  /** Spoken label; required because the button has no text (specs § 3.6), e.g. "Accept your ₹14 share of Dinner". */
  label: string;
  onPress?: () => void;
  /** `plain` the 48 px app-bar button · `accept` / `reject` the 44 px answer controls (carbon disc / outlined sheet). */
  variant?: 'plain' | 'accept' | 'reject';
  color?: string;
  disabled?: boolean;
  iconSize?: 'sm' | 'md';
};

const ANSWER_SLOP = (size.iconButton - size.target) / 2; // answer discs draw at 44 but take 48 dp of touch

export function IconButton({ icon, label, onPress, variant = 'plain', color, disabled, iconSize = 'md' }: IconButtonProps) {
  const { colors } = useTheme();
  const answer = variant !== 'plain';
  const d = answer ? size.target : size.iconButton;
  return (
    <Press
      onPress={onPress}
      disabled={disabled}
      accessibilityLabel={label}
      hitSlop={answer ? ANSWER_SLOP : undefined}
      scaleTo={answer ? 0.92 : 0.94}
      style={[
        { width: d, height: d, borderRadius: d / 2, alignItems: 'center', justifyContent: 'center' },
        variant === 'accept' && { backgroundColor: colors.carbon },
        variant === 'reject' && { backgroundColor: colors.sheet, borderWidth: size.hairline, borderColor: colors.controlEdge },
      ]}
      pressedStyle={{ backgroundColor: variant === 'accept' ? colors.carbonPress : colors.carbonWash }}
    >
      <Icon
        name={icon}
        size={iconSize}
        color={color ?? (variant === 'accept' ? colors.onCarbon : variant === 'reject' ? colors.ink2 : colors.ink)}
      />
    </Press>
  );
}
