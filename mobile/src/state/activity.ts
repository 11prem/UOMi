// The clock the server-mode idle timer reads. A leaf module (no imports), so the services registry and the idle timer
// can both use it without a require cycle.

let last = Date.now();
const listeners = new Set<() => void>();

/** Every successful server request (`onActivity`) restarts the idle count. */
export function markActivity() {
  last = Date.now();
  listeners.forEach((l) => l());
}

export const lastActivityAt = () => last;

/** Called after each `markActivity`; returns the unsubscribe. */
export function onActivity(listener: () => void): () => void {
  listeners.add(listener);
  return () => void listeners.delete(listener);
}
