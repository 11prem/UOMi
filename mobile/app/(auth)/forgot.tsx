import { AppBar } from '../../src/ui/AppBar';
import { Screen } from '../../src/ui/Screen';
import { StateBox } from '../../src/ui/StateBox';

// Placeholder: Task 11 builds this screen.
export default function Forgot() {
  return (
    <Screen header={<AppBar title="Forgot password" />}>
      <StateBox kind="empty" title="Forgot password" body="Task 11 builds this screen." />
    </Screen>
  );
}
