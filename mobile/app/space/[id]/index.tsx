import { View } from 'react-native';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { ActivityList } from '../../../src/features/space/ActivityList';
import { BalanceSheet } from '../../../src/features/space/BalanceSheet';
import { SectionHeading } from '../../../src/features/space/SectionHeading';
import { SpaceHeader } from '../../../src/features/space/SpaceHeader';
import { AppError } from '../../../src/services/errors';
import { qk } from '../../../src/services/queries';
import { useServices } from '../../../src/services/useServices';
import { useSession } from '../../../src/state/session';
import { useTheme } from '../../../src/theme/ThemeProvider';
import { Fab } from '../../../src/ui/Fab';
import { NotOnServer, isNotOnServer } from '../../../src/ui/NotOnServer';
import { OfflineBanner } from '../../../src/ui/OfflineBanner';
import { Screen } from '../../../src/ui/Screen';
import { Sheet } from '../../../src/ui/Sheet';
import { Skeleton } from '../../../src/ui/Skeleton';
import { StateBox } from '../../../src/ui/StateBox';
import { TabBar } from '../../../src/ui/TabBar';

/** The Space Page (specs § 7; app.js `R.space`): the balance and breakdown, then the expenses and payments by month. Shows the tab bar. */
export default function SpacePage() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { space, type } = useTheme();
  const services = useServices();
  const queryClient = useQueryClient();
  const meId = useSession((s) => s.user?.id ?? '');
  const q = useQuery({ queryKey: qk.space(id), queryFn: () => services.spaces.get(id) });
  const d = q.data;
  const gone = !d && q.error instanceof AppError && q.error.code === 'not_found'; // deleted, or the viewer was removed

  let body;
  if (d) {
    body = (
      <>
        {q.isError && <StateBox kind="error" onRetry={() => q.refetch()} />}
        <BalanceSheet space={d.space} members={d.members} balance={d.balance} onSettle={() => router.push(`/space/${id}/settle`)} />
        <SectionHeading>Expenses</SectionHeading>
        {d.activity.length ? (
          <ActivityList rows={d.activity} currency={d.space.currency} meId={meId} />
        ) : (
          <Sheet>
            <StateBox kind="empty" icon="receipt" title="No expenses yet" body="Tap + to add the first one." />
          </Sheet>
        )}
      </>
    );
  } else if (isNotOnServer(q.error)) body = <NotOnServer />;
  else if (gone) body = <StateBox kind="empty" title="This space no longer exists" />;
  else if (q.isError) body = <StateBox kind="error" onRetry={() => q.refetch()} />;
  else {
    body = (
      <>
        <Sheet style={{ padding: space.s4, marginTop: space.s1, gap: space.s2 + 2 }}>
          <Skeleton width="35%" />
          <Skeleton width="60%" height={type.figure.lineHeight} />
        </Sheet>
        <SectionHeading>Expenses</SectionHeading>
        <Skeleton rows={3} />
      </>
    );
  }

  return (
    <View style={{ flex: 1 }}>
      <Screen
        tabs
        header={
          <>
            <SpaceHeader title={d?.space.name ?? 'Space'} icon={d?.space.icon} onMembers={d && (() => router.push(`/space/${id}/members`))} />
            <OfflineBanner />
          </>
        }
        fab={d && <Fab icon="plus" label="Add expense" onPress={() => router.push(`/space/${id}/expense-new`)} />}
        onRefresh={() => queryClient.invalidateQueries({ queryKey: qk.space(id) })}
      >
        {body}
      </Screen>
      <TabBar active="index" />
    </View>
  );
}
