import { Text, View } from 'react-native';
import { router } from 'expo-router';
import type { SpaceIcon as SpaceIconName } from '../../domain/types';
import { useTheme } from '../../theme/ThemeProvider';
import { IconButton } from '../../ui/IconButton';
import { size } from '../../ui/metrics';
import { SpaceIcon } from '../../ui/SpaceIcon';

/**
 * The Space Page app bar (specs § 7; app.js `R.space`): ← back, the space icon and name, the members button on the right.
 * The kit `AppBar` has no slot for an icon before the title, so this is its 52 px layout with one.
 */
export function SpaceHeader({ title, icon, onMembers }: { title: string; icon?: SpaceIconName; onMembers?: () => void }) {
  const { colors, type, space } = useTheme();
  return (
    <View style={{ minHeight: size.control, flexDirection: 'row', alignItems: 'center', gap: space.s2, paddingHorizontal: space.s2 }}>
      <IconButton icon="back" label="Back" onPress={() => router.back()} />
      {icon && <SpaceIcon name={icon} sm />}
      <Text style={[type.title, { flex: 1, minWidth: 0, color: colors.ink }]} numberOfLines={1} accessibilityRole="header">
        {title}
      </Text>
      {onMembers && <IconButton icon="users" label="Members and space settings" onPress={onMembers} />}
    </View>
  );
}
