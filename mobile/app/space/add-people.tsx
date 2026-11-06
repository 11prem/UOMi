import { AppBar } from '../../src/ui/AppBar';
import { Screen } from '../../src/ui/Screen';
import { StateBox } from '../../src/ui/StateBox';

// Placeholder: Task 12 builds this screen.
export default function AddPeople() {
  return (
    <Screen header={<AppBar title="Add people" />}>
      <StateBox kind="empty" title="Add people" body="Task 12 builds this screen." />
    </Screen>
  );
}
