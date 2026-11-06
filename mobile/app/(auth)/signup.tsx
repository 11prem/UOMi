import { AppBar } from '../../src/ui/AppBar';
import { Screen } from '../../src/ui/Screen';
import { StateBox } from '../../src/ui/StateBox';

// Placeholder: Task 11 builds this screen.
export default function SignUp() {
  return (
    <Screen header={<AppBar title="Create account" />}>
      <StateBox kind="empty" title="Create account" body="Task 11 builds this screen." />
    </Screen>
  );
}
