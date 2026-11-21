import { useEffect, useRef, useState } from 'react';
import { Animated, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { useTheme } from '../theme/ThemeProvider';
import { motion } from '../theme/tokens';
import { easeOut, nativeDriver, size } from './metrics';
import { useReducedMotion } from './useReducedMotion';

export type StampProps = {
  /** AGREED, RECEIVED, SETTLED, REJECTED, NOT RECEIVED (set in caps by the stamp type role). */
  label: string;
  /** Carbon for agreed / settled / received, stamp red for rejected / not received. */
  red?: boolean;
  /** Press it down when it mounts: 220 ms from 1.35× at −18° to rest at −12°, ease-out, no overshoot (crossfade under reduced motion). */
  land?: boolean;
  /** The small in-text variant: 2 px ring, −4°, in the flow. */
  inline?: boolean;
  /** The 80 px stamp is absolutely positioned; place it with `top` / `right` from the theme's spacing. */
  style?: StyleProp<ViewStyle>;
};

const REST = 0.88;
const RING = 2.5;
const CAP = 1.2; // a fixed 80 px circle: past 1.2× system text the lettering would only shrink anyway
// Lettering may run the stamp's full width, as in the prototype (REJECTED is 79 px at 12 px); wider labels shrink to fit.
const LETTER_BOX = size.stamp;

/** The round rubber stamp (DESIGN.md § Rubber Stamp): ink only, double ring, rotated −12°. */
export function Stamp({ label, red, land, inline, style }: StampProps) {
  const { colors, type, space } = useTheme();
  const reduced = useReducedMotion();
  const t = useRef(new Animated.Value(land ? 0 : 1)).current;
  const ink = red ? colors.stampRed : colors.stampAgreed;
  // The label's natural one-line width, measured once; only a label wider than the stamp (NOT RECEIVED, or big system
  // text) shrinks. Measured rather than adjustsFontSizeToFit, which react-native-web doesn't support.
  const [natural, setNatural] = useState(0);
  const fit = natural > LETTER_BOX ? LETTER_BOX / natural : 1;

  useEffect(() => {
    if (!land) return;
    Animated.timing(t, {
      toValue: 1,
      duration: reduced ? motion.duration.fast : motion.duration.base,
      easing: easeOut,
      useNativeDriver: nativeDriver,
    }).start();
  }, [land, reduced, t]);

  if (inline) {
    return (
      <View style={[{ alignSelf: 'flex-start', borderWidth: 2, borderColor: ink, borderRadius: size.stamp, paddingVertical: 2, paddingHorizontal: space.s2, opacity: REST, transform: [{ rotate: '-4deg' }] }, style]}>
        <Text style={[type.stamp, { color: ink }]} numberOfLines={1}>
          {label}
        </Text>
      </View>
    );
  }

  const motionStyle = reduced
    ? { opacity: t.interpolate({ inputRange: [0, 1], outputRange: [0, REST] }), transform: [{ rotate: '-12deg' }] }
    : {
        opacity: t.interpolate({ inputRange: [0, 1], outputRange: [0, REST] }),
        transform: [
          { rotate: t.interpolate({ inputRange: [0, 1], outputRange: ['-18deg', '-12deg'] }) },
          { scale: t.interpolate({ inputRange: [0, 1], outputRange: [1.35, 1] }) },
        ],
      };

  return (
    <Animated.View
      pointerEvents="none"
      style={[
        {
          position: 'absolute',
          width: size.stamp,
          height: size.stamp,
          borderRadius: size.stamp / 2,
          borderWidth: RING,
          borderColor: ink,
        },
        motionStyle,
        style,
      ]}
    >
      <View style={{ position: 'absolute', top: space.s1, left: space.s1, right: space.s1, bottom: space.s1, borderRadius: size.stamp / 2, borderWidth: 1, borderColor: ink, opacity: 0.8 }} />
      <View aria-hidden style={{ position: 'absolute', left: -LETTER_BOX, width: LETTER_BOX * 3, opacity: 0, alignItems: 'flex-start' }}>
        <Text style={type.stamp} maxFontSizeMultiplier={CAP} numberOfLines={1} onLayout={(e) => setNatural(e.nativeEvent.layout.width)}>
          {label}
        </Text>
      </View>
      <View style={{ position: 'absolute', top: 0, bottom: 0, left: -RING, right: -RING, alignItems: 'center', justifyContent: 'center' }}>
        <Text
          numberOfLines={1}
          maxFontSizeMultiplier={CAP}
          style={[type.stamp, { color: ink, textAlign: 'center' }, fit < 1 && { fontSize: type.stamp.fontSize! * fit, letterSpacing: type.stamp.letterSpacing! * fit }]}
        >
          {label}
        </Text>
      </View>
    </Animated.View>
  );
}
