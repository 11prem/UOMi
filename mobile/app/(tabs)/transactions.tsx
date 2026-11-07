import { useState } from 'react';
import { Text, View } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { Select } from '../../src/features/profile/Select';
import { TransactionList } from '../../src/features/transactions/TransactionList';
import { qk } from '../../src/services/queries';
import type { Services } from '../../src/services/types';
import { useServices } from '../../src/services/useServices';
import { useSession } from '../../src/state/session';
import { useTheme } from '../../src/theme/ThemeProvider';
import { Chip } from '../../src/ui/Chip';
import { NotOnServer } from '../../src/ui/NotOnServer';
import { OfflineBanner } from '../../src/ui/OfflineBanner';
import { Screen } from '../../src/ui/Screen';
import { Sheet } from '../../src/ui/Sheet';
import { Skeleton } from '../../src/ui/Skeleton';
import { StateBox } from '../../src/ui/StateBox';

type Kind = Parameters<Services['transactions']['list']>[0]['kind'];
const KINDS: { value: Kind; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'expenses', label: 'Expenses' },
  { value: 'payments', label: 'Payments' },
];
const ALL_SPACES = 'all';

/** A different person (Debug › Act as…) starts with the filters cleared, as the rest of their screens do. */
export default function Transactions() {
  const viewer = useSession((s) => s.user?.id);
  return <TransactionsScreen key={viewer} />;
}

/** Transactions (specs § 12; app.js `R.trans`): every expense and payment across the viewer's spaces, filtered by kind and space. */
function TransactionsScreen() {
  const { colors, type, space } = useTheme();
  const services = useServices();
  const meId = useSession((s) => s.user?.id) ?? '';
  const [kind, setKind] = useState<Kind>('all');
  const [spaceId, setSpaceId] = useState(ALL_SPACES);
  const server = services.mode === 'server'; // the server has no transactions endpoint yet: ask it for nothing
  const spaces = useQuery({ queryKey: qk.spaces, queryFn: () => services.spaces.list(), enabled: !server });
  // A space the viewer has left (or that was deleted) is no longer an option: back to all spaces.
  if (spaceId !== ALL_SPACES && spaces.data && !spaces.data.some((r) => r.space.id === spaceId)) setSpaceId(ALL_SPACES);

  const filter = { kind, ...(spaceId !== ALL_SPACES && { spaceId }) };
  const rows = useQuery({ queryKey: qk.transactions(filter), queryFn: () => services.transactions.list(filter), enabled: !server });
  const filtered = kind !== 'all' || spaceId !== ALL_SPACES;
  const clear = () => {
    setKind('all');
    setSpaceId(ALL_SPACES);
  };

  const title = (
    <Text accessibilityRole="header" style={[type.display, { color: colors.ink, paddingTop: space.s1, paddingBottom: space.s4 }]}>
      Transactions
    </Text>
  );
  if (server) {
    return (
      <Screen tabs header={<OfflineBanner />}>
        {title}
        <NotOnServer />
      </Screen>
    );
  }

  return (
    <Screen tabs header={<OfflineBanner />}>
      {title}
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.s2 }}>
        {KINDS.map((k) => (
          <Chip key={k.value} label={k.label} selected={kind === k.value} onPress={() => setKind(k.value)} />
        ))}
      </View>
      <View style={{ marginTop: space.s3 }}>
        <Select
          label="Filter by space"
          value={spaceId}
          onChange={setSpaceId}
          options={[{ value: ALL_SPACES, label: 'All spaces' }, ...(spaces.data ?? []).map(({ space: s }) => ({ value: s.id, label: s.name }))]}
        />
      </View>

      {rows.isError && <StateBox kind="error" onRetry={() => rows.refetch()} />}
      {rows.data ? (
        rows.data.length ? (
          <TransactionList rows={rows.data} meId={meId} />
        ) : (
          <Sheet style={{ marginTop: space.s4 }}>
            {filtered ? (
              <StateBox kind="empty" title="Nothing matches these filters" action={{ label: 'Clear filters', onPress: clear }} />
            ) : (
              <StateBox kind="empty" icon="receipt" title="No transactions yet" />
            )}
          </Sheet>
        )
      ) : (
        !rows.isError && (
          <View style={{ marginTop: space.s4 }}>
            <Skeleton rows={5} />
          </View>
        )
      )}
    </Screen>
  );
}
