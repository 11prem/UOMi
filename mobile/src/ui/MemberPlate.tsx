import { useState } from 'react';
import { Image, Text, View } from 'react-native';
import type { User } from '../domain/types';
import { useTheme } from '../theme/ThemeProvider';
import { fonts } from '../theme/type';
import { glyph, size } from './metrics';

const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();

/**
 * A person's square colour plate with initials (or photo): 32 px, 72 px at 12 px corners for `lg`. Decorative: name the person in text.
 * A photo that fails to load (the OS can clear the picker's cache file) falls back to the initials.
 */
export function MemberPlate({ user, lg }: { user: Pick<User, 'name' | 'plate' | 'avatarUrl'>; lg?: boolean }) {
  const { colors, radius } = useTheme();
  const d = lg ? size.plateLg : size.plate;
  const fontSize = lg ? glyph.initialsLg : glyph.initials;
  const [failed, setFailed] = useState<string | null>(null); // the URL that failed, so a new photo is tried again
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={{
        width: d,
        height: d,
        borderRadius: lg ? radius.plateLg : radius.sheet,
        backgroundColor: colors[`m${user.plate}`],
        alignItems: 'center',
        justifyContent: 'center',
        overflow: 'hidden',
      }}
    >
      {user.avatarUrl && user.avatarUrl !== failed ? (
        <Image source={{ uri: user.avatarUrl }} onError={() => setFailed(user.avatarUrl)} style={{ width: d, height: d }} />
      ) : (
        // The plate is a fixed square, so its initials stop growing a little past 1× instead of spilling out.
        <Text maxFontSizeMultiplier={1.2} style={{ fontFamily: fonts.textBold, fontSize, letterSpacing: fontSize * 0.02, color: colors.onCarbon }}>
          {initials(user.name)}
        </Text>
      )}
    </View>
  );
}
