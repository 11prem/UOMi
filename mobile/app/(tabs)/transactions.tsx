import { AppBar } from '../../src/ui/AppBar';
import { Screen } from '../../src/ui/Screen';
import { StateBox } from '../../src/ui/StateBox';

// Placeholder: Task 14 builds this screen.
export default function Transactions() {
  return (
    <Screen tabs header={<AppBar title="Transactions" onBack={false} />}>
      <StateBox kind="empty" title="Transactions" body="Task 14 builds this screen." />
    </Screen>
  );
}
