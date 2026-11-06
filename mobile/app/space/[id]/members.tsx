import { useState } from 'react';
import { Text, View } from 'react-native';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { errorText, refreshMoney } from '../../../src/features/expense/refresh';
import { AddPeopleSheet } from '../../../src/features/members/AddPeopleSheet';
import { CurrencySheet } from '../../../src/features/members/CurrencySheet';
import { EditSpaceSheet } from '../../../src/features/members/EditSpaceSheet';
import { MemberSheet } from '../../../src/features/members/MemberSheet';
import { memberRules } from '../../../src/features/members/rules';
import { SymbolTile } from '../../../src/features/members/SymbolTile';
import { SectionHeading } from '../../../src/features/space/SectionHeading';
import { Tag } from '../../../src/features/space/Tag';
import { firstName } from '../../../src/features/space/format';
import { CURRENCY_INFO, formatMoney } from '../../../src/domain/money';
import type { User } from '../../../src/domain/types';
import { AppError } from '../../../src/services/errors';
import { qk } from '../../../src/services/queries';
import { useServices } from '../../../src/services/useServices';
import { useSession } from '../../../src/state/session';
import { useTheme } from '../../../src/theme/ThemeProvider';
import { AppBar } from '../../../src/ui/AppBar';
import { Button } from '../../../src/ui/Button';
import { useConfirm } from '../../../src/ui/ConfirmDialog';
import { Icon } from '../../../src/ui/Icon';
import { IconButton } from '../../../src/ui/IconButton';
import { MemberPlate } from '../../../src/ui/MemberPlate';
import { NotOnServer, isNotOnServer } from '../../../src/ui/NotOnServer';
import { OfflineBanner } from '../../../src/ui/OfflineBanner';
import { LedgerRow, Rows } from '../../../src/ui/Rows';
import { Screen } from '../../../src/ui/Screen';
import { Skeleton } from '../../../src/ui/Skeleton';
import { SpaceIcon } from '../../../src/ui/SpaceIcon';
import { StateBox } from '../../../src/ui/StateBox';
import { toast } from '../../../src/ui/Toast';

type SheetName = 'edit' | 'currency' | 'add' | 'member';

/**
 * Members & Space Settings (specs § 10–10.1; app.js `R.members`): name and icon, the currency, the members with their
 * balance with you, then Leave (members) or Delete (the owner). Each control follows the permission table, disabled with
 * its reason. Server mode still lists the members from `spaces.get`, with every action off.
 */
export default function Members() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { colors, type, space } = useTheme();
  const services = useServices();
  const queryClient = useQueryClient();
  const confirm = useConfirm();
  const meId = useSession((s) => s.user?.id ?? '');
  const server = services.mode === 'server';
  const q = useQuery({ queryKey: qk.space(id), queryFn: () => services.spaces.get(id) });
  const [sheet, setSheet] = useState<SheetName | null>(null);
  const [opened, setOpened] = useState(0); // a new key per opening: each sheet starts from the space as it is
  const [memberId, setMemberId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const open = (name: SheetName) => {
    setOpened((n) => n + 1);
    setSheet(name);
  };
  const close = () => setSheet(null);

  const header = (
    <>
      <AppBar title="Members & settings" backTo={q.data?.space.name} />
      <OfflineBanner />
    </>
  );
  const d = q.data;
  if (!d) {
    let body;
    if (isNotOnServer(q.error)) body = <NotOnServer />;
    else if (q.error instanceof AppError && q.error.code === 'not_found') body = <StateBox kind="empty" title="This space no longer exists" />;
    else if (q.isError) body = <StateBox kind="error" onRetry={() => q.refetch()} />;
    else {
      body = (
        <View style={{ gap: space.s6, marginTop: space.s1 }}>
          <Skeleton rows={2} />
          <Skeleton rows={3} />
        </View>
      );
    }
    return <Screen header={header}>{body}</Screen>;
  }

  const { space: s, members, balance, activity } = d;
  const rules = memberRules(s, balance, activity, meId, server);
  const money = (minor: number) => formatMoney(Math.abs(minor), s.currency, { compact: true });
  const subOf = (u: User) => {
    const net = u.id === meId ? 0 : rules.pairWith(u.id);
    return `@${u.username}${net ? ` · ${net < 0 ? 'you owe' : 'owes you'} ${money(net)}` : ''}`;
  };
  const member = members.find((u) => u.id === memberId) ?? null;

  async function removeMember() {
    if (!member) return;
    close();
    const ok = await confirm({ title: `Remove ${member.name}?`, body: `They’ll no longer see ${s.name}.`, ok: 'Remove', danger: true });
    if (!ok) return;
    try {
      await services.spaces.removeMember(s.id, member.id);
    } catch (e) {
      return toast(errorText(e)); // e.g. "Settle up first": they still owe, or are owed by, someone else
    }
    void refreshMoney(queryClient);
    toast(`${firstName(member.name)} removed`);
  }

  /** Leave or Delete, after its confirm. A refusal (the rule's reason, or offline) is toasted; success goes Home. */
  async function endSpace(ask: Parameters<typeof confirm>[0], run: () => Promise<void>, done: string) {
    if (!(await confirm(ask))) return;
    setBusy(true);
    try {
      await run();
    } catch (e) {
      setBusy(false);
      return toast(errorText(e));
    }
    router.dismissTo('/');
    void refreshMoney(queryClient);
    toast(done);
  }

  const leaveSpace = () =>
    endSpace(
      { title: `Leave ${s.name}?`, body: 'You’ll stop seeing its expenses. Someone will need to add you back.', ok: 'Leave', danger: true },
      () => services.spaces.leave(s.id),
      `You left ${s.name}`,
    );

  const deleteSpace = () =>
    endSpace(
      { title: `Delete ${s.name}?`, body: 'Its expenses and payments are removed for everyone. This can’t be undone.', ok: 'Delete space', danger: true },
      () => services.spaces.remove(s.id),
      `${s.name} deleted`,
    );

  const currency = CURRENCY_INFO[s.currency];
  const note = (text: string) => <Text style={[type.label, { fontFamily: type.body.fontFamily, color: colors.ink2 }]}>{text}</Text>;

  return (
    <Screen header={header}>
      <View style={{ marginTop: space.s1 }}>
        <Rows>
          <LedgerRow
            left={<SpaceIcon name={s.icon} />}
            title={s.name}
            sub="Name and icon"
            right={rules.canEdit && <Icon name="pencil" size="sm" color={colors.ink2} />}
            onPress={rules.canEdit ? () => open('edit') : undefined}
            accessibilityLabel={`Edit name and icon, ${s.name}`}
          />
          <LedgerRow
            left={<SymbolTile symbol={currency.symbol} />}
            title={currency.name}
            sub={rules.currencyNote}
            right={<Icon name={rules.canChangeCurrency ? 'chev' : 'lock'} size="sm" color={colors.ink2} />}
            onPress={rules.canChangeCurrency ? () => open('currency') : undefined}
            accessibilityLabel={`Currency, ${currency.name}. ${rules.currencyNote}`}
          />
        </Rows>
      </View>

      <SectionHeading>
        Members <Text style={{ color: colors.ink2 }}>{members.length}</Text>
      </SectionHeading>
      <Rows>
        {rules.canAddPeople && (
          <LedgerRow left={<SpaceIcon name="plus" />} title="Add people" onPress={() => open('add')} accessibilityLabel="Add people" />
        )}
        {members.map((u) => (
          <LedgerRow
            key={u.id}
            left={<MemberPlate user={u} />}
            title={u.id === meId ? 'You' : u.name}
            sub={subOf(u)}
            right={
              u.id === s.ownerId ? (
                <Tag label="Owner" tone="owner" />
              ) : rules.hasMenu(u.id) ? (
                <IconButton
                  icon="more"
                  label={`Options for ${u.name}`}
                  onPress={() => {
                    setMemberId(u.id);
                    open('member');
                  }}
                />
              ) : undefined
            }
          />
        ))}
      </Rows>

      <View style={{ marginTop: space.s8, gap: space.s3 }}>
        {server ? (
          <NotOnServer why="Changing a space, its people or its currency, leaving and deleting aren’t on this server yet. Demo mode has them." />
        ) : rules.remove ? (
          <>
            <Button variant="danger" icon="trash" label="Delete space" onPress={() => void deleteSpace()} disabled={!rules.remove.enabled} busy={busy} />
            {note(rules.remove.note)}
          </>
        ) : (
          rules.leave && (
            <>
              <Button variant="danger" icon="logout" label="Leave space" onPress={() => void leaveSpace()} disabled={!rules.leave.enabled} busy={busy} />
              {note(rules.leave.note)}
            </>
          )
        )}
      </View>

      <EditSpaceSheet key={`edit-${opened}`} visible={sheet === 'edit'} space={s} onClose={close} />
      <CurrencySheet visible={sheet === 'currency'} space={s} onClose={close} />
      <AddPeopleSheet key={`add-${opened}`} visible={sheet === 'add'} space={s} onClose={close} />
      <MemberSheet
        visible={sheet === 'member'}
        member={member}
        sub={member ? subOf(member) : ''}
        canRemove={!!member && rules.canRemove(member.id)}
        onRemove={() => void removeMember()}
        onClose={close}
      />
    </Screen>
  );
}
