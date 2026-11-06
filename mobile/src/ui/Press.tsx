import { useRef, useState, type ReactNode } from 'react';
import { Animated, Pressable, type PressableProps, type StyleProp, type ViewStyle } from 'react-native';
import { motion } from '../theme/tokens';
import { easeOut, nativeDriver } from './metrics';
import { useReducedMotion } from './useReducedMotion';

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

export type PressProps = Omit<PressableProps, 'style' | 'children'> & {
  children?: ReactNode;
  style?: StyleProp<ViewStyle>;
  /** Added while the finger is down (the pressed tint). */
  pressedStyle?: StyleProp<ViewStyle>;
  /** Press compression: 0.98 for buttons, 0.94 icon buttons / FAB, 0.92 answer controls (DESIGN.md). */
  scaleTo?: number;
};

/** The base of every pressable control: 120 ms compression on ease-out, a pressed tint, 40 % opacity when disabled. */
export function Press({ scaleTo = 0.98, style, pressedStyle, disabled, onPressIn, onPressOut, children, ...rest }: PressProps) {
  const reduced = useReducedMotion();
  const scale = useRef(new Animated.Value(1)).current;
  const [pressed, setPressed] = useState(false);
  const to = (toValue: number) =>
    Animated.timing(scale, { toValue, duration: motion.duration.press, easing: easeOut, useNativeDriver: nativeDriver }).start();

  return (
    <AnimatedPressable
      accessibilityRole="button"
      {...rest}
      disabled={disabled}
      accessibilityState={{ disabled: !!disabled, ...rest.accessibilityState }}
      onPressIn={(e) => {
        setPressed(true);
        if (!reduced) to(scaleTo); // reduced motion: the tint alone is the feedback
        onPressIn?.(e);
      }}
      onPressOut={(e) => {
        setPressed(false);
        to(1);
        onPressOut?.(e);
      }}
      style={[style, pressed && pressedStyle, disabled && { opacity: 0.4 }, { transform: [{ scale }] }]}
    >
      {children}
    </AnimatedPressable>
  );
}
