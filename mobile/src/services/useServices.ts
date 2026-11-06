import { servicesFor, useSession } from '../state/session';
import type { Services } from './types';

export { currentServices } from '../state/session';

/** The memoised demo or server services for the current mode; re-renders with the new instance when the mode changes. */
export function useServices(): Services {
  const mode = useSession((s) => s.mode);
  const serverUrl = useSession((s) => s.serverUrl);
  return servicesFor(mode, serverUrl);
}
