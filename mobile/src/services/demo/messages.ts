import { formatMoney } from '../../domain/money';
import type { Currency } from '../../domain/types';

// The one line of text on each notification card (specs § 11.2), built when the card is created.
// The card shows the space name and the age separately, so neither is repeated here. `who` is a first name.

const money = (minor: number, currency: Currency) => formatMoney(minor, currency, { compact: true });

export const messages = {
  expenseShare: (who: string, description: string, shareMinor: number, currency: Currency) =>
    `${who} added ‘${description}’ — your share is ${money(shareMinor, currency)}`,
  shareRejected: (who: string, shareMinor: number, description: string, currency: Currency) =>
    `${who} rejected their ${money(shareMinor, currency)} share of ‘${description}’`,
  paymentToConfirm: (who: string, amountMinor: number, currency: Currency) =>
    `${who} says they paid you ${money(amountMinor, currency)}`,
  paymentAnswered: (who: string, verdict: 'confirmed' | 'rejected', amountMinor: number, currency: Currency) =>
    `${who} ${verdict} your ${money(amountMinor, currency)} payment`,
  spaceAdded: (who: string, spaceName: string) => `${who} added you to ‘${spaceName}’`,
  spaceDeleted: (who: string, spaceName: string) => `${who} deleted ‘${spaceName}’`,
  reminder: (who: string, amountMinor: number, currency: Currency) => `You owe ${who} ${money(amountMinor, currency)}`,
};
