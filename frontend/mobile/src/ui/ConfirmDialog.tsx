import { useEffect, useRef } from 'react';
import { Animated, Modal, Pressable, Text, View } from 'react-native';
import { create } from 'zustand';
import { useTheme } from '../theme/ThemeProvider';
import { lift, motion } from '../theme/tokens';
import { Button } from './Button';
import { easeOut, nativeDriver } from './metrics';
import { useReducedMotion } from './useReducedMotion';

export type ConfirmOptions = {
  /** Names what will happen: "Delete ‘Dinner’?", "Log out of UOMi?" (specs § 3.5). */
  title: string;
  body?: string;
  /** The confirming action's label ("Delete", "Discard"). */
  ok: string;
  cancel?: string;
  /** Red confirm label for destructive actions. */
  danger?: boolean;
};

type Pending = ConfirmOptions & { resolve: (ok: boolean) => void };
const store = create<{ pending: Pending | null }>(() => ({ pending: null }));

/** Asks, and resolves `true` only for the confirming action (Cancel, the scrim and Android Back resolve `false`). */
export function confirm(options: ConfirmOptions): Promise<boolean> {
  return new Promise((resolve) => {
    store.getState().pending?.resolve(false); // one dialog at a time
    store.setState({ pending: { ...options, resolve } });
  });
}

export const useConfirm = () => confirm;

function answer(ok: boolean) {
  const p = store.getState().pending;
  store.setState({ pending: null });
  p?.resolve(ok);
}

/** Mounted once in the root layout. The dialog of app.js `confirmDialog`: title, body, text buttons right-aligned. */
export function ConfirmHost() {
  const { colors, type, space, radius, scheme } = useTheme();
  const reduced = useReducedMotion();
  const pending = store((s) => s.pending);
  const t = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!pending) return;
    t.setValue(0);
    Animated.timing(t, { toValue: 1, duration: motion.duration.base, easing: easeOut, useNativeDriver: nativeDriver }).start();
  }, [pending, t]);

  return (
    <Modal visible={!!pending} transparent statusBarTranslucent navigationBarTranslucent animationType="none" onRequestClose={() => answer(false)}>
      <Animated.View style={{ flex: 1, justifyContent: 'center', backgroundColor: colors.scrim, opacity: t }}>
        <Pressable style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }} onPress={() => answer(false)} accessible={false} />
        {pending && (
          <Animated.View
            accessibilityRole="alert"
            accessibilityViewIsModal
            style={{
              marginHorizontal: space.s6 + space.s1, // 28 px (`.dialog`)
              padding: space.s5,
              paddingBottom: space.s3,
              borderRadius: radius.sheet,
              borderWidth: 1,
              borderColor: colors.hair,
              backgroundColor: colors.sheet,
              boxShadow: lift[scheme].lift3,
              transform: reduced ? [] : [{ scale: t.interpolate({ inputRange: [0, 1], outputRange: [0.96, 1] }) }],
            }}
          >
            <Text style={[type.title, { color: colors.ink }]} accessibilityRole="header">
              {pending.title}
            </Text>
            {!!pending.body && <Text style={[type.body, { color: colors.ink2, marginTop: space.s2 }]}>{pending.body}</Text>}
            <View style={{ flexDirection: 'row', justifyContent: 'flex-end', gap: space.s2, marginTop: space.s4 }}>
              <Button variant="text" label={pending.cancel ?? 'Cancel'} onPress={() => answer(false)} />
              <Button variant="text" danger={pending.danger} label={pending.ok} onPress={() => answer(true)} />
            </View>
          </Animated.View>
        )}
      </Animated.View>
    </Modal>
  );
}
