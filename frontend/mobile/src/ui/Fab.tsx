import { useTheme } from '../theme/ThemeProvider';
import { lift } from '../theme/tokens';
import { Icon, type IconName } from './Icon';
import { size } from './metrics';
import { Press } from './Press';
import { Spinner } from './Spinner';

/**
 * The round 60 px primary action (→ Next, ✓ Save, + Add). Pass it to `<Screen fab={…}>`, which places it bottom right
 * above the safe area, the tab bar and the keyboard. `busy` (a request in flight, specs § 3.3): the spinner replaces the
 * icon and the button is disabled.
 */
export function Fab({ icon, label, onPress, disabled, busy }: { icon: IconName; label: string; onPress?: () => void; disabled?: boolean; busy?: boolean }) {
  const { colors, scheme } = useTheme();
  return (
    <Press
      onPress={onPress}
      disabled={disabled || busy}
      accessibilityLabel={label}
      accessibilityState={{ busy: !!busy }} // Press adds `disabled`
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
      {busy ? <Spinner color={colors.onCarbon} /> : <Icon name={icon} color={colors.onCarbon} />}
    </Press>
  );
}
