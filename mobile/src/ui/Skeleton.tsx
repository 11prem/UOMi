import { useEffect, useRef } from 'react';
import { Animated, View, type DimensionValue } from 'react-native';
import { useTheme } from '../theme/ThemeProvider';
import { easeInOut, nativeDriver, size } from './metrics';
import { Sheet } from './Sheet';
import { useReducedMotion } from './useReducedMotion';

export type SkeletonProps = {
  /** A loading list: this many ledger-row placeholders in one sheet (app.js `skelRows`). Omit for a single bar. */
  rows?: number;
  width?: DimensionValue;
  height?: number;
};

/** Loading placeholders in the shape of the real content (specs § 3.2), pulsing gently (still under reduced motion). */
export function Skeleton({ rows, width = '100%', height = 14 }: SkeletonProps) {
  const { colors, space } = useTheme();
  const reduced = useReducedMotion();
  const pulse = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    if (reduced) return;
    const half = (toValue: number) => Animated.timing(pulse, { toValue, duration: 600, easing: easeInOut, useNativeDriver: nativeDriver });
    const loop = Animated.loop(Animated.sequence([half(0.5), half(1)]));
    loop.start();
    return () => loop.stop();
  }, [reduced, pulse]);

  const bar = (w: DimensionValue, h: number, extra?: object) => (
    <Animated.View style={[{ width: w, height: h, borderRadius: space.s1, backgroundColor: colors.skeleton, opacity: pulse }, extra]} />
  );

  if (!rows) return <View accessibilityLabel="Loading">{bar(width, height)}</View>;
  return (
    <View accessible accessibilityLabel="Loading">
      <Sheet>
        {Array.from({ length: rows }, (_, i) => (
          <View
            key={i}
            style={[
              { flexDirection: 'row', alignItems: 'center', gap: space.s3, minHeight: size.row, padding: space.s3 },
              i > 0 && { borderTopWidth: size.hairline, borderTopColor: colors.hair },
            ]}
          >
            <View style={{ flex: 1 }}>
              {bar('55%', 14)}
              {bar('30%', 11, { marginTop: space.s2 })}
            </View>
            {bar(80, 14)}
          </View>
        ))}
      </Sheet>
    </View>
  );
}
