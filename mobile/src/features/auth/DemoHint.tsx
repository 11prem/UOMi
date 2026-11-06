import type { ReactNode } from 'react';
import { Text, View } from 'react-native';
import { useTheme } from '../../theme/ThemeProvider';
import { size } from '../../ui/metrics';

/** The dashed note that gives the demo's test values (`.demo-hint`); bold the values with `<DemoValue>`. */
export function DemoHint({ children }: { children: ReactNode }) {
  const { colors, type, space, radius } = useTheme();
  return (
    <View
      style={{
        marginTop: space.s4,
        paddingVertical: space.s2 + 2,
        paddingHorizontal: space.s3,
        borderRadius: radius.sheet,
        borderWidth: size.hairline,
        borderStyle: 'dashed',
        borderColor: colors.hairStrong,
      }}
    >
      <Text style={[type.label, { fontFamily: type.body.fontFamily, color: colors.ink2 }]}>{children}</Text>
    </View>
  );
}

export function DemoValue({ children }: { children: ReactNode }) {
  const { colors, type } = useTheme();
  return <Text style={{ fontFamily: type.label.fontFamily, color: colors.ink }}>{children}</Text>;
}
