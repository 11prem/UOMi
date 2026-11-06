import type { Services } from '../../services/types';

/**
 * What the viewer may do on Members & Settings (specs § 10, § 10.1), worked out up front from `spaces.get`, so a control
 * the service would refuse is shown disabled with its reason. Remove, Leave and Delete read every pair in the space
 * (`settledMemberIds`, `allSettled`), not just the viewer's; the service still has the last word (it throws `forbidden`
 * with the reason, which the screen toasts). A pair missing from `balance.pairs` counts as 0 (server mode lists only open pairs).
 */
export function memberRules(
  { space, balance, activity, settledMemberIds, allSettled }: Awaited<ReturnType<Services['spaces']['get']>>,
  meId: string,
  server: boolean,
) {
  const owner = space.ownerId === meId;
  const hasExpenses = activity.some((r) => r.kind === 'expense');
  const pairWith = (userId: string) => balance.pairs.find((p) => p.userId === userId)?.netMinor ?? 0;
  const settled = settledMemberIds.includes(meId);
  const live = !server; // server mode has no endpoint for any of these

  return {
    owner,
    pairWith,
    canEdit: live,
    canChangeCurrency: live && owner && !hasExpenses,
    currencyNote: hasExpenses
      ? 'Can’t change after expenses are added'
      : server
        ? 'Not available on this server yet'
        : owner
          ? 'Only you can change this'
          : 'Set by the owner',
    canAddPeople: live,
    /** The ⋯ menu: the owner, on anyone but themselves. */
    hasMenu: (userId: string) => live && owner && userId !== space.ownerId,
    canRemove: (userId: string) => live && owner && userId !== space.ownerId && settledMemberIds.includes(userId),
    /** Leave: everyone but the owner (null = not shown). */
    leave: owner
      ? null
      : { enabled: live && settled, note: settled ? 'You’re settled up, so you can leave.' : 'Settle up first — you have open balances here.' },
    /** Delete: the owner only (null = not shown). */
    remove: owner
      ? {
          enabled: live && allSettled,
          note: allSettled
            ? 'Deleting removes its expenses and payments for everyone. Everyone must be settled up.'
            : 'You can delete this space once everyone is settled up. As owner you can’t leave it.',
        }
      : null,
  };
}

export type MemberRules = ReturnType<typeof memberRules>;
