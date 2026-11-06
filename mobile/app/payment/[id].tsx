import { useQuery } from '@tanstack/react-query';
import { useLocalSearchParams } from 'expo-router';
import { BillSkeleton } from '../../src/features/expense/Bill';
import { PaymentDetailBody } from '../../src/features/settle/PaymentDetailBody';
import { AppError } from '../../src/services/errors';
import { qk } from '../../src/services/queries';
import { useServices } from '../../src/services/useServices';
import { useSession } from '../../src/state/session';
import { AppBar } from '../../src/ui/AppBar';
import { NotOnServer, isNotOnServer } from '../../src/ui/NotOnServer';
import { OfflineBanner } from '../../src/ui/OfflineBanner';
import { Screen } from '../../src/ui/Screen';
import { StateBox } from '../../src/ui/StateBox';

/** Settlement Detail, "← Payment" (specs § 9.1). `?fresh=1` right after Settle Up recorded it: the stamp lands. */
export default function PaymentDetail() {
  const { id, fresh } = useLocalSearchParams<{ id: string; fresh?: string }>();
  const services = useServices();
  const meId = useSession((s) => s.user?.id ?? '');
  const server = services.mode === 'server';
  const q = useQuery({ queryKey: qk.settlement(id), queryFn: () => services.settlements.get(id), enabled: !server });
  const d = q.data;

  let body;
  if (d) {
    body = (
      <>
        {q.isError && <StateBox kind="error" onRetry={() => q.refetch()} />}
        <PaymentDetailBody data={d} meId={meId} fresh={fresh === '1'} />
      </>
    );
  } else if (server || isNotOnServer(q.error)) body = <NotOnServer />;
  else if (q.error instanceof AppError && q.error.code === 'not_found') body = <StateBox kind="empty" icon="swap" title="This payment no longer exists" />;
  else if (q.isError) body = <StateBox kind="error" onRetry={() => q.refetch()} />;
  else body = <BillSkeleton />;

  return (
    <Screen
      header={
        <>
          <AppBar title="Payment" backTo={d?.space.name} />
          <OfflineBanner />
        </>
      }
    >
      {body}
    </Screen>
  );
}
