import { useEffect, useRef, type ReactNode } from 'react';
import { Animated, View, type StyleProp, type ViewStyle } from 'react-native';
import { useTheme } from '../theme/ThemeProvider';
import { motion } from '../theme/tokens';
import { easeOut, nativeDriver, size } from './metrics';
import { Perforation } from './Perforation';
import { useReducedMotion } from './useReducedMotion';

export type CarbonCopyProps = {
  /** The original bill on top (usually a `<Sheet perf>`). */
  children: ReactNode;
  /** `share`: pink duplicate + yellow triplicate; `payment`: a single yellow copy. */
  kind?: 'share' | 'payment';
  /** Set when the item is answered: accepting peels the copies down-right, rejecting tears them down-left. */
  leaving?: 'peel' | 'tear' | null;
  /** Called when the copies have gone. */
  onGone?: () => void;
  style?: StyleProp<ViewStyle>;
};

// Rest offsets of the two copies (x, y, deg) and where each leaves to (app.css `.dup`, `.dup.peel`, `.dup.tear`).
const REST = [
  [5, 7, 0.7],
  [10, 14, 1.5],
] as const;
const AWAY = {
  peel: [
    [22, 46, 5],
    [30, 58, 7],
  ],
  tear: [
    [-10, 60, -7],
    [-14, 70, -9],
  ],
} as const;

/**
 * The signature: an original with its offset, slightly rotated duplicates beneath, shown only while something awaits an
 * answer (The Duplicate Means Pending Rule). Leave room for the 10 × 14 px the copies stick out below-right.
 */
export function CarbonCopy({ children, kind = 'share', leaving, onGone, style }: CarbonCopyProps) {
  const { colors, radius } = useTheme();
  const reduced = useReducedMotion();
  const first = useRef(new Animated.Value(0)).current;
  const second = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!leaving) return;
    const go = (v: Animated.Value, delay: number) =>
      Animated.timing(v, { toValue: 1, delay, duration: reduced ? motion.duration.fast : motion.duration.screen, easing: easeOut, useNativeDriver: nativeDriver });
    Animated.parallel([go(first, 0), go(second, 60)]).start(({ finished }) => finished && onGone?.());
  }, [leaving]); // once per answer, even if the parent passes a new `onGone` every render

  const copies =
    kind === 'payment'
      ? [{ fill: colors.dupYellow, edge: colors.dupYellowEdge }]
      : [
          { fill: colors.dupPink, edge: colors.dupPinkEdge },
          { fill: colors.dupYellow, edge: colors.dupYellowEdge },
        ];

  return (
    <View style={style}>
      {copies
        .map((c, i) => {
          const v = i === 0 ? first : second;
          const [x, y, deg] = REST[i];
          const [ax, ay, adeg] = AWAY[leaving ?? 'peel'][i];
          const lerp = (from: number, to: number) => v.interpolate({ inputRange: [0, 1], outputRange: [from, to] });
          // Opacity fades a little ahead of the slide (220 ms of the 320 ms), as the CSS transitions do.
          const opacity = v.interpolate({ inputRange: [0, motion.duration.base / motion.duration.screen, 1], outputRange: [1, 0, 0] });
          return (
            <Animated.View
              key={i}
              pointerEvents="none"
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                right: 0,
                bottom: 0,
                backgroundColor: c.fill,
                borderWidth: size.hairline,
                borderTopWidth: 0,
                borderColor: c.edge,
                borderBottomLeftRadius: radius.sheet,
                borderBottomRightRadius: radius.sheet,
                opacity: reduced ? v.interpolate({ inputRange: [0, 1], outputRange: [1, 0] }) : opacity,
                transform: reduced
                  ? [{ translateX: x }, { translateY: y }, { rotate: `${deg}deg` }]
                  : [
                      { translateX: lerp(x, ax) },
                      { translateY: lerp(y, ay) },
                      { rotate: v.interpolate({ inputRange: [0, 1], outputRange: [`${deg}deg`, `${adeg}deg`] }) },
                    ],
              }}
            >
              <Perforation color={c.edge} />
            </Animated.View>
          );
        })
        .reverse() /* the triplicate lies lowest */}
      {children}
    </View>
  );
}
