import { AppBar } from '../src/ui/AppBar';
import { Screen } from '../src/ui/Screen';
import { StateBox } from '../src/ui/StateBox';

// Placeholder: Task 14 builds this screen.
export default function ProfileEdit() {
  return (
    <Screen header={<AppBar title="Edit profile" />}>
      <StateBox kind="empty" title="Edit profile" body="Task 14 builds this screen." />
    </Screen>
  );
}
