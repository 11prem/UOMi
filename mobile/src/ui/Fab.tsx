import { useTheme } from '../theme/ThemeProvider';
import { lift } from '../theme/tokens';
import { Icon, type IconName } from './Icon';
import { size } from './metrics';
import { Press } from './Press';

/**
 * The round 60 px primary action (→ Next, ✓ Save, + Add). Pass it to `<Screen fab={…}>`, which places it bottom right
 * above the safe area, the tab bar and the keyboard.
 */
export function Fab({ icon, label, onPress, disabled }: { icon: IconName; label: string; onPress?: () => void; disabled?: boolean }) {
  const { colors, scheme } = useTheme();
  return (
    <Press
      onPress={onPress}
      disabled={disabled}
      accessibilityLabel={label}
      scaleTo={0.94}
      style={{
        width: size.fab,
        height: size.fab,
        borderRadius: size.fab / 2,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: colors.carbon,
        boxShadow: lift[scheme].lift2,
      }}
      pressedStyle={{ backgroundColor: colors.carbonPress }}
    >
      <Icon name={icon} color={colors.onCarbon} />
    </Press>
  );
}
