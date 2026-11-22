import type { ReactNode } from 'react';
import { Text, View } from 'react-native';
import { router } from 'expo-router';
import { useTheme } from '../theme/ThemeProvider';
import { IconButton } from './IconButton';
import { size } from './metrics';

export type AppBarProps = {
  title: string;
  /** A small-caps serial over the title ("NO. 0412"). */
  serial?: string;
  /** `false` hides the back arrow (tab screens). Defaults to `router.back()`, which runs the discard guard. */
  onBack?: (() => void) | false;
  /** Spoken as "Back to …" when given. */
  backTo?: string;
  /** Icon buttons on the right (members, edit, delete). */
  actions?: ReactNode;
};

/** The 52 px app bar: ← back, the title (one line, ellipsised), actions (app.js `appbar`). */
export function AppBar({ title, serial, onBack, backTo, actions }: AppBarProps) {
  const { colors, type, space } = useTheme();
  return (
    <View style={{ minHeight: size.control, flexDirection: 'row', alignItems: 'center', gap: space.s1, paddingHorizontal: space.s2 }}>
      {onBack !== false && (
        <IconButton icon="back" label={backTo ? `Back to ${backTo}` : 'Back'} onPress={onBack ?? (() => router.back())} />
      )}
      <View style={{ flex: 1, minWidth: 0, paddingLeft: space.s1 }}>
        {!!serial && <Text style={[type.serial, { color: colors.ink2 }]}>{serial}</Text>}
        <Text style={[type.title, { color: colors.ink }]} numberOfLines={1} accessibilityRole="header">
          {title}
        </Text>
      </View>
      {actions}
    </View>
  );
}
