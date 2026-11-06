import { AppBar } from '../../src/ui/AppBar';
import { Screen } from '../../src/ui/Screen';
import { StateBox } from '../../src/ui/StateBox';

// Placeholder: Task 11 builds this screen.
export default function Verify() {
  return (
    <Screen header={<AppBar title="Verify your phone" />}>
      <StateBox kind="empty" title="Verify your phone" body="Task 11 builds this screen." />
    </Screen>
  );
}
