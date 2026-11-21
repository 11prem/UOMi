import { Text, View } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
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
import { Screen } from '../../src/ui/Screen';
import { Sheet } from '../../src/ui/Sheet';
import { Skeleton } from '../../src/ui/Skeleton';
import { StateBox } from '../../src/ui/StateBox';
import { Wordmark } from '../../src/ui/Wordmark';

/** Profile (specs § 13; app.js `R.profile`): who you are, the settings, Log out. */
export default function Profile() {
  const { colors, type, space } = useTheme();
  const services = useServices();
  const saved = useSession((s) => s.user); // what is already known; the stored profile replaces it when it arrives
  const profile = useQuery({ queryKey: qk.profile, queryFn: () => services.profile.get() });
  const prefs = useQuery({ queryKey: qk.preferences, queryFn: () => services.profile.getPreferences() });
  const me = profile.data ?? saved;
  const failed = profile.isError || prefs.isError;

  async function logout() {
    if (!(await confirm({ title: 'Log out of UOMi?', ok: 'Log out', danger: true }))) return;
    await services.auth.signOut().catch(() => {}); // signed out here even if a server can't be told
    useSession.getState().signedOut(); // lands on Welcome
  }

  return (
    <Screen tabs>
      <Wordmark />
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
            {!!me.email && <Text style={[type.body, { color: colors.ink2, marginTop: space.s1 / 2 }]}>{me.email}</Text>}
            <Text style={[type.label, { color: colors.ink2 }]}>{`@${me.username}`}</Text>
          </View>
          <IconButton icon="pencil" label="Edit profile" onPress={() => router.push('/profile-edit')} />
        </Sheet>
      ) : (
        !failed && <Skeleton rows={1} />
      )}

      <SectionHeading>Settings</SectionHeading>
      {prefs.data ? <SettingsSection prefs={prefs.data} /> : !prefs.isError && <Skeleton rows={3} />}

      <View style={{ marginTop: space.s6 + space.s1 }}>
        <Button variant="danger" icon="logout" label="Log out" onPress={() => void logout()} />
      </View>
    </Screen>
  );
}
