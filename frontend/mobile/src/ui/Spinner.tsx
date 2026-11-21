import { useEffect, useRef } from 'react';
import { Animated, Easing } from 'react-native';
import { nativeDriver, size } from './metrics';
import { useReducedMotion } from './useReducedMotion';

/** The 18 px ring spinner a busy button shows instead of its label (`.btn .spin`; slower under reduced motion). */
export function Spinner({ color }: { color: string }) {
  const reduced = useReducedMotion();
  const turn = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.timing(turn, { toValue: 1, duration: reduced ? 1600 : 700, easing: Easing.linear, useNativeDriver: nativeDriver }),
    );
    loop.start();
    return () => loop.stop();
  }, [reduced, turn]);
  const rotate = turn.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] });
  return (
    <Animated.View
      accessibilityElementsHidden
      importantForAccessibility="no"
      style={{
        width: size.spinner,
        height: size.spinner,
        borderRadius: size.spinner / 2,
        borderWidth: 2,
        borderColor: color,
        borderRightColor: 'transparent',
        transform: [{ rotate }],
      }}
    />
  );
}
