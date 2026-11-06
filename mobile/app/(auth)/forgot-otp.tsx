import { AppBar } from '../../src/ui/AppBar';
import { Screen } from '../../src/ui/Screen';
import { StateBox } from '../../src/ui/StateBox';

// Placeholder: Task 11 builds this screen.
export default function ForgotOtp() {
  return (
    <Screen header={<AppBar title="Enter the code" />}>
      <StateBox kind="empty" title="Enter the code" body="Task 11 builds this screen." />
    </Screen>
  );
}
