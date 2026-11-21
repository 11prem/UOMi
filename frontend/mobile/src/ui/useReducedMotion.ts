import { useEffect } from 'react';
import { AccessibilityInfo } from 'react-native';
import { create } from 'zustand';

const store = create<{ reduced: boolean }>(() => ({ reduced: false }));
let watching = false;

/** The system "reduce motion" setting, read once and followed for the whole app. When on, motion becomes a crossfade. */
export function useReducedMotion(): boolean {
  useEffect(() => {
    if (watching) return;
    watching = true;
    AccessibilityInfo.isReduceMotionEnabled()
      .then((reduced) => store.setState({ reduced }))
      .catch(() => {});
    AccessibilityInfo.addEventListener('reduceMotionChanged', (reduced) => store.setState({ reduced }));
  }, []);
  return store((s) => s.reduced);
}
