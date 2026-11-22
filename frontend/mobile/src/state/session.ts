import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import type { User } from '../domain/types';
import { queryClient } from '../services/queries';
import { createServerServices } from '../services/server';
import type { Services } from '../services/types';
import { toast } from '../ui/Toast';
import { markActivity } from './activity';

/**
 * Where the backend is until someone changes it in Server settings (long-press the wordmark on Welcome): EXPO_PUBLIC_API_URL
 * if it was set when the app was built or started, otherwise the deployed server.
 */
export const DEFAULT_SERVER_URL = process.env.EXPO_PUBLIC_API_URL ?? 'https://uomi-1.onrender.com';
/** Where a sign-out lands: Welcome (Logout, the server ended it) or Sign In (idle, expired at launch; design § 4.4). */
export type Landing = '/welcome' | '/signin';

type Session = {
  /** Base URL of the backend. Saved on the phone; changed only in Server settings. */
  serverUrl: string;
  /** Persisted so a session survives a launch where the server can't be reached (`auth.restore()` rejects with `network`). */
  user: User | null;
  /** Not persisted. Where the last sign-out lands; `app/(auth)/_layout.tsx` opens Sign In over Welcome for '/signin'. */
  landing: Landing;
  /** Not persisted. True once the saved session was read, or failed to read (then the defaults stand). */
  hydrated: boolean;
  /** Signs out of the current services, clears every cached query and points the app at another backend. Resolves when the old sign-out is done. */
  setServerUrl(url: string): Promise<void>;
  signedIn(user: User): void;
  /** The session ended. `reason` shows as a toast; `to` defaults to Welcome. Callers sign out of the services themselves. */
  signedOut(reason?: string, to?: Landing): void;
};

export const useSession = create<Session>()(
  persist(
    (set) => ({
      serverUrl: DEFAULT_SERVER_URL,
      user: null,
      landing: '/welcome',
      hydrated: false,

      async setServerUrl(url) {
        const previous = currentServices();
        // Cache and user go in the same tick as the switch, so nothing from the old server renders against the new one.
        queryClient.clear();
        set({ serverUrl: url, user: null, landing: '/welcome' });
        await previous.auth.signOut().catch(() => {}); // best effort: the old server may be the one that is unreachable
      },

      signedIn(user) {
        queryClient.clear(); // a different person must not see the last one's cache
        set({ user });
      },

      signedOut(reason, to = '/welcome') {
        queryClient.clear();
        set({ user: null, landing: to }); // one set: the auth layout the redirect mounts reads both together
        if (reason) toast(reason);
      },
    }),
    {
      name: 'uomi.session.v4', // v4: no Demo mode (v2 kept `mode` too; v3 did not save the server URL)
      storage: createJSONStorage(() => AsyncStorage),
      partialize: ({ serverUrl, user }) => ({ serverUrl, user }),
      // Called on success and on failure (unreadable storage, corrupt JSON): either way the app must open, so the splash
      // never waits forever. On failure the defaults stand: the default server, signed out.
      onRehydrateStorage: () => () => useSession.setState({ hydrated: true }),
    },
  ),
);

// ---- the services ----
// Kept here, beside the session, so the session, the hook and the idle timer import in one direction only.

let current: { key: string; services: Services } | null = null;

/** One instance per server URL. `useServices()` reads it with the URL it subscribed to. */
export function servicesFor(serverUrl: string): Services {
  const key = `server:${serverUrl}`;
  if (current?.key !== key) {
    // A replaced instance's late replies must not sign out, or restart the idle timer of, the one that replaced it.
    const live = () => current?.services === services;
    const services: Services = createServerServices({
      baseUrl: serverUrl,
      onSignedOut: (reason) => live() && useSession.getState().signedOut(reason),
      onActivity: () => live() && markActivity(),
    });
    current = { key, services };
  }
  return current.services;
}

/** The services, outside React (the session store, timers). */
export function currentServices(): Services {
  return servicesFor(useSession.getState().serverUrl);
}
