import { useEffect } from 'react';
import { AppState } from 'react-native';
import { focusManager } from '@tanstack/react-query';
import { defaultTokenStore } from '../services/server/tokens';
import { lastActivityAt, onActivity } from './activity';
import { currentServices, useSession } from './session';

export { markActivity } from './activity';

const IDLE_MESSAGE = 'You were signed out after 10 minutes of inactivity.';
const MARGIN_SECONDS = 30; // the same margin `auth.restore()` uses on launch
const DEFAULT_IDLE_SECONDS = 600; // the backend's default, until the stored tokens say otherwise

let checkNow = () => {}; // the mounted idle timer's check; nothing to check while it isn't watching

/**
 * Coming back to the foreground refetches what is on screen (TanStack's focus refetch; a phone has no window focus event of
 * its own). The idle check runs first, so an expired session signs out to Sign In, and clears the cache, before anything
 * refetches with it. Called once, at module scope, by the root layout.
 */
export function refetchOnForeground() {
  focusManager.setEventListener((setFocused) => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') checkNow();
      setFocused(state === 'active');
    });
    return () => sub.remove();
  });
}

/**
 * Server mode only: signs out `idleSeconds − 30` after the last successful request, to Sign In (design § 4.4);
 * re-checked on every request and when the app comes back to the foreground.
 */
export function useIdleSignOut() {
  const watching = useSession((s) => s.mode === 'server' && s.user !== null);

  useEffect(() => {
    if (!watching) return;
    let limitMs = (DEFAULT_IDLE_SECONDS - MARGIN_SECONDS) * 1000;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let done = false;

    function check() {
      if (done) return;
      clearTimeout(timer);
      const left = lastActivityAt() + limitMs - Date.now();
      if (left > 0) {
        timer = setTimeout(check, left);
        return;
      }
      done = true;
      useSession.getState().signedOut(IDLE_MESSAGE, '/signin');
      currentServices().auth.signOut().catch(() => {}); // drop the tokens too; the server has (nearly) ended the session anyway
    }

    check();
    checkNow = check;
    // The server's own limit comes with the tokens (`idle_timeout_seconds`).
    defaultTokenStore()
      .get()
      .then((t) => {
        if (!t) return;
        limitMs = (t.idleSeconds - MARGIN_SECONDS) * 1000;
        check();
      })
      .catch(() => {});
    const stopActivity = onActivity(check);
    const sub = AppState.addEventListener('change', (state) => state === 'active' && check());
    return () => {
      done = true;
      checkNow = () => {};
      clearTimeout(timer);
      stopActivity();
      sub.remove();
    };
  }, [watching]);
}
