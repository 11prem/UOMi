import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Animated, KeyboardAvoidingView, Modal, Pressable, ScrollView, Text, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../theme/ThemeProvider';
import { motion } from '../theme/tokens';
import { IconButton } from './IconButton';
import { easeDrawer, nativeDriver, size } from './metrics';
import { useReducedMotion } from './useReducedMotion';

export type BottomSheetProps = {
  visible: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
};

/**
 * A sheet that rises from the bottom on the drawer curve (320 ms) over a fading scrim; 14 px top corners, a grab
 * handle, a title with a Close button, a scrolling body. Back, the scrim and Close all call `onClose`.
 * Lists inside use `<Rows nested>` / `<Sheet nested>` (sheet-2, no border).
 */
export function BottomSheet({ visible, onClose, title, children }: BottomSheetProps) {
  const { colors, type, space, radius } = useTheme();
  const reduced = useReducedMotion();
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  const t = useRef(new Animated.Value(0)).current;
  const [mounted, setMounted] = useState(visible);

  useEffect(() => {
    if (visible) setMounted(true);
    const duration = reduced ? motion.duration.fast : motion.duration.screen;
    Animated.timing(t, { toValue: visible ? 1 : 0, duration, easing: easeDrawer, useNativeDriver: nativeDriver }).start(
      ({ finished }) => finished && !visible && setMounted(false),
    );
  }, [visible, reduced, t]);

  return (
    <Modal visible={mounted} transparent statusBarTranslucent navigationBarTranslucent animationType="none" onRequestClose={onClose}>
      <KeyboardAvoidingView behavior="padding" style={{ flex: 1, justifyContent: 'flex-end' }}>
        <Animated.View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: colors.scrim, opacity: t }}>
          <Pressable style={{ flex: 1 }} onPress={onClose} accessible={false} />
        </Animated.View>
        <Animated.View
          accessibilityViewIsModal
          style={{
            maxHeight: '86%',
            backgroundColor: colors.sheet,
            borderTopLeftRadius: radius.bottomSheet,
            borderTopRightRadius: radius.bottomSheet,
            paddingTop: space.s2,
            paddingBottom: insets.bottom + space.s2,
            opacity: reduced ? t : 1,
            transform: reduced ? [] : [{ translateY: t.interpolate({ inputRange: [0, 1], outputRange: [height, 0] }) }],
          }}
        >
          <View style={{ width: size.grab.w, height: size.grab.h, borderRadius: size.grab.h / 2, backgroundColor: colors.hairStrong, alignSelf: 'center', marginBottom: space.s2 }} />
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingLeft: space.s4, paddingRight: space.s2, paddingBottom: space.s2 }}>
            <Text style={[type.title, { color: colors.ink, flex: 1 }]} accessibilityRole="header">
              {title}
            </Text>
            <IconButton icon="x" label="Close" onPress={onClose} />
          </View>
          <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingHorizontal: space.s4, paddingBottom: space.s2 }}>
            {children}
          </ScrollView>
        </Animated.View>
      </KeyboardAvoidingView>
    </Modal>
  );
}
