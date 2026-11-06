import { useEffect, useRef } from 'react';
import { Animated, Pressable, Text, View, useWindowDimensions } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { qk } from '../services/queries';
import { useServices } from '../services/useServices';
import { useTheme } from '../theme/ThemeProvider';
import { motion } from '../theme/tokens';
import { Icon, type IconName } from './Icon';
import { FONT_CAP, easeOut, nativeDriver, size } from './metrics';
import { useReducedMotion } from './useReducedMotion';

export type TabName = 'index' | 'notifications' | 'transactions' | 'profile';

const TABS: { name: TabName; icon: IconName; label: string }[] = [
  { name: 'index', icon: 'home', label: 'Home' },
  { name: 'notifications', icon: 'bell', label: 'Notifications' },
  { name: 'transactions', icon: 'receipt', label: 'Transactions' },
  { name: 'profile', icon: 'user', label: 'Profile' },
];

/** Where each tab lives. */
export const TAB_HREF = { index: '/', notifications: '/notifications', transactions: '/transactions', profile: '/profile' } as const;

export type TabBarProps = {
  /** The current tab; `null` on a screen that shows the bar but is not a tab. */
  active: TabName | null;
  /** Defaults to popping back to the tabs on that tab (`router.dismissTo`), for a bar shown above the tabs (the Space Page). */
  onSelect?: (tab: TabName) => void;
};

/**
 * The four-tab bar (DESIGN.md § Navigation): icon over label, carbon when active with a 2 px indicator that scales in,
 * an 8 px owe dot on the bell while anything is unread. Labels are capped at 1.5× font scale (Review Focus 5).
 */
export function TabBar({ active, onSelect = (tab) => router.dismissTo(TAB_HREF[tab]) }: TabBarProps) {
  const { colors, type, space } = useTheme();
  const insets = useSafeAreaInsets();
  const narrow = useWindowDimensions().width < 360; // app.css: 12 px labels below 360 wide
  const services = useServices();
  const unread = useQuery({ queryKey: qk.unread, queryFn: () => services.notifications.unreadCount() }).data ?? 0;

  return (
    <View
      accessibilityRole="tablist"
      style={{
        flexDirection: 'row',
        height: size.tabBar + insets.bottom,
        paddingBottom: insets.bottom,
        backgroundColor: colors.sheet,
        borderTopWidth: size.hairline,
        borderTopColor: colors.hair,
      }}
    >
      {TABS.map((t) => {
        const on = t.name === active;
        const ink = on ? colors.carbon : colors.ink2;
        const dot = t.name === 'notifications' && unread > 0;
        return (
          <Pressable
            key={t.name}
            accessibilityRole="tab"
            accessibilityLabel={dot ? `${t.label}, ${unread} unread` : t.label}
            accessibilityState={{ selected: on }}
            onPress={() => onSelect(t.name)}
            style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 2 }}
          >
            <Indicator on={on} />
            <Icon name={t.icon} color={ink} />
            {dot && (
              <View
                style={{
                  position: 'absolute',
                  top: space.s2 - 2,
                  left: '50%',
                  marginLeft: space.s1,
                  width: size.dot + 4,
                  height: size.dot + 4,
                  borderRadius: (size.dot + 4) / 2,
                  borderWidth: 2,
                  borderColor: colors.sheet,
                  backgroundColor: colors.owe,
                }}
              />
            )}
            <Text
              maxFontSizeMultiplier={FONT_CAP}
              numberOfLines={1}
              adjustsFontSizeToFit
              minimumFontScale={0.75}
              style={[type.label, { lineHeight: 16, color: ink, paddingHorizontal: 2 }, narrow && { fontSize: 12 }]}
            >
              {t.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/** The 2 px carbon line along the active tab's top edge, scaling in over 220 ms (instant under reduced motion). */
function Indicator({ on }: { on: boolean }) {
  const { colors } = useTheme();
  const reduced = useReducedMotion();
  const s = useRef(new Animated.Value(on ? 1 : 0)).current;
  useEffect(() => {
    Animated.timing(s, { toValue: on ? 1 : 0, duration: reduced ? 0 : motion.duration.base, easing: easeOut, useNativeDriver: nativeDriver }).start();
  }, [on, reduced, s]);
  return (
    <Animated.View
      style={{ position: 'absolute', top: -1, left: '30%', right: '30%', height: 2, borderRadius: 2, backgroundColor: colors.carbon, transform: [{ scaleX: s }] }}
    />
  );
}
