import type { ReactNode } from 'react';
import { Text } from 'react-native';
import { useTheme } from '../../theme/ThemeProvider';

/** A section heading (app.css `.section-h`): title type, 28 px above its group and 10 px above the content. */
export function SectionHeading({ children }: { children: ReactNode }) {
  const { colors, type, space } = useTheme();
  return (
    <Text accessibilityRole="header" style={[type.title, { color: colors.ink, marginTop: space.s6 + space.s1, marginBottom: space.s2 + 2 }]}>
      {children}
    </Text>
  );
}
