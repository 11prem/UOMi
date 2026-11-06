import { useCallback, useState } from 'react';
import { usePreventRemove } from 'expo-router';
import { useConfirm } from './ConfirmDialog';

/**
 * While `dirty`, leaving the screen — the ← button, `router.back()`, the Android Back button (which the router turns
 * into a back action) — first asks "Discard changes?" (Review Focus 4). A clean form just goes back.
 *
 * Returns `leave(go)`: run a navigation that must not ask, e.g. after a successful save: `leave(() => router.back())`.
 */
export function useDiscardGuard(dirty: boolean): (go: () => void) => void {
  const confirm = useConfirm();
  // Once the user chose to leave, prevention goes off in the same render, as usePreventRemove asks.
  const [released, setReleased] = useState(false);

  const disablePrevention = usePreventRemove(dirty && !released, ({ repeat }) => {
    confirm({ title: 'Discard changes?', body: 'What you’ve typed here will be lost.', ok: 'Discard', cancel: 'Keep editing', danger: true }).then((ok) => {
      if (!ok) return;
      setReleased(true);
      repeat();
    });
  });

  return useCallback(
    (go: () => void) => {
      setReleased(true);
      disablePrevention();
      go();
    },
    [disablePrevention],
  );
}
