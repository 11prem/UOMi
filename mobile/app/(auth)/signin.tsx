import { AppBar } from '../../src/ui/AppBar';
import { Screen } from '../../src/ui/Screen';
import { StateBox } from '../../src/ui/StateBox';

// Placeholder: Task 11 builds this screen.
export default function SignIn() {
  return (
    <Screen header={<AppBar title="Sign in" />}>
      <StateBox kind="empty" title="Sign in" body="Task 11 builds this screen." />
    </Screen>
  );
}
