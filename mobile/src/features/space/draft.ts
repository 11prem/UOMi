import { create } from 'zustand';
import type { Currency, SpaceIcon } from '../../domain/types';

/**
 * The Create Space draft (specs § 6). It outlives the pop-up, so Back from Add People reopens the pop-up as it was.
 * `step`: `name` = the pop-up is open on Home; `people` = Add People is open; `closed` = no flow in progress.
 * The step is set explicitly rather than read from screen focus: a covered screen is frozen and would not re-render.
 * `currency` stays null until picked; the pop-up shows the user's default currency until then.
 */
export type SpaceDraft = { step: 'closed' | 'name' | 'people'; name: string; icon: SpaceIcon; currency: Currency | null };

export const useSpaceDraft = create<SpaceDraft>(() => ({ step: 'closed', name: '', icon: 'home', currency: null }));

/** "+ Create Space": a fresh draft, first icon pre-selected. */
export const startSpaceDraft = () => useSpaceDraft.setState({ step: 'name', name: '', icon: 'home', currency: null });

/** Closed (✕, scrim, Back) or created. The fields stay until the next start, so a screen still showing them never flashes empty. */
export const endSpaceDraft = () => useSpaceDraft.setState({ step: 'closed' });

/** Add People left without creating (←, Android Back, Discard): the pop-up comes back with the draft. */
export function backToSpaceName() {
  if (useSpaceDraft.getState().step === 'people') useSpaceDraft.setState({ step: 'name' });
}

/** Space names are 1–30 characters once trimmed (specs § 6.1). */
export const validSpaceName = (name: string) => name.trim().length >= 1 && name.trim().length <= 30;
