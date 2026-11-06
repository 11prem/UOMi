import { AppBar } from '../../src/ui/AppBar';
import { Screen } from '../../src/ui/Screen';
import { StateBox } from '../../src/ui/StateBox';

// Placeholder: Task 12 builds this screen.
export default function Home() {
  return (
    <Screen tabs header={<AppBar title="Home" onBack={false} />}>
      <StateBox kind="empty" title="Home" body="Task 12 builds this screen." />
    </Screen>
  );
}
