import { useQuery } from '@tanstack/react-query';
import { Text, View } from 'react-native';
import { qk } from '../services/queries';
import { useServices } from '../services/useServices';
import { useTheme } from '../theme/ThemeProvider';
import { Icon } from './Icon';

/**
 * Demo mode's simulated offline switch (debug menu). Server mode has no offline state of its own: a failed request
 * shows the screen's Error state instead (Review Focus 1). Invalidate `qk.debug` after changing the switch.
 */
export function useOffline(): boolean {
  const services = useServices();
  const { data } = useQuery({
    queryKey: qk.debug,
    queryFn: async () => (await services.debug?.state()) ?? { simulateErrors: false, offline: false },
  });
  return !!data?.offline;
}

/** "You’re offline — showing last saved data", on the duplicate yellow, at the top of a data screen (specs § 3.2). */
export function OfflineBanner() {
  const { colors, type, space, radius, scheme } = useTheme();
  const offline = useOffline();
  if (!offline) return null;
  const ink = scheme === 'dark' ? colors.ink : colors.onBadge;
  return (
    <View
      accessibilityLiveRegion="polite"
      style={{
        marginHorizontal: space.s4,
        marginBottom: space.s2,
        paddingVertical: space.s2 + 2,
        paddingHorizontal: space.s3,
        borderRadius: radius.sheet,
        backgroundColor: colors.dupYellow,
        flexDirection: 'row',
        alignItems: 'center',
        gap: space.s2,
      }}
    >
      <Icon name="wifioff" size="sm" color={ink} />
      <Text style={[type.label, { color: ink, flex: 1 }]}>You’re offline — showing last saved data</Text>
    </View>
  );
}
