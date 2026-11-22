import { AppError } from '../services/errors';
import { StateBox } from './StateBox';

/** True for the `not_on_server` rejection given to every operation the backend has no endpoint for. */
export const isNotOnServer = (e: unknown) => e instanceof AppError && e.code === 'not_on_server';

/**
 * The one shared panel for a feature the server can't serve (design § 4.3). Render it in place of the screen's
 * content when its query fails with `isNotOnServer`.
 */
export function NotOnServer({ why = 'The UOMi server you’re connected to doesn’t support this yet.' }: { why?: string }) {
  return <StateBox kind="empty" icon="lock" title="Not available on this server yet" body={why} />;
}
