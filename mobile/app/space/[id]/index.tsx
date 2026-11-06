import { AppBar } from '../../../src/ui/AppBar';
import { Screen } from '../../../src/ui/Screen';
import { StateBox } from '../../../src/ui/StateBox';

// Placeholder: Task 12 builds this screen.
export default function SpacePage() {
  return (
    <Screen header={<AppBar title="Space" />}>
      <StateBox kind="empty" title="Space" body="Task 12 builds this screen." />
    </Screen>
  );
}
