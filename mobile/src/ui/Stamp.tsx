import { useEffect, useRef } from 'react';
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

/** The round rubber stamp (DESIGN.md § Rubber Stamp): ink only, double ring, rotated −12°. */
export function Stamp({ label, red, land, inline, style }: StampProps) {
  const { colors, type, space } = useTheme();
  const reduced = useReducedMotion();
  const t = useRef(new Animated.Value(land ? 0 : 1)).current;
  const ink = red ? colors.stampRed : colors.stampAgreed;

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
        <Text style={[type.stamp, { color: ink }]}>{label}</Text>
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
          borderWidth: 2.5,
          borderColor: ink,
          paddingHorizontal: space.s2 + 2,
          alignItems: 'center',
          justifyContent: 'center',
        },
        motionStyle,
        style,
      ]}
    >
      <View style={{ position: 'absolute', top: space.s1, left: space.s1, right: space.s1, bottom: space.s1, borderRadius: size.stamp / 2, borderWidth: 1, borderColor: ink, opacity: 0.8 }} />
      {/* A fixed 80 px circle: the lettering shrinks to fit rather than grow out of the ring. */}
      <Text style={[type.stamp, { color: ink, textAlign: 'center' }]} maxFontSizeMultiplier={1.2} adjustsFontSizeToFit numberOfLines={2}>
        {label}
      </Text>
    </Animated.View>
  );
}
