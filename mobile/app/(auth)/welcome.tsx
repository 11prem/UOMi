import { useState } from 'react';
import { Screen } from '../../src/ui/Screen';
import { ServerSettingsSheet } from '../../src/ui/ServerSettingsSheet';
import { StateBox } from '../../src/ui/StateBox';
import { Wordmark } from '../../src/ui/Wordmark';

// Placeholder: Task 11 builds the rest of Welcome. The wordmark and its long press to the Server sheet are final.
export default function Welcome() {
  const [server, setServer] = useState(false);
  return (
    <Screen>
      <Wordmark hero onLongPress={() => setServer(true)} longPressLabel="Server settings" />
      <StateBox kind="empty" title="Welcome" body="Task 11 builds this screen. Long-press the wordmark for server settings." />
      <ServerSettingsSheet visible={server} onClose={() => setServer(false)} />
    </Screen>
  );
}
