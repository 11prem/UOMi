import { AppError } from '../services/errors';
import { StateBox } from './StateBox';

/** True for the `not_on_server` rejection server mode gives every operation the backend has no endpoint for. */
export const isNotOnServer = (e: unknown) => e instanceof AppError && e.code === 'not_on_server';

/**
 * The one shared panel for a feature server mode can't serve (design § 4.3). Render it in place of the screen's
 * content when its query fails with `isNotOnServer`, or straight away for screens that are demo-only.
 */
export function NotOnServer({ why = 'The UOMi server you’re connected to doesn’t support this. Demo mode has it.' }: { why?: string }) {
  return <StateBox kind="empty" icon="lock" title="Not available on this server yet" body={why} />;
}
