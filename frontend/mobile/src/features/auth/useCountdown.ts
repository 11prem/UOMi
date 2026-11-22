import { useEffect, useState } from 'react';

/** Whole seconds left until `restart(n)` + n seconds. Counts from the clock, so a backgrounded app catches up when it wakes. */
export function useCountdown(initial: number) {
  const [endsAt, setEndsAt] = useState(() => Date.now() + initial * 1000);
  const [left, setLeft] = useState(initial);

  useEffect(() => {
    const tick = () => {
      const next = Math.max(0, Math.ceil((endsAt - Date.now()) / 1000));
      setLeft(next);
      if (next === 0) clearInterval(id);
    };
    const id = setInterval(tick, 1000);
    tick();
    return () => clearInterval(id);
  }, [endsAt]);

  // `left` is set here too, so the button is never enabled for the render between the call and the effect. A missing or
  // NaN wait from the server falls back to `initial` rather than counting to NaN (which would leave Resend enabled).
  function restart(seconds: number) {
    const wait = Number.isFinite(seconds) ? Math.ceil(Math.max(0, seconds)) : initial;
    setEndsAt(Date.now() + wait * 1000);
    setLeft(wait);
  }

  return { left, restart };
}
