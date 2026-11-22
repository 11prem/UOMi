import { servicesFor, useSession } from '../state/session';
import type { Services } from './types';

export { currentServices } from '../state/session';

/** The memoised server services; re-renders with the new instance if the server URL ever changes. */
export function useServices(): Services {
  const serverUrl = useSession((s) => s.serverUrl);
  return servicesFor(serverUrl);
}
