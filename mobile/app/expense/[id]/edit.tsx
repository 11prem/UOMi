import { useQuery } from '@tanstack/react-query';
import { useLocalSearchParams } from 'expo-router';
import { ExpenseForm } from '../../../src/features/expense/ExpenseForm';
import { FormLoading } from '../../../src/features/expense/FormLoading';
import { AppError } from '../../../src/services/errors';
import { qk } from '../../../src/services/queries';
import { useServices } from '../../../src/services/useServices';
import { useSession } from '../../../src/state/session';
import { AppBar } from '../../../src/ui/AppBar';
import { NotOnServer, isNotOnServer } from '../../../src/ui/NotOnServer';
import { Screen } from '../../../src/ui/Screen';
import { StateBox } from '../../../src/ui/StateBox';

/** Edit Expense (specs § 8.1): only its creator can edit it; saving asks everyone in the split again. */
export default function ExpenseEdit() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const services = useServices();
  const meId = useSession((s) => s.user?.id ?? '');
  const server = services.mode === 'server';
  const q = useQuery({ queryKey: qk.expense(id), queryFn: () => services.expenses.get(id), enabled: !server });

  if (q.data && q.data.expense.createdBy === meId) {
    return (
      <ExpenseForm
        title="Edit expense"
        space={q.data.space}
        members={q.data.members}
        meId={meId}
        expense={q.data.expense}
        onSubmit={(input) => services.expenses.update(id, input)}
        savedToast="Expense updated"
        refresh={[qk.expense(id)]}
      />
    );
  }

  let body;
  if (q.data) body = <StateBox kind="empty" icon="lock" title="Only the person who added this expense can edit it" />;
  else if (server || isNotOnServer(q.error)) body = <NotOnServer />;
  else if (q.error instanceof AppError && q.error.code === 'not_found') body = <StateBox kind="empty" title="This expense was deleted" />;
  else if (q.isError) body = <StateBox kind="error" onRetry={() => q.refetch()} />;
  else return <FormLoading title="Edit expense" />;
  return <Screen header={<AppBar title="Edit expense" />}>{body}</Screen>;
}
