import { AppBar } from '../../../src/ui/AppBar';
import { Screen } from '../../../src/ui/Screen';
import { StateBox } from '../../../src/ui/StateBox';

// Placeholder: Task 13 builds this screen.
export default function ExpenseEdit() {
  return (
    <Screen header={<AppBar title="Edit expense" />}>
      <StateBox kind="empty" title="Edit expense" body="Task 13 builds this screen." />
    </Screen>
  );
}
