import type { Share, SplitType } from '../../domain/types';
import { hundredths, minorToText } from './amountText';

export type SplitValues = Record<string, string>;

/** The number `computeSplit` (and the stored `Share.input`) takes from what was typed in one row. */
function inputOf(type: SplitType, text: string): number | null {
  if (type === 'equal') return null;
  if (type === 'shares') return text === '' ? 1 : Number(text); // a whole count; an empty box is 1, as the prototype and the service read it
  const h = hundredths(text);
  return h === null ? null : h / 100; // exact: major units (12.50), percent: a percentage (33.33)
}

/**
 * The split rows for the ticked people, in `memberIds` order: leftover units go one at a time in member-list order
 * (specs § 1), and the demo service recomputes the split from the rows exactly as sent.
 */
export function splitRows(memberIds: string[], on: Record<string, boolean>, values: SplitValues, type: SplitType) {
  return memberIds.filter((id) => on[id]).map((userId) => ({ userId, input: inputOf(type, values[userId] ?? '') }));
}

/** Fresh values for a split type: nothing typed, except 1 share for everyone ticked (specs § 8.2). */
export function clearedValues(memberIds: string[], on: Record<string, boolean>, type: SplitType): SplitValues {
  return Object.fromEntries(memberIds.map((id) => [id, type === 'shares' && on[id] ? '1' : '']));
}

/** A stored share's `input` back as the text of its field (edit). */
export function valueText(type: SplitType, input: Share['input']): string {
  if (input === null || type === 'equal') return '';
  return type === 'shares' ? String(input) : minorToText(Math.round(input * 100));
}
