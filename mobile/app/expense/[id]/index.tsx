import { AppBar } from '../../../src/ui/AppBar';
import { Screen } from '../../../src/ui/Screen';
import { StateBox } from '../../../src/ui/StateBox';

// Placeholder: Task 13 builds this screen.
export default function ExpenseDetail() {
  return (
    <Screen header={<AppBar title="Expense" />}>
      <StateBox kind="empty" title="Expense" body="Task 13 builds this screen." />
    </Screen>
  );
}
