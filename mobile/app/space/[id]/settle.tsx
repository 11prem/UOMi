import { AppBar } from '../../../src/ui/AppBar';
import { Screen } from '../../../src/ui/Screen';
import { StateBox } from '../../../src/ui/StateBox';

// Placeholder: Task 13 builds this screen.
export default function SettleUp() {
  return (
    <Screen header={<AppBar title="Settle up" />}>
      <StateBox kind="empty" title="Settle up" body="Task 13 builds this screen." />
    </Screen>
  );
}
