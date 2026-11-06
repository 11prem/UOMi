import { useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import type { User } from '../../src/domain/types';
import { backToSpaceName, endSpaceDraft, useSpaceDraft, validSpaceName } from '../../src/features/space/draft';
import { SectionHeading } from '../../src/features/space/SectionHeading';
import { Tag } from '../../src/features/space/Tag';
import { qk } from '../../src/services/queries';
import { useServices } from '../../src/services/useServices';
import { useSession } from '../../src/state/session';
import { useTheme } from '../../src/theme/ThemeProvider';
import { AppBar } from '../../src/ui/AppBar';
import { Fab } from '../../src/ui/Fab';
import { Icon } from '../../src/ui/Icon';
import { IconButton } from '../../src/ui/IconButton';
import { MemberPlate } from '../../src/ui/MemberPlate';
import { size } from '../../src/ui/metrics';
import { OfflineBanner } from '../../src/ui/OfflineBanner';
import { LedgerRow, Rows } from '../../src/ui/Rows';
import { Screen } from '../../src/ui/Screen';
import { Skeleton } from '../../src/ui/Skeleton';
import { StateBox } from '../../src/ui/StateBox';
import { TextField } from '../../src/ui/TextField';
import { toast } from '../../src/ui/Toast';
import { useDiscardGuard } from '../../src/ui/useDiscardGuard';

/**
 * Create Space step 2 (specs § 6.2; app.js `R.addPeople`): search by whole phone number or username prefix 300 ms after
 * typing stops, a numbered members list with "You" first, ✓ once someone else is added. Back keeps the pop-up's draft.
 */
export default function AddPeople() {
  const { colors, type, space } = useTheme();
  const services = useServices();
  const queryClient = useQueryClient();
  const me = useSession((s) => s.user);
  const draft = useSpaceDraft();
  const [text, setText] = useState('');
  const [q, setQ] = useState('');
  const [picked, setPicked] = useState<User[]>([]);
  const leave = useDiscardGuard(picked.length > 0);
  useEffect(() => backToSpaceName, []); // leaving without creating reopens the pop-up on Home

  useEffect(() => {
    const t = setTimeout(() => setQ(text.trim()), 300);
    return () => clearTimeout(t);
  }, [text]);
  const search = useQuery({ queryKey: qk.userSearch(q), queryFn: () => services.users.search(q), enabled: q !== '' });

  const create = useMutation({
    mutationFn: () =>
      services.spaces.create({ name: draft.name, icon: draft.icon, currency: draft.currency ?? 'INR', memberIds: picked.map((u) => u.id) }),
    onSuccess: (s) => {
      queryClient.invalidateQueries({ queryKey: qk.spaces });
      endSpaceDraft();
      leave(() => router.replace(`/space/${s.id}`)); // Back from the new Space Page goes Home, not here
      toast('Space created');
    },
    onError: (e) => toast(e.message),
  });

  // Reached without the pop-up (a reload on the web): nothing to add people to.
  if (!validSpaceName(draft.name) || !me) {
    return (
      <Screen header={<AppBar title="New space" />}>
        <StateBox kind="empty" title="No space in progress" body="Start a new space from Home." action={{ label: 'Go to Home', onPress: () => router.replace('/') }} />
      </Screen>
    );
  }

  const add = (u: User) => setPicked((p) => (p.some((x) => x.id === u.id) ? p : [...p, u]));
  const number = (i: number) => <Text style={[type.label, { color: colors.ink2, minWidth: space.s5 }]}>{i}.</Text>;

  let results = null;
  if (q) {
    if (search.data?.length) {
      results = (
        <Rows>
          {search.data.map((u) => {
            const added = picked.some((x) => x.id === u.id);
            return (
              <LedgerRow
                key={u.id}
                left={<MemberPlate user={u} />}
                title={u.name}
                sub={`@${u.username}`}
                right={added ? <Text style={[type.label, { color: colors.ink2 }]}>Added</Text> : <Icon name="plus" size="sm" color={colors.carbon} />}
                onPress={added ? undefined : () => add(u)}
                accessibilityLabel={`Add ${u.name}, @${u.username}`}
              />
            );
          })}
        </Rows>
      );
    } else if (search.data) {
      results = <Text style={[type.body, { color: colors.ink2, paddingVertical: space.s2 }]}>No UOMi user found for ‘{q}’.</Text>;
    } else if (search.isError) {
      results = <StateBox kind="error" onRetry={() => search.refetch()} />;
    } else {
      results = <Skeleton rows={1} />;
    }
  }

  return (
    <Screen
      header={
        <>
          <AppBar title={draft.name} serial="New space" />
          <OfflineBanner />
        </>
      }
      fab={<Fab icon="check" label="Create space" onPress={() => create.mutate()} disabled={picked.length === 0 || create.isPending} />}
    >
      <TextField
        label="Find people"
        value={text}
        onChangeText={setText}
        placeholder="Phone number or username"
        helper="Search a whole phone number or a username."
        autoCapitalize="none"
        autoCorrect={false}
        autoComplete="off"
        autoFocus
        right={
          <View style={{ width: size.iconButton, alignItems: 'center' }}>
            <Icon name="search" size="sm" color={colors.ink2} />
          </View>
        }
      />
      <View accessibilityLiveRegion="polite">{results}</View>

      <SectionHeading>Members</SectionHeading>
      <Rows>
        <LedgerRow left={<View style={{ flexDirection: 'row', alignItems: 'center', gap: space.s2 }}>{number(1)}<MemberPlate user={me} /></View>} title="You" right={<Tag label="Owner" tone="owner" />} />
        {picked.map((u, i) => (
          <LedgerRow
            key={u.id}
            left={<View style={{ flexDirection: 'row', alignItems: 'center', gap: space.s2 }}>{number(i + 2)}<MemberPlate user={u} /></View>}
            title={u.name}
            sub={`@${u.username}`}
            right={<IconButton icon="x" iconSize="sm" label={`Remove ${u.name}`} onPress={() => setPicked((p) => p.filter((x) => x.id !== u.id))} />}
          />
        ))}
      </Rows>
    </Screen>
  );
}
