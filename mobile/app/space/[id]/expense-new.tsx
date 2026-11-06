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

/** Add Expense (specs § 8.1): any member can add one. Server mode has no endpoint for it, so it asks the server nothing. */
export default function ExpenseNew() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const services = useServices();
  const meId = useSession((s) => s.user?.id ?? '');
  const server = services.mode === 'server';
  const q = useQuery({ queryKey: qk.space(id), queryFn: () => services.spaces.get(id), enabled: !server });

  if (q.data) {
    return (
      <ExpenseForm
        title="Add expense"
        space={q.data.space}
        members={q.data.members}
        meId={meId}
        onSubmit={(input) => services.expenses.create(input)}
        savedToast="Expense added"
      />
    );
  }

  let body;
  if (server || isNotOnServer(q.error)) body = <NotOnServer />;
  else if (q.error instanceof AppError && q.error.code === 'not_found') body = <StateBox kind="empty" title="This space no longer exists" />;
  else if (q.isError) body = <StateBox kind="error" onRetry={() => q.refetch()} />;
  else return <FormLoading title="Add expense" />;
  return <Screen header={<AppBar title="Add expense" />}>{body}</Screen>;
}
