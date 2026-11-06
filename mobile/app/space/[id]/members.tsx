import { AppBar } from '../../../src/ui/AppBar';
import { Screen } from '../../../src/ui/Screen';
import { StateBox } from '../../../src/ui/StateBox';

// Placeholder: Task 13 builds this screen.
export default function Members() {
  return (
    <Screen header={<AppBar title="Members & settings" />}>
      <StateBox kind="empty" title="Members & settings" body="Task 13 builds this screen." />
    </Screen>
  );
}
