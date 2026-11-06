import { useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { Space, User } from '../../domain/types';
import { qk } from '../../services/queries';
import { useServices } from '../../services/useServices';
import { useTheme } from '../../theme/ThemeProvider';
import { BottomSheet } from '../../ui/BottomSheet';
import { Button } from '../../ui/Button';
import { useConfirm } from '../../ui/ConfirmDialog';
import { Icon } from '../../ui/Icon';
import { IconButton } from '../../ui/IconButton';
import { MemberPlate } from '../../ui/MemberPlate';
import { size } from '../../ui/metrics';
import { LedgerRow, Rows } from '../../ui/Rows';
import { Skeleton } from '../../ui/Skeleton';
import { StateBox } from '../../ui/StateBox';
import { TextField } from '../../ui/TextField';
import { toast } from '../../ui/Toast';
import { errorText, refreshMoney } from '../expense/refresh';

/**
 * "Add people" on Members & Settings (specs § 10 → the § 6.2 search): the same search — a whole phone number or a
 * username prefix, 300 ms after typing stops — into a list of people to add. The Add People route belongs to Create Space
 * (its draft), so this is a bottom sheet. Closing it with people picked asks "Discard changes?" first (Review Focus 4).
 * Mount it with a new `key` per opening.
 */
export function AddPeopleSheet({ visible, space: s, onClose }: { visible: boolean; space: Space; onClose: () => void }) {
  const { colors, type, space } = useTheme();
  const services = useServices();
  const queryClient = useQueryClient();
  const confirm = useConfirm();
  const [text, setText] = useState('');
  const [q, setQ] = useState('');
  const [picked, setPicked] = useState<User[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setQ(text.trim()), 300);
    return () => clearTimeout(t);
  }, [text]);
  const search = useQuery({ queryKey: qk.userSearch(q), queryFn: () => services.users.search(q), enabled: visible && q !== '' });

  async function close() {
    if (saving) return;
    if (picked.length && !(await confirm({ title: 'Discard changes?', body: 'What you’ve typed here will be lost.', ok: 'Discard', cancel: 'Keep editing', danger: true }))) return;
    onClose();
  }

  async function add() {
    if (!picked.length || saving) return;
    setSaving(true);
    try {
      await services.spaces.addMembers(s.id, picked.map((u) => u.id));
    } catch (e) {
      setSaving(false);
      return toast(errorText(e));
    }
    void refreshMoney(queryClient);
    toast(picked.length === 1 ? '1 person added' : `${picked.length} people added`);
    onClose();
  }

  let results = null;
  if (q) {
    if (search.data?.length) {
      results = (
        <Rows nested>
          {search.data.map((u) => {
            const member = s.memberIds.includes(u.id);
            const added = picked.some((x) => x.id === u.id);
            return (
              <LedgerRow
                key={u.id}
                left={<MemberPlate user={u} />}
                title={u.name}
                sub={`@${u.username}`}
                right={
                  member || added ? (
                    <Text style={[type.label, { color: colors.ink2 }]}>{member ? 'In this space' : 'Added'}</Text>
                  ) : (
                    <Icon name="plus" size="sm" color={colors.carbon} />
                  )
                }
                onPress={member || added ? undefined : () => setPicked((p) => [...p, u])}
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

  const n = picked.length;
  return (
    <BottomSheet visible={visible} onClose={() => void close()} title="Add people">
      <View style={{ gap: space.s3 }}>
        <TextField
          label="Find people"
          value={text}
          onChangeText={setText}
          placeholder="Phone number or username"
          helper="Search a whole phone number or a username."
          autoCapitalize="none"
          autoCorrect={false}
          autoComplete="off"
          right={
            <View style={{ width: size.iconButton, alignItems: 'center' }}>
              <Icon name="search" size="sm" color={colors.ink2} />
            </View>
          }
        />
        <View accessibilityLiveRegion="polite">{results}</View>
        {n > 0 && (
          <Rows nested>
            {picked.map((u) => (
              <LedgerRow
                key={u.id}
                left={<MemberPlate user={u} />}
                title={u.name}
                sub={`@${u.username}`}
                right={<IconButton icon="x" iconSize="sm" label={`Remove ${u.name}`} onPress={() => setPicked((p) => p.filter((x) => x.id !== u.id))} />}
              />
            ))}
          </Rows>
        )}
        <Button label={n === 0 ? 'Add people' : n === 1 ? 'Add 1 person' : `Add ${n} people`} onPress={add} disabled={n === 0} busy={saving} />
      </View>
    </BottomSheet>
  );
}
