import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { BillSkeleton } from '../../../src/features/expense/Bill';
import { ExpenseDetailBody } from '../../../src/features/expense/ExpenseDetailBody';
import { errorText, refreshMoney } from '../../../src/features/expense/refresh';
import { AppError } from '../../../src/services/errors';
import { qk } from '../../../src/services/queries';
import { useServices } from '../../../src/services/useServices';
import { useSession } from '../../../src/state/session';
import { AppBar } from '../../../src/ui/AppBar';
import { useConfirm } from '../../../src/ui/ConfirmDialog';
import { IconButton } from '../../../src/ui/IconButton';
import { NotOnServer, isNotOnServer } from '../../../src/ui/NotOnServer';
import { OfflineBanner } from '../../../src/ui/OfflineBanner';
import { Screen } from '../../../src/ui/Screen';
import { StateBox } from '../../../src/ui/StateBox';
import { toast } from '../../../src/ui/Toast';

/** Expense Detail (specs § 8.3): Edit and Delete in the app bar for the expense's creator only. */
export default function ExpenseDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const services = useServices();
  const queryClient = useQueryClient();
  const confirm = useConfirm();
  const meId = useSession((s) => s.user?.id ?? '');
  const server = services.mode === 'server';
  const q = useQuery({ queryKey: qk.expense(id), queryFn: () => services.expenses.get(id), enabled: !server });
  const [deleting, setDeleting] = useState(false);
  const d = q.data;

  async function remove() {
    if (!d || deleting) return;
    const ok = await confirm({ title: `Delete ‘${d.expense.description}’?`, body: 'Balances will be recalculated.', ok: 'Delete', danger: true });
    if (!ok) return;
    setDeleting(true);
    try {
      await services.expenses.remove(id);
    } catch (e) {
      setDeleting(false);
      return toast(errorText(e));
    }
    router.dismissTo(`/space/${d.space.id}`); // the Space Page, even when opened from Notifications (replaces if not in the stack)
    queryClient.removeQueries({ queryKey: qk.expense(id) }); // gone: drop it rather than refetch it into a not-found error
    void refreshMoney(queryClient);
    toast('Expense deleted');
  }

  let body;
  if (d) {
    body = (
      <>
        {q.isError && <StateBox kind="error" onRetry={() => q.refetch()} />}
        <ExpenseDetailBody data={d} meId={meId} />
      </>
    );
  } else if (server || isNotOnServer(q.error)) body = <NotOnServer />;
  else if (q.error instanceof AppError && q.error.code === 'not_found') body = <StateBox kind="empty" icon="receipt" title="This expense was deleted" />;
  else if (q.isError) body = <StateBox kind="error" onRetry={() => q.refetch()} />;
  else body = <BillSkeleton />;

  const actions = d && d.expense.createdBy === meId && (
    <>
      <IconButton icon="pencil" label="Edit expense" onPress={() => router.push(`/expense/${id}/edit`)} disabled={deleting} />
      <IconButton icon="trash" label="Delete expense" onPress={() => void remove()} disabled={deleting} />
    </>
  );

  return (
    <Screen
      header={
        <>
          <AppBar title="Expense" backTo={d?.space.name} actions={actions} />
          <OfflineBanner />
        </>
      }
    >
      {body}
    </Screen>
  );
}
