import { AppBar } from '../../src/ui/AppBar';
import { Screen } from '../../src/ui/Screen';
import { StateBox } from '../../src/ui/StateBox';

// Placeholder: Task 11 builds this screen.
export default function Reset() {
  return (
    <Screen header={<AppBar title="New password" />}>
      <StateBox kind="empty" title="New password" body="Task 11 builds this screen." />
    </Screen>
  );
}
