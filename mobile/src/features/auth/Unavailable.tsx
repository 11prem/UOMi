import { AppBar } from '../../ui/AppBar';
import { NotOnServer } from '../../ui/NotOnServer';
import { Screen } from '../../ui/Screen';

/** A screen server mode can't serve yet: its app bar and the shared "Not available on this server yet" panel. */
export function Unavailable({ title, why }: { title: string; why: string }) {
  return (
    <Screen header={<AppBar title={title} />}>
      <NotOnServer why={why} />
    </Screen>
  );
}
