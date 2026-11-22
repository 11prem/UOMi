# Product

<!-- impeccable:product-schema 1 -->

## Platform

adaptive

One UOMi design language on both iPhone and Android (team decision, 2026-11-06). The app does not switch look per OS; per-OS adaptation is limited to system behaviour each platform guarantees: safe-area/edge-to-edge insets, iOS edge-swipe back and Android system/predictive Back, keyboard (IME) insets, OTP autofill, Reduce Motion / Remove animations, and text-size scaling.

## Stack

- **UI prototype (current phase):** static HTML/CSS/JS, viewed at phone size (390×844 canvas, no drawn device frame). Its purpose is to confirm the UI before the native build.
- **Production app (next phase):** delegated — React Native + Expo (managed), TypeScript, iOS + Android. Rationale and libraries in `specs.md` § 15.
- Frontend only in both phases; all server behaviour is a mock data layer (`specs.md` § 14).

## Users

People who share money with the same small circle, in four situations (all confirmed as primary):

- **Flatmates / roommates** — rent, groceries, bills; small amounts, weekly, for months.
- **Friends on trips and outings** — many expenses in a short burst, then everyone settles.
- **Couples / family** — long-running shared household spending between 2–4 people.
- **Office colleagues** — team lunches, cab shares, gifts, among people who aren't close friends.

The job in every case: record who paid what, agree on who owes whom, and settle up without awkwardness.

## Product Purpose

UOMi lets a group (a **Space**) log shared expenses, see pairwise balances, and record settlements made outside the app. Success: every member of a space sees the same, agreed balance, and settling up is a two-tap, low-friction act.

## Positioning

UOMi treats a debt as something both sides agree to, not something one person declares: every person in a split **accepts or rejects their share**, a rejection goes back to the expense's creator, and a recorded payment only counts once the **receiver confirms** it. Balances are only ever built from agreed facts.

## Operating Context

- Used on a phone, often right after the moment of spending (dinner table, cab, checkout) — entry must be fast and one-handed.
- Money moves outside the app (UPI, cash, bank transfer); UOMi only records it.
- India-first: ₹ and Indian digit grouping are the default; phone numbers and currencies from any country are supported. Each Space has one currency.
- Notifications drive the answer loop (accept/reject share, confirm/reject payment).

## Capabilities and Constraints

Full screen-by-screen behaviour lives in `specs.md` (Draft v3). Durable facts:

- Terminology: **Space** (never "group" in the UI), expense, share, payment/settle up.
- Four split types: Equally, Exact, Percent, Shares. Single payer per expense.
- Pairwise balances, no debt simplification; amounts in different currencies are never summed.
- Permissions: only a space's creator can delete it; other members can leave; only an expense's creator can edit or delete it.
- Phone verified by OTP at sign-up; Forgot Password = username → masked phone → OTP.
- No real payments, no backend, no push delivery in the current phases.

## Brand Commitments

- Name: **UOMi**.
- Typeface: **Fraunces** (`assets/fonts/fraunces/Fraunces-Variable.ttf`, OFL), pinned by the team. The file's default instance is weight 900 with WONK on, and it has no tabular figures; see `specs.md` § 3.8.
- Brand template and logo are **not created yet**. Do not invent a logo mark; use a plain "UOMi" wordmark in Fraunces until the brand exists.
- Must not feel like a **bank** (cold, corporate, form-heavy) or like **every fintech** (purple gradients, glassy cards, the standard payments-app template). Team's words, 2026-11-06.

## Evidence on Hand

- `specs.md` (Draft v3), whiteboard sketches in `assets/sketches/`, flow map `image.png`.
- No real users, testimonials, metrics, or app-store presence. All names, amounts, and spaces in prototypes are synthetic demo data and must be labelled as such where they could be mistaken for real.

## Product Principles

1. **Agreed, not asserted.** Nothing changes a balance until the people it affects have agreed to it.
2. **Same number everywhere.** A balance shown anywhere matches the balance shown everywhere else.
3. **Owing a friend is normal.** Language and colour state facts without blame or alarm.
4. **Fast at the moment of spending.** Adding an expense takes seconds, one-handed.
5. **Respect the phone.** Behave like a native app on each OS, even with one shared look.

## Accessibility & Inclusion

- WCAG 2.2 AA contrast in both light and dark themes; colour never the only signal for owe/owed.
- Touch targets ≥ 44×44 pt (iOS) / 48×48 dp (Android).
- Text scales with the system size; Reduce Motion honoured.
- Authentication allows paste, password managers, and OTP autofill.
