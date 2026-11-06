import { useEffect, useRef } from 'react';
import { Animated, Pressable } from 'react-native';
import { useTheme } from '../theme/ThemeProvider';
import { lift, motion } from '../theme/tokens';
import { easeOut, nativeDriver, size } from './metrics';
import { useReducedMotion } from './useReducedMotion';

const TRAVEL = size.switchW - size.switchThumb - 6; // 20 px: 3 px inset each side
const SLOP = { top: (size.target - size.switchH) / 2, bottom: (size.target - size.switchH) / 2, left: 2, right: 2 };

/** The 52 × 32 switch (`.switch`): control-edge track, carbon when on, the thumb slides 220 ms on ease-out. */
export function Switch({ value, onValueChange, label, disabled }: { value: boolean; onValueChange: (v: boolean) => void; label: string; disabled?: boolean }) {
  const { colors, scheme } = useTheme();
  const reduced = useReducedMotion();
  const x = useRef(new Animated.Value(value ? 1 : 0)).current;

  useEffect(() => {
    Animated.timing(x, { toValue: value ? 1 : 0, duration: reduced ? 0 : motion.duration.base, easing: easeOut, useNativeDriver: nativeDriver }).start();
  }, [value, reduced, x]);

  return (
    <Pressable
      accessibilityRole="switch"
      accessibilityLabel={label}
      accessibilityState={{ checked: value, disabled: !!disabled }}
      disabled={disabled}
      hitSlop={SLOP}
      onPress={() => onValueChange(!value)}
      style={{
        width: size.switchW,
        height: size.switchH,
        borderRadius: size.switchH / 2,
        backgroundColor: value ? colors.carbon : colors.controlEdge,
        opacity: disabled ? 0.4 : 1,
      }}
    >
      <Animated.View
        style={{
          position: 'absolute',
          top: 3,
          left: 3,
          width: size.switchThumb,
          height: size.switchThumb,
          borderRadius: size.switchThumb / 2,
          backgroundColor: colors.sheet,
          boxShadow: lift[scheme].lift1,
          transform: [{ translateX: x.interpolate({ inputRange: [0, 1], outputRange: [0, TRAVEL] }) }],
        }}
      />
    </Pressable>
  );
}
