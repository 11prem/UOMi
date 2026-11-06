import { View } from 'react-native';
import { useTheme } from '../theme/ThemeProvider';
import { Icon, type IconName } from './Icon';
import { size } from './metrics';

/** The 40 px space-icon tile (carbon icon on carbon-wash; `sm` 32 px for the app bar; `muted` sheet-2 / faded ink for expense rows). */
export function SpaceIcon({ name, sm, muted }: { name: IconName; sm?: boolean; muted?: boolean }) {
  const { colors, radius } = useTheme();
  const d = sm ? size.spaceIconSm : size.spaceIcon;
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={{
        width: d,
        height: d,
        borderRadius: radius.sheet,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: muted ? colors.sheet2 : colors.carbonWash,
      }}
    >
      <Icon name={name} size={sm || muted ? 'sm' : 'md'} color={muted ? colors.ink2 : colors.carbon} />
    </View>
  );
}
