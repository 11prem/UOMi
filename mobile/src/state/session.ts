import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import type { User } from '../domain/types';
import { createDemoServices } from '../services/demo';
import { queryClient } from '../services/queries';
import { createServerServices } from '../services/server';
import type { Services } from '../services/types';
import { toast } from '../ui/Toast';
import { markActivity } from './activity';

export type Mode = 'demo' | 'server';
/** Where a sign-out lands: Welcome (Logout, the server ended it) or Sign In (idle, expired at launch; design § 4.4). */
export type Landing = '/welcome' | '/signin';

type Session = {
  mode: Mode;
  /** Base URL of the backend, kept while in demo mode so the Server sheet can offer it again. */
  serverUrl: string;
  /** Persisted so a session survives a launch where the server can't be reached (`auth.restore()` rejects with `network`). */
  user: User | null;
  /** Not persisted. Where the last sign-out lands; `app/(auth)/_layout.tsx` opens Sign In over Welcome for '/signin'. */
  landing: Landing;
  /** Not persisted. True once the saved session was read, or failed to read (then the defaults stand). */
  hydrated: boolean;
  /** Signs out of the current services, clears every cached query and switches. Resolves when the old sign-out is done. */
  setMode(mode: Mode, url?: string): Promise<void>;
  signedIn(user: User): void;
  /** The session ended. `reason` shows as a toast; `to` defaults to Welcome. Callers sign out of the services themselves. */
  signedOut(reason?: string, to?: Landing): void;
};

export const useSession = create<Session>()(
  persist(
    (set, get) => ({
      mode: 'demo',
      serverUrl: '',
      user: null,
      landing: '/welcome',
      hydrated: false,

      async setMode(mode, url) {
        const previous = currentServices();
        // Cache and user go in the same tick as the switch, so nothing from the old mode renders in the new one.
        queryClient.clear();
        set({ mode, serverUrl: url ?? get().serverUrl, user: null, landing: '/welcome' });
        await previous.auth.signOut().catch(() => {}); // best effort: the old server may be the one that is unreachable
      },

      signedIn(user) {
        queryClient.clear(); // a different person (demo "Act as…") must not see the last one's cache
        set({ user });
      },

      signedOut(reason, to = '/welcome') {
        queryClient.clear();
        set({ user: null, landing: to }); // one set: the auth layout the redirect mounts reads both together
        if (reason) toast(reason);
      },
    }),
    {
      name: 'uomi.session.v1',
      storage: createJSONStorage(() => AsyncStorage),
      partialize: ({ mode, serverUrl, user }) => ({ mode, serverUrl, user }),
      // Called on success and on failure (unreadable storage, corrupt JSON): either way the app must open, so the splash
      // never waits forever. On failure the defaults stand: demo mode, signed out.
      onRehydrateStorage: () => () => useSession.setState({ hydrated: true }),
    },
  ),
);

// ---- the services the session's mode implies ----
// Kept here, beside the mode they follow, so the session, the hook and the idle timer import in one direction only.

let current: { key: string; services: Services } | null = null;

/** One instance per mode (and server URL); a mode switch replaces it. `useServices()` reads it with the mode it subscribed to. */
export function servicesFor(mode: Mode, serverUrl: string): Services {
  const key = mode === 'server' ? `server:${serverUrl}` : 'demo';
  if (current?.key !== key) {
    // A replaced instance's late replies must not sign out, or restart the idle timer of, the one that replaced it.
    const live = () => current?.services === services;
    const services: Services =
      mode === 'server'
        ? createServerServices({
            baseUrl: serverUrl,
            onSignedOut: (reason) => live() && useSession.getState().signedOut(reason),
            onActivity: () => live() && markActivity(),
          })
        : createDemoServices();
    current = { key, services };
  }
  return current.services;
}

/** The services for the session's mode, outside React (the session store, timers). */
export function currentServices(): Services {
  const { mode, serverUrl } = useSession.getState();
  return servicesFor(mode, serverUrl);
}
