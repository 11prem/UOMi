# UOMi mobile app + backend wiring — design

**Date:** 2026-11-06 · **Status:** draft for approval
**Inputs:** `specs.md` (Draft v3.1, screens and rules), `DESIGN.md` (visual system), `prototype/` (approved HTML prototype), `PRODUCT.md`, the backend team's Round 1 code (`app/`, `migrations/`, `tests/`), three reviews of that code (plan conformance, FastAPI quality, security), and the user's answers of 2026-11-06.

Marks: **[User]** = decided by the user on 2026-11-06. **[Call]** = my decision; overturn it if wrong.

---

## 1. Intent

Finish the UOMi frontend that `specs.md` describes, as a real Android app the team installs from a single APK file, and connect it to the backend that exists today. The team tests only by sideloading the APK onto a phone, so the APK must open and work with nothing else installed or running.

The backend covers sign-in, sessions, forgot password, spaces, people search and notifications. It differs from the plan in several places; the user asked for those gaps to be fixed in the backend.

## 2. User decisions

1. **[User]** Mobile only. The deliverable is a **standalone release APK** (JavaScript bundled inside; no Expo Go, no Metro, no dev server). After the build I report its path.
2. **[User]** The APK is built **locally on this PC** (JDK 17 + Android SDK in `%LOCALAPPDATA%\uomi-toolchain`; the user accepted the Android SDK licence).
3. **[User]** **Demo data by default, plus a server switch.** Out of the box the app runs on the built-in demo data of `specs.md` § 14. A Server setting points it at a backend URL; in server mode the features the backend serves use the real backend.
4. **[User]** **Fix the backend's gaps against the plan** (space currency, balance rule, integer money, notification fields, mark-all-read, unread count — detail in § 5).
5. **[User]** **Sign-up and Forgot password keep the spec flows.** The backend has no phone code at sign-up and resets by phone number instead of username, so in server mode **Create Account** and **Forgot password** show "Not available on this server yet". Demo mode has the full flows.
6. **[User]** The backend's **10-minute idle sign-out applies in server mode only.** Demo mode follows the spec (stays signed in).
7. **[User]** The Home **Overall banner shows one net figure per currency** (`specs.md` § 5.1), not the prototype's gross "You owe / You're owed" pair.
8. **[User]** Nobody else is editing the backend right now, so the § 5 changes are made **directly** (breaking renames allowed). They stay **uncommitted** in this folder for the user to review, with `BACKEND-DEVIATIONS.md` explaining every change to the backend team.

## 3. Goals, non-goals, anti-goals

### Goals
1. **Demo mode:** every screen in `specs.md` §§ 4–13 works on the phone with loading, empty, error and success states, and the core money loop (create space → add expense → accept/reject share → balances → settle up → confirm) works using the debug "Act as…" switch (§ 14.1).
2. **Server mode** works end-to-end against the backend for: Sign In, Logout, session refresh and idle sign-out, Home (notification card, unread badge, overall balance per currency, space cards), Create Space (name, icon, currency, people search, add people), Space Page (balance, pairwise breakdown, expense list as the backend returns it), Notifications (list, mark read, mark all read), Profile (name, phone, username from the backend).
3. Light and dark themes, matching `DESIGN.md` and the prototype.
4. One APK file installs and opens on an Android phone with no other dependency.

### Non-goals
- iOS build and testing. **[Call]** The code stays cross-platform (Expo), but only Android is built and checked in this round.
- Play Store release signing. **[Call]** The APK is signed with the standard debug key so it can be sideloaded.
- New backend features beyond § 5: expense, settlement, transaction and profile-edit endpoints; space rename/add/remove/leave/delete endpoints; sign-up phone codes; username-based reset. In server mode those screens or actions show "Not available on this server yet".
- Real SMS, push notifications and payments (as in `specs.md` § 0).

### Anti-goals (failure even if it "works")
- The `specs.md` § 0 anti-goals (balances disagreeing between screens, rounding that loses or invents a paisa, summing different currencies, colour as the only owe/owed signal).
- The APK needs anything else (a computer, Expo Go, a server) just to open and be explored.
- Server mode shows demo data mixed in with real data.

## 4. Frontend

### 4.1 Stack
As in `specs.md` § 15: React Native + Expo (managed, current SDK from `create-expo-app`), TypeScript, Expo Router, TanStack Query, Zustand, React Hook Form + Zod, AsyncStorage, expo-secure-store, libphonenumber-js, `Intl.NumberFormat`, expo-font, expo-image-picker, Jest + React Native Testing Library. **[Call]** No libraries beyond this list without a written reason. The app lives in a new top-level folder `mobile/`.

### 4.2 Look
`DESIGN.md` is the visual source of truth and the prototype (`prototype/`) is the reference for layout and copy. The tokens in `prototype/css/tokens.css` (light and dark) become one theme module; no colour is hard-coded on a screen. Fonts: the five static Fraunces instances from `specs.md` § 3.8 (WONK 0, SOFT 0; Text opsz 14 at 400/600/700; Display opsz 72 at 600/700), **[Call]** generated once with fontTools from `assets/fonts/fraunces/Fraunces-Variable.ttf` and committed under `mobile/assets/fonts/`.

### 4.3 Data layer
One service module per area, with the interfaces of `specs.md` § 14.4. Two implementations sit behind each interface:

- **Demo** — `specs.md` § 14.1 exactly: data persisted in AsyncStorage, 300–800 ms fake delay, error switch, "Act as…", Reset demo data, OTP `123456`, the § 14.5 seed, and the § 14.2 balance rules in one shared calculator.
- **Server** — an HTTP client for the backend (contract below).

A **mode** setting (`demo` | `server`) chooses the implementation at runtime. Switching mode signs the user out and clears all cached data, so the two never mix.

In server mode, an operation the backend can't serve throws a `NotOnServer` error. Screens show one shared panel, "Not available on this server yet", and buttons for those actions are disabled with that reason. This covers Create Account, Forgot password, Add/Edit/Delete expense, accept/reject share, Settle Up, Settlement actions, Transactions, Edit Profile, preferences that need saving, and every Members & Space Settings action.

### 4.4 Server mode behaviour
- **Where the setting lives:** a "Server" sheet, opened by long-pressing the UOMi wordmark on the Welcome screen (so it's reachable before sign-in), and also from the Profile debug menu (§ 14.1). The sheet has three parts: Mode (Demo / Server), Server URL (e.g. `http://192.168.1.20:8000`), and **Test connection** (calls `GET /health`). The settings persist across app restarts.
- **Tokens:** the access token is sent as a bearer token, and both tokens are kept in expo-secure-store. When a request returns `401 token_expired`, the app makes one refresh call (never two at once, because the refresh token changes on every refresh) and then retries the request once. When a request returns `session_expired`, `invalid_token`, `invalid_refresh_token` or `not_authenticated`, the app signs out to Welcome with a toast "You were signed out".
- **Idle sign-out:** a client timer uses `idle_timeout_seconds` from the sign-in response. It restarts on every successful authenticated request and is checked again when the app returns from the background. When it runs out, the app returns to Sign In.
- **Who am I:** the app gets the signed-in user from `GET /users/me` (new, § 5).
- **Network:** **[Call]** Cleartext HTTP is allowed in this test APK (through expo-build-properties), so a laptop on the same Wi-Fi can serve the backend over plain `http://`. The backend must run with `--host 0.0.0.0`, and the user may have to allow Windows Firewall's prompt.
- **Who uses server mode:** **[Call]** whoever runs the backend on their own PC. No hosted backend exists, so other testers use demo mode. Hosting, HTTPS and public-deployment hardening are out of scope.
- **USB fallback:** **[Call]** if the company network or firewall blocks phone-to-laptop Wi-Fi traffic, plug the phone in, run `adb reverse tcp:8000 tcp:8000`, and use `http://127.0.0.1:8000` as the Server URL. The README documents both routes.
- **Debug menu in the APK:** **[Call]** `specs.md` § 14.1 says to leave the debug menu ("Act as…", error switch, Reset demo data) out of production builds. This APK is a test build, so it keeps the debug menu.

### 4.5 App identity
**[Call]** App name **UOMi**, Android package `com.uomi.app`, version `0.1.0`. The APK is copied to `dist/UOMi-0.1.0.apk` in the repo (git-ignored) as well as Gradle's own output folder.

## 5. Backend changes

These are the changes the user approved as "fix the gaps". The backend team's structure (routers → services → models, Alembic, pytest) is kept, and the schema changes go in a new migration `0002`, not by editing `0001`.

1. **Space currency.** Add `spaces.currency` (ISO 4217 code). **[Call]** Supported codes: INR, USD, EUR, GBP, AED, SGD, AUD, CAD. It is set at creation and defaults to the creator's default currency. Create, list and detail all return it.
2. **Integer money.** Every money column and API field becomes integer minor units (`amount_minor`, `balance_minor`, …). Floats on SQLite disappear.
3. **Balance rule = `specs.md` § 14.2.** Pending and accepted shares count. An expense with any rejected share is excluded entirely (disputed). Confirmed payments count; pending, rejected and cancelled payments don't. Balances stay pairwise.
4. **Home data in one call.** `GET /spaces` returns:
   - `overall`, one entry per currency `{currency, net_minor, owe_minor, owed_minor}` (never summed across currencies). **[User]** The app shows `net_minor`. The gross pair is returned too, so a later switch to the prototype's wording only changes one screen.
   - Per space:
     - `currency` and `balance_minor`.
     - `open_balances`: the number of non-zero pairwise balances.
     - **[Call]** `counterparty_name` and `counterparty_count`: the people on the side of the net amount, as the prototype does. "You owe ₹20 · Swetha" when one person is on that side, "· 2 people" when several. If you owe Swetha ₹50 and Arun owes you ₹30, the card reads "You owe ₹20 · Swetha". The demo calculator uses the same rule, so both modes read the same.
     - `last_activity_at`.
   - Spaces sorted by `last_activity_at`, newest first.
5. **Space detail.** `GET /spaces/{id}` adds `owner_username`, `created_at` and `currency`, and returns amounts as minor units.
6. **Data model aligned with `specs.md` § 14.3** (tables only, no new endpoints):
   - Split types become `equal | exact | percent | shares`.
   - Expenses gain `created_by`, a user-picked `date`, `updated_at` and a 1–50 character `description`; shares gain `input`.
   - Payment statuses become `pending | confirmed | rejected | cancelled`, with `answered_at`.
7. **Notifications match `specs.md` §§ 11, 14.3.**
   - Fields: `message`, `needs_answer`, `space_id`, `space_name`, `ref_id`, `read` and `created_at`.
   - Types are the seven in § 11.2.
   - New endpoints: `PATCH /notifications/read-all` → `{updated_count}` and `GET /notifications/unread-count` → `{unread_count}` (adopted from teammate PR #3, merged 2026-11-06), plus `unread_count` in the list response.
   - A "Space deleted" notification outlives its space.
8. **`GET /users/me`.** Returns username, name, phone and default currency.
9. **[Call] Bugs found by the reviews.** I'm editing these files anyway and each fix is small. Strike any you don't want.
   - CORS with an allowlist from settings, needed for the browser preview I use to check the screens.
   - One error shape (`{"detail": {"code", "message"}}`) for 404, 422 and 500 responses, with passwords no longer echoed in 422 responses.
   - IDs bounded so oversized numbers no longer cause 500 errors.
   - `.env.example` with `DEBUG=false`.
   - An atomic OTP wrong-guess counter. Today, parallel guesses can bypass the 5-try limit.
   - Phone normalisation that no longer adds `+91` twice to `91…` numbers.
10. **Dev seed script** `scripts/seed_demo.py`. It creates the `specs.md` § 14.5 users, with one shared test password recorded in the script, plus spaces in the four balance states. **[Call]** Seed expenses, shares and payments are inserted straight into the tables, so server mode shows real non-zero balances even though there are no expense endpoints yet. Without this, nobody can sign in in server mode, because sign-up is disabled there (§ 2.5).
11. **Not changed, but reported.** These are recorded in `BACKEND-DEVIATIONS.md` for the backend team:
    - Lockout, session and rotation design.
    - Search rules. **[Call]** Kept: friends match first and other people need 3 letters. This is stricter than the spec and protects privacy; the UI works either way.
    - Sign-up phone codes and username reset.
    - Space management endpoints, and the expense and settlement endpoints.
    - The public-deployment hardening items from the security review.
12. **Tests.** The 65 existing tests stay green (updated where a field changes shape), and every change above gets a test.

## 6. Verification

- **Backend:** `pytest` green; `alembic upgrade head` and `alembic check` clean; seed script runs.
- **Frontend unit tests:** money formatting (₹ Indian grouping, other currencies), the four split types with rounding (splits always add up), and the balance calculator rules of § 14.2.
- **Screens:** Expo web at 390×844 in the browser pane, walking every screen in demo mode (light and dark), then server mode against the local backend with the seed data.
- **APK:** `expo prebuild` + Gradle `assembleRelease`. Check that the APK contains the JS bundle (no dev-server dependency) and that the seed, fonts and icons are inside.
- **Not verifiable here:** there is no Android emulator or phone on this PC, so the first on-device run is the user's. I'll list exactly what to check.

## 7. Left to the builder
File layout inside `mobile/`, component breakdown, which animation primitives implement `DESIGN.md`'s paper motion (prefer what Expo ships), test granularity beyond § 6, and exact copy where `specs.md` and the prototype don't give it.
