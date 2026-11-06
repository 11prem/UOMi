import { AppBar } from '../../../src/ui/AppBar';
import { Screen } from '../../../src/ui/Screen';
import { StateBox } from '../../../src/ui/StateBox';

// Placeholder: Task 13 builds this screen.
export default function ExpenseNew() {
  return (
    <Screen header={<AppBar title="Add expense" />}>
      <StateBox kind="empty" title="Add expense" body="Task 13 builds this screen." />
    </Screen>
  );
}
