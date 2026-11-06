import { Pressable, Text } from 'react-native';
import { useTheme } from '../theme/ThemeProvider';
import { fonts } from '../theme/type';
import { glyph } from './metrics';

export type WordmarkProps = {
  /** The 56 / 60 Display Bold mark on Welcome; otherwise the 22 px wordmark (Home, Profile). */
  hero?: boolean;
  /** The hidden door to a settings sheet (Server on Welcome, Debug on Profile). Also offered to screen readers as an action. */
  onLongPress?: () => void;
  /** What the long press opens, for screen readers ("Server settings"). */
  longPressLabel?: string;
};

/** The placeholder text wordmark "UOMi" set in Fraunces (specs § 3.7). */
export function Wordmark({ hero, onLongPress, longPressLabel = 'Settings' }: WordmarkProps) {
  const { colors, type, space } = useTheme();
  const text = (
    <Text
      accessibilityRole="header"
      style={[
        hero ? { fontFamily: fonts.displayBold, ...glyph.hero } : type.wordmark,
        { color: colors.ink, paddingTop: space.s2, paddingBottom: space.s1 },
      ]}
    >
      UOMi
    </Text>
  );
  if (!onLongPress) return text;
  return (
    <Pressable
      onLongPress={onLongPress}
      accessibilityLabel="UOMi"
      accessibilityActions={[{ name: 'longpress', label: longPressLabel }]}
      onAccessibilityAction={(e) => e.nativeEvent.actionName === 'longpress' && onLongPress()}
      style={{ alignSelf: 'flex-start' }}
    >
      {text}
    </Pressable>
  );
}
