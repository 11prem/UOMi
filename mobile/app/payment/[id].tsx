import { AppBar } from '../../src/ui/AppBar';
import { Screen } from '../../src/ui/Screen';
import { StateBox } from '../../src/ui/StateBox';

// Placeholder: Task 13 builds this screen.
export default function Payment() {
  return (
    <Screen header={<AppBar title="Payment" />}>
      <StateBox kind="empty" title="Payment" body="Task 13 builds this screen." />
    </Screen>
  );
}
