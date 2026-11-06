import { useState } from 'react';
import { Text, View } from 'react-native';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import type { User } from '../../domain/types';
import { qk } from '../../services/queries';
import type { Services } from '../../services/types';
import { useServices } from '../../services/useServices';
import { useSession } from '../../state/session';
import { useTheme } from '../../theme/ThemeProvider';
import { BottomSheet } from '../../ui/BottomSheet';
import { Button } from '../../ui/Button';
import { confirm } from '../../ui/ConfirmDialog';
import { Icon } from '../../ui/Icon';
import { MemberPlate } from '../../ui/MemberPlate';
import { size } from '../../ui/metrics';
import { Press } from '../../ui/Press';
import { Rows } from '../../ui/Rows';
import { ServerSettingsSheet } from '../../ui/ServerSettingsSheet';
import { Switch } from '../../ui/Switch';
import { toast } from '../../ui/Toast';

type Debug = NonNullable<Services['debug']>;

function Heading({ children }: { children: string }) {
  const { colors, type, space } = useTheme();
  return (
    <Text accessibilityRole="header" style={[type.serial, { color: colors.ink2, paddingTop: space.s4, paddingBottom: space.s2 }]}>
      {children}
    </Text>
  );
}

function SwitchRow({ label, value, onValueChange }: { label: string; value: boolean; onValueChange: (v: boolean) => void }) {
  const { colors, type, space } = useTheme();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.s3, minHeight: size.row, padding: space.s3 }}>
      <Text style={[type.body, { color: colors.ink, flex: 1 }]}>{label}</Text>
      <Switch label={label} value={value} onValueChange={onValueChange} />
    </View>
  );
}

/** One person to act as: their plate, name and @username; the current one is marked and tinted. */
function PersonRow({ person, current, onPress }: { person: User; current: boolean; onPress: () => void }) {
  const { colors, type, space } = useTheme();
  return (
    <Press
      onPress={onPress}
      accessibilityLabel={`Act as ${person.name}`}
      accessibilityState={{ selected: current }}
      scaleTo={1}
      style={[{ flexDirection: 'row', alignItems: 'center', gap: space.s3, minHeight: size.row, padding: space.s3 }, current && { backgroundColor: colors.carbonWash }]}
      pressedStyle={{ backgroundColor: colors.carbonWash }}
    >
      <MemberPlate user={person} />
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={[type.body, { color: colors.ink }]} numberOfLines={1}>
          {person.name}
        </Text>
        <Text style={[type.label, { color: colors.ink2 }]}>{`@${person.username}`}</Text>
      </View>
      {current && <Text style={[type.label, { color: colors.carbon }]}>Current</Text>}
    </Press>
  );
}

/** Demo only: act as any seeded person, flip the error and offline switches, put the seed back. */
function DemoControls({ debug, onClose }: { debug: Debug; onClose: () => void }) {
  const { colors, type, space } = useTheme();
  const queryClient = useQueryClient();
  const me = useSession((s) => s.user);
  const people = useQuery({ queryKey: [...qk.debug, 'users'], queryFn: () => debug.users() });
  // The same key and shape as the OfflineBanner's read, so the banner follows the switch.
  const flags = useQuery({ queryKey: qk.debug, queryFn: () => debug.state() });

  const setFlag = useMutation({
    mutationFn: ({ key, on }: { key: 'simulateErrors' | 'offline'; on: boolean }) => (key === 'offline' ? debug.setOffline(on) : debug.setSimulateErrors(on)),
    // Every screen asks again, so the error or offline state shows (or clears) without leaving it.
    onSettled: () => queryClient.invalidateQueries(),
  });
  const flag = (key: 'simulateErrors' | 'offline') => (setFlag.isPending && setFlag.variables.key === key ? setFlag.variables.on : !!flags.data?.[key]);

  async function actAs(person: User) {
    if (person.id === me?.id) return onClose();
    try {
      const user = await debug.actAs(person.id);
      onClose();
      // Not `signedIn`: it clears the cache, which orphans the tabs that stay mounted (they would keep the last person's
      // data on screen). Resetting empties every query in place and makes the mounted screens ask again as the new viewer.
      useSession.setState({ user });
      void queryClient.resetQueries();
      router.navigate('/');
      toast(`Now acting as ${user.name}`);
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Couldn’t switch person');
    }
  }

  async function reset() {
    onClose(); // before asking: a dialog opened over this sheet can land underneath it (react-native-web stacks modals in mount order)
    const ok = await confirm({
      title: 'Reset demo data?',
      body: 'Everything goes back to the sample data and you’ll be signed out. Your theme stays.',
      ok: 'Reset',
      danger: true,
    });
    if (!ok) return;
    // The switches are in-memory flags the reset doesn't touch, and Welcome can't reach this menu: left on, sign-in would fail there.
    await debug.setSimulateErrors(false);
    await debug.setOffline(false);
    await debug.resetDemoData();
    useSession.getState().signedOut('Demo data reset'); // back to Welcome, cache cleared
  }

  return (
    <>
      <Text style={[type.label, { color: colors.ink2, fontFamily: type.body.fontFamily }]}>
        Act as another person to answer shares and confirm payments on one phone.
      </Text>
      <Heading>Act as</Heading>
      {people.data ? (
        <Rows nested>
          {people.data.map((p) => (
            <PersonRow key={p.id} person={p} current={p.id === me?.id} onPress={() => void actAs(p)} />
          ))}
        </Rows>
      ) : (
        !people.isError && <Text style={[type.label, { color: colors.ink2 }]}>Loading people…</Text>
      )}
      <Heading>States</Heading>
      <Rows nested>
        <SwitchRow label="Simulate load errors" value={flag('simulateErrors')} onValueChange={(on) => setFlag.mutate({ key: 'simulateErrors', on })} />
        <SwitchRow label="Simulate offline" value={flag('offline')} onValueChange={(on) => setFlag.mutate({ key: 'offline', on })} />
      </Rows>
      <View style={{ marginTop: space.s4 }}>
        <Button variant="danger" label="Reset demo data" onPress={() => void reset()} />
      </View>
    </>
  );
}

/**
 * The hidden debug menu (specs § 14.1), opened by long-pressing the Profile wordmark. Demo mode: Act as…, the error and
 * offline switches, Reset demo data. Server mode (no `debug` service): only Server settings, which is always there.
 */
export function DebugSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const { colors, type, space } = useTheme();
  const debug = useServices().debug;
  const mode = useSession((s) => s.mode);
  const serverUrl = useSession((s) => s.serverUrl);
  const [serverOpen, setServerOpen] = useState(false);

  return (
    <>
      <BottomSheet visible={visible} onClose={onClose} title="Debug menu">
        {debug && <DemoControls debug={debug} onClose={onClose} />}
        <Heading>Server</Heading>
        <Rows nested>
          <Press
            accessibilityLabel="Server settings"
            onPress={() => {
              onClose();
              setServerOpen(true); // a sibling sheet, not one inside this one
            }}
            scaleTo={1}
            style={{ flexDirection: 'row', alignItems: 'center', gap: space.s3, minHeight: size.row, padding: space.s3 }}
            pressedStyle={{ backgroundColor: colors.carbonWash }}
          >
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={[type.body, { color: colors.ink }]}>Server settings</Text>
              <Text style={[type.label, { color: colors.ink2 }]} numberOfLines={1}>
                {mode === 'server' ? `Server mode · ${serverUrl}` : 'Demo mode'}
              </Text>
            </View>
            <Icon name="chev" size="sm" color={colors.ink2} />
          </Press>
        </Rows>
      </BottomSheet>
      <ServerSettingsSheet visible={serverOpen} onClose={() => setServerOpen(false)} />
    </>
  );
}
