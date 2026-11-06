import { Text } from 'react-native';
import { useTheme } from '../theme/ThemeProvider';
import { size } from './metrics';
import { Press } from './Press';

/** A 44 px filter pill: sheet + faded label, carbon fill when selected (DESIGN.md § Chips). */
export function Chip({ label, selected, onPress }: { label: string; selected?: boolean; onPress?: () => void }) {
  const { colors, type, space, radius } = useTheme();
  return (
    <Press
      onPress={onPress}
      accessibilityLabel={label}
      accessibilityState={{ selected: !!selected }}
      style={{
        minHeight: size.target,
        paddingHorizontal: space.s4,
        borderRadius: radius.pill,
        borderWidth: size.hairline,
        justifyContent: 'center',
        backgroundColor: selected ? colors.carbon : colors.sheet,
        borderColor: selected ? colors.carbon : colors.controlEdge,
      }}
    >
      <Text style={[type.label, { color: selected ? colors.onCarbon : colors.ink2 }]} numberOfLines={1}>
        {label}
      </Text>
    </Press>
  );
}
