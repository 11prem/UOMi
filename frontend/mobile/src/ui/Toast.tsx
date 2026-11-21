import { useEffect, useRef } from 'react';
import { AccessibilityInfo, Animated, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { create } from 'zustand';
import { useTheme } from '../theme/ThemeProvider';
import { lift, motion } from '../theme/tokens';
import { easeOut, nativeDriver, size } from './metrics';
import { useReducedMotion } from './useReducedMotion';

const store = create<{ id: number; message: string | null }>(() => ({ id: 0, message: null }));

/** Shows a short confirmation ("Expense added"). Callable outside React (the session store uses it); a new toast replaces the old. */
export function toast(message: string) {
  store.setState((s) => ({ id: s.id + 1, message }));
  AccessibilityInfo.announceForAccessibility(message);
}

export const useToast = () => toast;

/** Mounted once in the root layout, above every screen: ink on ground, bottom centre, above the tab bar (`aboveTabs`) or the FAB. */
export function ToastHost({ aboveTabs }: { aboveTabs?: boolean }) {
  const { colors, type, space, radius, scheme } = useTheme();
  const reduced = useReducedMotion();
  const insets = useSafeAreaInsets();
  const { id, message } = store();
  const t = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!message) return;
    t.setValue(0);
    Animated.timing(t, { toValue: 1, duration: motion.duration.base, easing: easeOut, useNativeDriver: nativeDriver }).start();
    const hide = setTimeout(
      () =>
        Animated.timing(t, { toValue: 0, duration: motion.duration.fast, easing: easeOut, useNativeDriver: nativeDriver }).start(
          ({ finished }) => finished && store.getState().id === id && store.setState({ message: null }),
        ),
      Math.max(3500, message.length * 70),
    );
    return () => clearTimeout(hide);
  }, [id, message, t]);

  if (!message) return null;
  // app.js `toast()`: 12 px above the tab bar, or clear of a 60 px FAB on screens without one.
  const bottom = insets.bottom + (aboveTabs ? size.tabBar + space.s3 : size.fab + space.s4 + space.s2);
  return (
    <View pointerEvents="none" style={{ position: 'absolute', left: space.s4, right: space.s4, bottom, alignItems: 'center' }}>
      <Animated.View
        style={{
          backgroundColor: colors.ink,
          borderRadius: radius.sheet,
          paddingVertical: space.s3,
          paddingHorizontal: space.s4,
          boxShadow: lift[scheme].lift2,
          opacity: t,
          transform: reduced ? [] : [{ translateY: t.interpolate({ inputRange: [0, 1], outputRange: [12, 0] }) }],
        }}
      >
        <Text style={[type.body, { color: colors.ground }]}>{message}</Text>
      </Animated.View>
    </View>
  );
}
