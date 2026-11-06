import { useState } from 'react';
import { Text, View } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import { prettyPhone } from '../../src/domain/phone';
import { DebugSheet } from '../../src/features/debug/DebugSheet';
import { SettingsSection } from '../../src/features/profile/SettingsSection';
import { SectionHeading } from '../../src/features/space/SectionHeading';
import { qk } from '../../src/services/queries';
import { useServices } from '../../src/services/useServices';
import { useSession } from '../../src/state/session';
import { useTheme } from '../../src/theme/ThemeProvider';
import { Button } from '../../src/ui/Button';
import { confirm } from '../../src/ui/ConfirmDialog';
import { IconButton } from '../../src/ui/IconButton';
import { MemberPlate } from '../../src/ui/MemberPlate';
import { OfflineBanner } from '../../src/ui/OfflineBanner';
import { Screen } from '../../src/ui/Screen';
import { Sheet } from '../../src/ui/Sheet';
import { Skeleton } from '../../src/ui/Skeleton';
import { StateBox } from '../../src/ui/StateBox';
import { Wordmark } from '../../src/ui/Wordmark';

/** Profile (specs § 13; app.js `R.profile`): who you are, the settings, Log out. The wordmark's long press opens the debug menu (§ 14.1). */
export default function Profile() {
  const { colors, type, space } = useTheme();
  const services = useServices();
  const server = services.mode === 'server';
  const saved = useSession((s) => s.user); // what is already known; the stored profile replaces it when it arrives
  const profile = useQuery({ queryKey: qk.profile, queryFn: () => services.profile.get() });
  const prefs = useQuery({ queryKey: qk.preferences, queryFn: () => services.profile.getPreferences() });
  const [debugOpen, setDebugOpen] = useState(false);
  const me = profile.data ?? saved;
  // Server mode can't always read the preferences (the server may be unreachable): its settings are the defaults, locked, with no error to retry.
  const failed = profile.isError || (!server && prefs.isError);

  async function logout() {
    if (!(await confirm({ title: 'Log out of UOMi?', ok: 'Log out', danger: true }))) return;
    await services.auth.signOut().catch(() => {}); // signed out here even if a server can't be told
    useSession.getState().signedOut(); // lands on Welcome
  }

  return (
    <Screen tabs header={<OfflineBanner />}>
      <Wordmark onLongPress={() => setDebugOpen(true)} longPressLabel="Debug menu" />
      <Text accessibilityRole="header" style={[type.display, { color: colors.ink, paddingTop: space.s1, paddingBottom: space.s4 }]}>
        Profile
      </Text>
      {failed && (
        <StateBox
          kind="error"
          onRetry={() => {
            if (profile.isError) void profile.refetch();
            if (prefs.isError) void prefs.refetch();
          }}
        />
      )}

      {me ? (
        <Sheet padded style={{ flexDirection: 'row', alignItems: 'center', gap: space.s4, padding: space.s4 }}>
          <MemberPlate user={me} lg />
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={[type.title, { color: colors.ink }]}>{me.name}</Text>
            {!!me.phone && <Text style={[type.body, { color: colors.ink2, marginTop: space.s1 / 2 }]}>{prettyPhone(me.phone)}</Text>}
            <Text style={[type.label, { color: colors.ink2 }]}>{`@${me.username}`}</Text>
          </View>
          <IconButton icon="pencil" label="Edit profile" disabled={server} onPress={() => router.push('/profile-edit')} />
        </Sheet>
      ) : (
        !failed && <Skeleton rows={1} />
      )}
      {server && <Text style={[type.label, { color: colors.ink2, marginTop: space.s2 }]}>Editing your profile isn’t available on this server yet.</Text>}

      <SectionHeading>Settings</SectionHeading>
      {prefs.data || server ? <SettingsSection prefs={prefs.data} server={server} /> : !prefs.isError && <Skeleton rows={3} />}

      <View style={{ marginTop: space.s6 + space.s1 }}>
        <Button variant="danger" icon="logout" label="Log out" onPress={() => void logout()} />
      </View>

      <DebugSheet visible={debugOpen} onClose={() => setDebugOpen(false)} />
    </Screen>
  );
}
