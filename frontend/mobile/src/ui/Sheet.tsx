import type { ReactNode } from 'react';
import { View, type StyleProp, type ViewStyle } from 'react-native';
import { useTheme } from '../theme/ThemeProvider';
import { size } from './metrics';
import { Perforation } from './Perforation';

export type SheetProps = {
  children?: ReactNode;
  /** An original bill: the dashed perforation on top, square top corners (`.perf`). */
  perf?: boolean;
  /** 12 px inside (bills, rows); omit for a sheet of `Rows`. */
  padded?: boolean;
  /** Inside a `BottomSheet` a sheet sits on the tint with no border (`.bsheet .sheet`). */
  nested?: boolean;
  style?: StyleProp<ViewStyle>;
};

/** The paper sheet: white on the ground, 6 px corners, a hairline, never a shadow (The Paper Stays Flat Rule). */
export function Sheet({ children, perf, padded, nested, style }: SheetProps) {
  const { colors, space, radius } = useTheme();
  return (
    <View
      style={[
        {
          backgroundColor: nested ? colors.sheet2 : colors.sheet,
          borderWidth: size.hairline,
          borderColor: nested ? 'transparent' : colors.hair,
          borderRadius: radius.sheet,
          overflow: 'hidden',
        },
        perf && { borderTopWidth: 0, borderTopLeftRadius: 0, borderTopRightRadius: 0, paddingTop: size.perf },
        padded && { padding: space.s3 },
        style,
      ]}
    >
      {perf && <Perforation color={colors.perf} />}
      {children}
    </View>
  );
}
