import { AppBar } from '../../src/ui/AppBar';
import { Screen } from '../../src/ui/Screen';
import { StateBox } from '../../src/ui/StateBox';

// Placeholder: Task 14 builds this screen.
export default function Notifications() {
  return (
    <Screen tabs header={<AppBar title="Notifications" onBack={false} />}>
      <StateBox kind="empty" title="Notifications" body="Task 14 builds this screen." />
    </Screen>
  );
}
