import { Tabs } from 'expo-router/js-tabs';
import { useTheme } from '../../src/theme/ThemeProvider';
import { TabBar, type TabName } from '../../src/ui/TabBar';

/** Home · Notifications · Transactions · Profile, with the app's own tab bar (specs § 3.1). */
export default function TabsLayout() {
  const { colors } = useTheme();
  return (
    <Tabs
      screenOptions={{ headerShown: false, sceneStyle: { backgroundColor: colors.ground } }}
      tabBar={({ state, emitter, navigateToTab }) => (
        <TabBar
          active={state.routes[state.index].name as TabName}
          onSelect={(name) => {
            const route = state.routes.find((r) => r.name === name)!;
            // The standard tab press: lets a screen scroll to top (`useScrollToTop`) when its own tab is pressed again.
            const event = emitter.emit({ type: 'tabPress', target: route.key, canPreventDefault: true });
            if (state.routes[state.index].key !== route.key && !event.defaultPrevented) navigateToTab(route.key);
          }}
        />
      )}
    >
      <Tabs.Screen name="index" />
      <Tabs.Screen name="notifications" />
      <Tabs.Screen name="transactions" />
      <Tabs.Screen name="profile" />
    </Tabs>
  );
}
