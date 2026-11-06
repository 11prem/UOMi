# UOMi Mobile App + Backend Gap Fixes — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a standalone Android APK of the UOMi app (every `specs.md` screen, built-in demo data, optional server mode) and close the Round 1 backend's gaps against the plan.

**Architecture:** An Expo (React Native) app in `mobile/`. Screens read through one service layer with two implementations: `demo`, ported from `prototype/js/data.js` and persisted in AsyncStorage, and `server`, an HTTP client for the FastAPI backend. Pure domain modules (money, splits, balances) are shared by both. The backend keeps its routers → services → models layout and gets one new Alembic migration `0002`.

**Tech Stack:** Expo SDK from `create-expo-app@latest` (npm reports `expo` 58.x), TypeScript, Expo Router, TanStack Query, Zustand, React Hook Form + Zod, AsyncStorage, expo-secure-store, libphonenumber-js, expo-image-picker, react-native-svg, expo-build-properties, Jest + jest-expo + React Native Testing Library. Backend: FastAPI, SQLAlchemy 2, Alembic, pytest, Python 3.14 venv at `%LOCALAPPDATA%\uomi-venv`.

**Spec:** `docs/superpowers/specs/2026-11-06-uomi-mobile-app-design.md` (the design), which argues from `specs.md` (screens and rules), `DESIGN.md` (visual system) and `prototype/` (approved layout and copy). Read the design first, then the `specs.md` sections your task names.

## Global Constraints

- **No git commits, no branches, no pushes.** The user reviews every change uncommitted (design § 2.8). Each task ends with its tests passing, not with a commit.
- Do not touch `prototype/`, `specs.md`, `DESIGN.md` or `PRODUCT.md`.
- Backend Python: run everything with `C:\Users\prem.b\AppData\Local\uomi-venv\Scripts\python.exe` (a hook blocks bare `python` and `uv pip`). Tests: `...\python.exe -m pytest -q` from the repo root. Set `SECRET_KEY` (≥32 chars) in the environment for alembic/uvicorn; never create `.env` in the repo.
- Frontend: Node 26 / npm 11 are installed. Run npm/npx from `mobile/`. Tests: `npx jest`. Type check: `npx tsc --noEmit`.
- UI copy says **Space**, never "group". Balance wording comes from `prototype/js/app.js` `balPhrase` ("You owe ₹X", "You’re owed ₹X", "Settled up", "₹0 net · N open balances").
- Money is integer minor units everywhere (frontend and backend). Never `parseFloat` a money string. Splits always add up to the total (`specs.md` § 1 rounding rule: leftover units go one at a time in member-list order).
- Amounts in different currencies are never summed. Colour is never the only owe/owed signal.
- No colour, size or font literal on a screen: everything comes from `mobile/src/theme`. Fraunces only (five static instances), WONK 0 / SOFT 0.
- Touch targets ≥ 44 pt. Every icon-only button has an `accessibilityLabel` (`specs.md` § 3.6 examples).
- Supported currencies: `INR, USD, EUR, GBP, AED, SGD, AUD, CAD`. Space icons: `home, trip, food, office, friends, car, party, other`.
- Demo test values: password `demo1234` for every seeded user, OTP `123456`. The backend seed uses the same users and password.
- Server-mode-only rules: 10-minute idle sign-out; Create Account, Forgot password and every operation without an endpoint show **"Not available on this server yet"**.
- Libraries: only the Tech Stack list above. `react-native-svg` is there to draw the prototype's stroked SVG icon paths; `expo-build-properties` allows cleartext HTTP. Anything else needs a written reason in the task report.

## Review Focus

1. **Server unreachable or stops mid-session** (wrong URL, phone off Wi-Fi, laptop asleep). Expected: a request fails with code `network`, the screen shows its Error state with Retry and keeps any data already on screen, and the user stays signed in. Test owned by Task 9.
2. **App killed and reopened.** Expected: demo mode is still signed in with the data persisted. Server mode restores its tokens, but goes to Sign In if more than `idle_timeout_seconds − 30` has passed since the last request. Tests owned by Task 8 (demo persistence) and Task 9 (token restore + idle check on launch).
3. **Switching Demo ↔ Server with data cached.** Expected: the user is signed out, the TanStack Query cache is cleared, and no demo item is ever shown in server mode. Test owned by Task 10.
4. **Android Back with unsaved input** on any form (Create Account, Add People, Add/Edit Expense, Settle Up, Edit Profile). Expected: "Discard changes?" confirm; Back with a clean form just goes back. Test owned by Task 10 (`useDiscardGuard`).
5. **Big text and narrow phones** (320 dp wide, system font scale 2.0). Expected: amounts, OTP cells and tab labels don't clip. Tab labels and OTP digits are capped at `maxFontSizeMultiplier={1.5}` (`specs.md` § 3.8). Test owned by Task 10 (TabBar/OtpInput props) plus the manual check in Task 15.

---

## Backend contract after the fixes (Tasks 2–5 produce it; Task 9 consumes it)

All fields snake_case. Datetimes ISO-8601 UTC with `Z`. Money fields end in `_minor` and are integers. Every error body is `{"detail": {"code": str, "message": str, ...extra}}`.

| Endpoint | Change | Shape |
|---|---|---|
| `GET /users/me` | new, Bearer | `{username, name, phone, currency}` (`phone` is the caller's own E.164 number, `currency` their default) |
| `POST /spaces` | adds `currency` | request `{name, icon, currency?, usernames}`; `currency` must be a supported code (422 `validation_error` otherwise), default = caller's `users.currency`; response = space detail |
| `GET /spaces` | reshaped | `{overall: [{currency, net_minor, owe_minor, owed_minor}], spaces: [SpaceCard]}` |
| `SpaceCard` | | `{id, name, icon, currency, member_count, balance_minor, open_balances, counterparty_name, counterparty_count, last_activity_at}` |
| `GET /spaces/{id}` | reshaped | `{id, name, icon, currency, owner_username, created_at, balance_minor, members: [{username, name, position}], expenses: [ExpenseRow], settlements: [SettlementRow], pairwise: [{debtor: {username, name}, creditor: {username, name}, amount_minor}]}` |
| `ExpenseRow` | | `{id, description, amount_minor, split_type, paid_by: {username, name}, created_by: {username, name}, date, created_at, updated_at, my_share_minor, my_share_status, disputed}` (`date` is `YYYY-MM-DD`) |
| `SettlementRow` | | `{id, from_user: {username, name}, to_user: {username, name}, amount_minor, status, created_at, answered_at}` |
| `GET /notifications` | reshaped | `{items: [NotificationOut], next_before, unread_count}` |
| `NotificationOut` | | `{id, type, message, space_id, space_name, ref_id, needs_answer, read, created_at}`; `type ∈ expense_share, share_rejected, payment_to_confirm, payment_answered, space_added, space_deleted, reminder`; `ref_id` = expense id for `expense_share`/`share_rejected`, settlement id for `payment_*`, otherwise null |
| `PATCH /notifications/{id}` | field rename | request `{read: bool}` → `NotificationOut` |
| `PATCH /notifications/read-all` | new (from PR #3) | `200 {updated_count}`, marks all of the caller's unread notifications read |
| `GET /notifications/unread-count` | new (from PR #3) | `200 {unread_count}`, the caller's unread count (badge) |
| Error envelope | unified | 422 → `{code: "validation_error", message, fields: [{field, message}]}` (no `input`/`ctx` echo); unknown path → `not_found`; wrong method → `method_not_allowed`; unhandled → `internal_error` (500, JSON) |

Pairwise semantics (shared by backend `balance_service` and frontend `domain/balances.ts`):
- A share counts toward balances when its expense is **not disputed** (no share `rejected`) and the share's own status is `pending` or `accepted`.
- The payer's own share never counts.
- Settlements count only when `confirmed`.
- From the viewer's side, a pair's amount is positive when the other person owes the viewer. `balance_minor` = the sum of the viewer's pairs.
- `open_balances` = the number of the viewer's non-zero pairs.
- **Counterparty** = the people on the side of the net: those the viewer owes when `balance_minor < 0`, those who owe the viewer when it is `> 0`, nobody when it is 0. `counterparty_count` = how many there are; `counterparty_name` = that person's name when the count is 1, otherwise `null`.
- `overall`, per currency, sums over the viewer's spaces in that currency: `owe_minor` = Σ|negative pairs|, `owed_minor` = Σ positive pairs, `net_minor = owed_minor − owe_minor`. Only currencies with a non-zero `owe_minor` or `owed_minor` are listed.
- `last_activity_at` = the latest of the space's `created_at`, its expenses' `updated_at`, and its settlements' `created_at`/`answered_at`. It is computed in the query, not stored. Spaces are sorted by it, newest first.
- `counterparty_name` is the person's **full** name. The app shows only the first word ("Meera Shah" → "· Meera"), as the prototype's `U.first` does.

### Seed expected values (shared by Task 5 and Task 8)

These were computed by running `prototype/js/data.js` itself in Node (the script is in the scratchpad as `seed_expected.js`). Values are for viewer `kabir.r`. The seed dates are offsets from "now", so the values don't depend on the date. The seed has 10 expenses, 4 settlements and 7 notifications.

| Space | currency | balance_minor | open_balances | counterparty_count | counterparty_name |
|---|---|---|---|---|---|
| Flat 4B | INR | -47334 | 2 | 2 | null |
| Goa Trip | INR | 1014000 | 2 | 2 | null |
| Office lunches | INR | 0 | 0 | 0 | null |
| Dubai stopover | USD | 3500 | 1 | 1 | "Meera Shah" |
| Sunday cricket | INR | 0 | 2 | 0 | null |

`overall` for kabir.r: `[{INR, net 966666, owe 87334, owed 1054000}, {USD, net 3500, owe 0, owed 3500}]`.

---

## Task 1: Backend data model and migration 0002

**Files:**
- Modify: `app/models/expense.py`, `app/models/expense_split.py`, `app/models/payment.py`, `app/models/group.py`, `app/models/notification.py`, `app/models/__init__.py`
- Create: `migrations/versions/0002_spec_alignment.py`
- Modify (only to keep the suite green): `app/services/balance_service.py`, `app/services/group_service.py`, `app/services/notification_service.py`, `app/schemas/group.py`, `app/schemas/notification.py`, `tests/helpers.py`, `tests/test_spaces.py`, `tests/test_notifications.py`
- Test: `tests/test_migrations.py`

**Interfaces — Produces:**
- `SplitType`: `EQUAL="equal", EXACT="exact", PERCENT="percent", SHARES="shares"` (`ITEM` removed).
- `Expense`: `description: str (String(50))` (renamed from `title`), `amount_minor: int`, `created_by: str` (FK users), `date: datetime.date`, `updated_at: datetime` (default and onupdate `utcnow`), plus the existing `id, space_id, paid_by, split_type, created_at`.
- `ExpenseShare`: `amount_minor: int`, `input: str | None (String(20))` (what was typed: an amount in minor units, a percentage or a share count, stored as text).
- `SettlementStatus`: `PENDING, CONFIRMED, REJECTED, CANCELLED`. `Settlement`: `amount_minor: int`, `answered_at` (renamed from `confirmed_at`).
- `Space`: `currency: str (String(3), server_default "INR")`.
- `NotificationType`: `EXPENSE_SHARE, SHARE_REJECTED, PAYMENT_TO_CONFIRM, PAYMENT_ANSWERED, SPACE_ADDED, SPACE_DELETED, REMINDER`, with lowercase values as in the contract.
- `Notification`: `message: Text` (replaces `title` + `body`), `space_name: String(100) | None`, `needs_answer: bool`, `read: bool` (renamed from `is_read`), and `space_id` FK `ondelete="SET NULL"`.

- [ ] **Step 1: Write the failing test** `tests/test_migrations.py::test_upgrade_head_matches_models`. It runs `alembic upgrade head` on a temp SQLite file (set `DATABASE_URL` and `SECRET_KEY` in `os.environ` before importing `app`), then runs `alembic check` and asserts no new upgrade operations. Also add `test_0002_converts_money_to_minor_units`: upgrade to `0001`, insert an expense with `amount=123.45` through raw SQL, upgrade to `head`, and assert `amount_minor == 12345`.
- [ ] **Step 2: Run** `...\python.exe -m pytest tests/test_migrations.py -q`. Expected: FAIL (no revision 0002).
- [ ] **Step 3: Change the models** to the Interfaces above. Write `0002_spec_alignment.py` with `op.batch_alter_table` (SQLite). Each rename and type change keeps its data: money `ROUND(amount*100)`; notification `message = COALESCE(NULLIF(body,''), title)`; old enum names map `SHARE_REQUEST→EXPENSE_SHARE`, `SHARE_RESPONSE→SHARE_REJECTED`, `SETTLEMENT_REQUEST→PAYMENT_TO_CONFIRM`, `PAYMENT_REMINDER→REMINDER`, `ITEM→EXACT`; `expenses.created_by` is backfilled from `paid_by`, `date` from `created_at`, and `updated_at` from `created_at`. Write a working `downgrade()` as well. Do not import `app.database` in the migration: inline `sa.DateTime(timezone=True)`.
- [ ] **Step 4: Fix the existing code and tests** that read the renamed fields, so that `...\python.exe -m pytest -q` is green. Keep API shapes as they are for now (Tasks 2–4 reshape them); only the attribute access changes.
- [ ] **Step 5: Run** `...\python.exe -m pytest -q`. Expected: all pass, including both new migration tests.

## Task 2: Backend balances and spaces API

**Files:**
- Modify: `app/services/balance_service.py`, `app/services/group_service.py`, `app/schemas/group.py`, `app/routers/groups.py`
- Create: `app/currencies.py` (`SUPPORTED_CURRENCIES: tuple[str, ...]` = the eight codes)
- Test: `tests/test_balances.py` (new), `tests/test_spaces.py` (update)

**Interfaces:**
- Consumes: Task 1 models.
- Produces:
  - `balance_service.pairwise(db, space_id) -> dict[tuple[str, str], int]`: key `(a, b)` with `a < b`; value > 0 means b owes a.
  - `balance_service.viewer_pairs(db, space_id, username) -> dict[str, int]`: other username → signed amount from the viewer's side.
  - `balance_service.space_card(db, space, username) -> SpaceCard`.
  - `balance_service.overall(db, username) -> list[OverallLine]`.
  - The contract's `GET /spaces`, `GET /spaces/{id}` and `POST /spaces` shapes.

- [ ] **Step 1: Write failing tests** in `tests/test_balances.py`. Seed the rows straight through the ORM (helpers in `tests/helpers.py`).
  - `test_pending_share_counts`: Alice pays 30000 split equally with Bob and Carol, all shares pending. Alice's `balance_minor == 20000`.
  - `test_disputed_expense_excluded`: the same expense with Carol `rejected`. Alice's `balance_minor == 0`, and the row has `disputed is True`.
  - `test_confirmed_settlement_counts_pending_does_not`: Bob owes Alice 10000 and has a pending 4000 settlement → 10000. Once it is confirmed → 6000.
  - `test_counterparty_side_of_net`: Alice owes Swetha 5000 and Arun owes Alice 3000. The card shows `balance_minor == -2000`, `open_balances == 2`, `counterparty_count == 1`, `counterparty_name == "Swetha"`.
  - `test_zero_net_open`: owes 3000 and is owed 3000 → `balance_minor == 0`, `open_balances == 2`, `counterparty_count == 0`.
  - `test_overall_per_currency_never_summed`: an INR space at −2000 and a USD space at +1500 → `overall` contains `{INR, net −2000, owe 2000, owed 0}` and `{USD, net 1500, owe 0, owed 1500}`.
  - `test_spaces_sorted_by_last_activity`: a newer expense in an older space moves that space first.
  - `test_create_space_currency`: `POST /spaces` with `"currency":"USD"` → 201, and `currency == "USD"` on create, list and detail. `"XYZ"` → status 422 (Task 4 later adds the `validation_error` code assertion to this test). Missing → the user's default `"INR"`.
  - `test_space_detail_shape`: the response has exactly the contract's keys, `owner_username` is the creator, and a settlement appears in `settlements`.
- [ ] **Step 2: Run** `...\python.exe -m pytest tests/test_balances.py -q`. Expected: FAIL.
- [ ] **Step 3: Implement** the Produces list. Use grouped queries, not per-row queries (no N+1). The 50-row cap on expenses stays.
- [ ] **Step 4: Update** `tests/test_spaces.py` to the new shapes (`balance_minor`, `expenses`, `pairwise`).
- [ ] **Step 5: Run** `...\python.exe -m pytest -q`. Expected: all pass.

## Task 3: Backend notifications and `/users/me`

**Files:**
- Modify: `app/services/notification_service.py`, `app/schemas/notification.py`, `app/routers/notifications.py`, `app/services/group_service.py` (the `space_added` message), `app/routers/users.py`, `app/schemas/user.py`
- Test: `tests/test_notifications.py` (update), `tests/test_users_me.py` (new)

**Interfaces:**
- Consumes: Task 1 `Notification` model.
- Produces: the contract's notification endpoints and `GET /users/me`. `create_notification(db, *, username, type, message, space_id=None, space_name=None, ref_id=None, needs_answer=False)` is used by every caller. The `space_added` message is `f"{creator.name} added you to ‘{space.name}’"`, with `space_name` set.

- [ ] **Step 1: Write failing tests:**
  - `test_list_has_unread_count_and_new_fields`: after one space is created for Bob, Bob's list shows `unread_count == 1`. The item has `message`, `space_name`, `needs_answer is False` and `read is False`, and has no `title`, `body` or `is_read`.
  - `test_read_all`: three unread → `PATCH /notifications/read-all` → 200 `{updated_count: 3}`, then `unread_count == 0`. Another user's notifications are untouched. (Updated after PR #3 was adopted.)
  - `test_patch_read_field`: `PATCH {"read": true}` → `read is True`. `{"is_read": true}` → 422.
  - `test_space_deleted_notification_survives_space_delete`: insert a `space_deleted` notification with `space_id`, delete the space row, and check the notification remains with `space_id is None` and `space_name` intact.
  - `test_users_me`: returns the signed-in user's `username`, `name`, `phone` and `currency`. Without a token → 401 `not_authenticated`.
- [ ] **Step 2: Run** the two test files. Expected: FAIL.
- [ ] **Step 3: Implement.** `unread_count` is one `COUNT` query.
- [ ] **Step 4: Run** `...\python.exe -m pytest -q`. Expected: all pass.

## Task 4: Backend fixes from the reviews

**Files:**
- Modify: `app/main.py`, `app/config.py`, `.env.example`, `app/utils/errors.py`, `app/services/auth_service.py`, `app/utils/validators.py`, `app/routers/groups.py`, `app/routers/notifications.py`
- Test: `tests/test_hardening.py` (new)

**Interfaces — Produces:**
- `settings.CORS_ORIGINS: list[str]`, default `["http://localhost:8081", "http://127.0.0.1:8081"]`, read from the env as a comma-separated string.
- The unified error envelope from the contract.

- [ ] **Step 1: Write failing tests** in `tests/test_hardening.py`:
  - `test_cors_preflight_allowed_origin`: `OPTIONS /auth/login` with `Origin: http://localhost:8081` and request headers `content-type,authorization` → 200, `access-control-allow-origin == "http://localhost:8081"`, and `Retry-After` in `access-control-expose-headers`.
  - `test_cors_other_origin_refused`: `Origin: http://evil.test` → no `access-control-allow-origin` header.
  - `test_validation_error_envelope_no_echo`: a register call with password `"short"` → 422 with `detail.code == "validation_error"` and `detail.fields[0].field == "password"`, and the body text does not contain `"short"`.
  - `test_not_found_envelope`: `GET /nope` → 404 `{"detail": {"code": "not_found", ...}}`.
  - `test_oversized_ids_are_422_not_500`: `GET /spaces/99999999999999999999`, `GET /notifications?before=99999999999999999999` and `PATCH /notifications/99999999999999999999` → 422.
  - `test_phone_with_country_code_no_plus`: `normalize_phone("91 98765 43210") == "+919876543210"`, and `normalize_phone("9876543210") == "+919876543210"`.
  - `test_otp_attempts_counted_atomically`: for the code row, call `verify_otp` with a wrong code from 8 threads (each using its own DB session on a file-backed SQLite DB). Then `attempts == min(8, OTP_MAX_ATTEMPTS)` and the code is dead.
  - `test_env_example_debug_false`: `.env.example` contains the line `DEBUG=false`.
- [ ] **Step 2: Run** `...\python.exe -m pytest tests/test_hardening.py -q`. Expected: FAIL.
- [ ] **Step 3: Implement.**
  - CORS: `CORSMiddleware(allow_origins=settings.CORS_ORIGINS, allow_credentials=False, allow_methods=["*"], allow_headers=["Authorization", "Content-Type"], expose_headers=["Retry-After"])`.
  - Exception handlers for `RequestValidationError`, `StarletteHTTPException` and `Exception`.
  - ID bounds: `Path(ge=1, le=2**31 - 1)` / `Query(ge=1, le=2**31 - 1)`.
  - OTP counter: an atomic `UPDATE … SET attempts = attempts + 1 WHERE id = :id AND attempts < :max AND used_at IS NULL AND verified_at IS NULL AND expires_at > :now`, committed before the hash compare; `rowcount == 0` means the code is dead.
  - Phone: if the digits have no `+` and start with the default dial code at full length (12 digits for `91`), don't prepend it again.
- [ ] **Step 4: Run** `...\python.exe -m pytest -q`. Expected: all pass.

## Task 5: Backend demo seed + run docs

**Files:**
- Create: `scripts/seed_demo.py`, `tests/test_seed_demo.py`
- Modify: `README.md` (backend section: run for a phone, the seed, the new endpoints, the error envelope)

**Interfaces:**
- Consumes: Tasks 1–3 models and services.
- Produces: `python scripts/seed_demo.py [--reset]`. It creates the users, spaces, expenses, shares, settlements and notifications of `prototype/js/data.js` `seed()`, mapped by username (prototype `u_kabir` → `kabir.r`, and so on). Every user's password is `demo1234`. Without `--reset`, it refuses to run if `kabir.r` already exists (exit code 1, message). With `--reset`, it deletes only the rows belonging to the seeded usernames and then re-creates them. Seeded expense dates are offsets from "today", as in the prototype.

- [ ] **Step 1: Write failing tests** `tests/test_seed_demo.py`:
  - `test_seed_matches_prototype_balances`: run the seed's `seed(db)` function on the test DB. As `kabir.r`, every `GET /spaces` card and the `overall` list equal the "Seed expected values" table at the top of this plan. Hard-code that table in the test, with a comment that it comes from the prototype's `data.js`.
  - `test_seed_refuses_twice_without_reset`.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement** `seed(db: Session) -> None` plus a CLI wrapper that uses `app.database.SessionLocal`.
- [ ] **Step 4: README.** Add a "Use it from the phone app" section with these steps:
  - `alembic upgrade head`.
  - `python scripts/seed_demo.py`.
  - `uvicorn app.main:app --host 0.0.0.0 --port 8000`.
  - Find the laptop's Wi-Fi IP with `ipconfig`.
  - In the app, long-press the UOMi wordmark on Welcome, choose Server and enter `http://<ip>:8000`.
  - If the phone can't connect: USB plus `adb reverse tcp:8000 tcp:8000` and `http://127.0.0.1:8000`.
  - Sign in as `kabir.r` / `demo1234`.

  Also document the reshaped endpoints and the error envelope (replace the outdated rows).
- [ ] **Step 5: Run** `...\python.exe -m pytest -q`. Expected: all pass. Then run the real CLI against a scratch DB (`DATABASE_URL=sqlite:///<scratchpad>/seed.db`, `alembic upgrade head`, `seed_demo.py`) and expect exit 0.

---

## Task 6: Expo app scaffold, fonts and theme

**Files:**
- Create: `mobile/` (from `npx create-expo-app@latest mobile --template default`, then remove the template's demo screens and components), `mobile/app.json`, `mobile/assets/fonts/Fraunces-Text-Regular.ttf`, `-Text-SemiBold.ttf`, `-Text-Bold.ttf`, `-Display-SemiBold.ttf`, `-Display-Bold.ttf`, `mobile/assets/fonts/OFL.txt`, `mobile/src/theme/tokens.ts`, `mobile/src/theme/type.ts`, `mobile/src/theme/ThemeProvider.tsx`, `mobile/jest.config.js`, `mobile/src/theme/__tests__/tokens.test.ts`
- Modify: root `.gitignore` (add `dist/`), `.claude/launch.json` (add the `uomi-mobile-web` configuration: `npx expo start --web --port 8081`, cwd `mobile`, port 8081)

**Interfaces — Produces:**
- `tokens.light` / `tokens.dark`: `Record<ColorToken, string>`, where `ColorToken` is the camelCase name of every custom property in `prototype/css/tokens.css` whose value is a colour (`#…`, `rgb(…)`, `rgba(…)`). That gives `badge, carbon, carbonPress, carbonWash, controlEdge, dupPink, dupPinkEdge, dupYellow, dupYellowEdge, focus, ground, hair, hairStrong, ink, ink2, m1…m6, onBadge, onCarbon, owe, owed, pending, perf, scrim, selection, sheet, sheet2, skeleton, stage, stageInk2, stampAgreed, stampRed, tabbar`. Values are copied exactly from tokens.css for both themes. Non-colour tokens (spacing `--s*`, `--fs-*`/`--lh-*`, easings, durations, `--lift-*` shadows) go in `space`, `type` and a `motion` export instead.
- `space` (4, 8, 12, 16, 20, 24, 32, 40), `radius` (sheet 6, segment 9, plateLg 12, bottomSheet 14, pill 999).
- `type`: `Record<'display'|'heroFigure'|'figure'|'title'|'wordmark'|'body'|'label'|'serial'|'stamp', TextStyle>` with the `DESIGN.md` sizes, line heights and letter-spacing in px, and `fontFamily` set to the static instance from `specs.md` § 3.8.
- `useTheme(): { colors, type, space, radius, scheme: 'light'|'dark', setPreference(p: 'system'|'light'|'dark') }`. It follows the system scheme until a preference is set.
- App identity in `app.json`:
  - `name "UOMi"`, `slug "uomi"`, `version "0.1.0"`, `scheme "uomi"`, `orientation "portrait"`, `userInterfaceStyle "automatic"`.
  - `android.package "com.uomi.app"`, `android.softwareKeyboardLayoutMode "resize"`.
  - Plugins: `expo-router`, `expo-font`, `expo-secure-store`, and `["expo-build-properties", {"android": {"usesCleartextTraffic": true}}]`.

- [ ] **Step 1: Scaffold.** Run `create-expo-app` and install the Tech Stack libraries with `npx expo install` (so versions match the SDK). Delete the template's example routes and components.
- [ ] **Step 2: Generate fonts** (any shell): `C:\Users\prem.b\AppData\Local\uomi-venv\Scripts\python.exe -m pip install fonttools` once, then for each instance `...\python.exe -m fontTools.varLib.instancer assets/fonts/fraunces/Fraunces-Variable.ttf wght=<400|600|700> opsz=<14|72> WONK=0 SOFT=0 -o mobile/assets/fonts/<name>.ttf`. Copy `OFL.txt` alongside.
- [ ] **Step 3: Write failing test** `tokens.test.ts`:
  - `light and dark define the same keys`.
  - `carbon is #23308A light and #A9BCFF dark`.
  - `every colour token in tokens.css is present`: read `path.resolve(__dirname, '../../../../prototype/css/tokens.css')` with fs. For each `--name: value` whose value is a colour (`#`, `rgb(`, `rgba(`), assert that the camelCase key exists in both themes, with the same value in the theme it was declared for.
- [ ] **Step 4: Implement** `tokens.ts`, `type.ts` and `ThemeProvider.tsx`. The root `app/_layout.tsx` loads the five fonts with `useFonts` (splash screen held until they load) and wraps the app in `ThemeProvider`, `QueryClientProvider` and `SafeAreaProvider`.
- [ ] **Step 5: Verify.**
  - `npx jest`: PASS.
  - `npx tsc --noEmit`: no errors.
  - `npx expo export --platform android`: succeeds (proves the JS bundles).
  - `npx expo export --platform web`: succeeds.

## Task 7: Domain core — types, money, phone, dates, splits, balances

**Files:**
- Create: `mobile/src/domain/types.ts`, `money.ts`, `phone.ts`, `dates.ts`, `split.ts`, `balances.ts`, `phrases.ts`, and `mobile/src/domain/__tests__/{money,phone,split,balances,phrases}.test.ts`

**Interfaces — Produces** (every later task uses these names):

```ts
// types.ts — Zod schemas with inferred types, specs.md § 14.3 + prototype fields
export const CURRENCIES = ['INR','USD','EUR','GBP','AED','SGD','AUD','CAD'] as const; export type Currency = typeof CURRENCIES[number];
export const SPACE_ICONS = ['home','trip','food','office','friends','car','party','other'] as const; export type SpaceIcon = typeof SPACE_ICONS[number];
export type User = { id: string; username: string; name: string; phone: string | null; phoneVerified: boolean; avatarUrl: string | null; plate: 1|2|3|4|5|6 };
export type Space = { id: string; name: string; icon: SpaceIcon; currency: Currency; ownerId: string; memberIds: string[]; serial: number; createdAt: number };
export type SplitType = 'equal'|'exact'|'percent'|'shares'; export type ShareResponse = 'pending'|'accepted'|'rejected';
export type Share = { userId: string; input: number | null; amountMinor: number; response: ShareResponse };
export type Expense = { id: string; spaceId: string; description: string; amountMinor: number; paidBy: string; splitType: SplitType; shares: Share[]; date: number; createdBy: string; updatedAt: number };
export type SettlementStatus = 'pending'|'confirmed'|'rejected'|'cancelled';
export type Settlement = { id: string; spaceId: string; fromUserId: string; toUserId: string; amountMinor: number; date: number; status: SettlementStatus; answeredAt: number | null };
export type NotificationType = 'expense_share'|'share_rejected'|'payment_to_confirm'|'payment_answered'|'space_added'|'space_deleted'|'reminder';
export type AppNotification = { id: string; userId: string; type: NotificationType; message: string; spaceId: string | null; spaceName: string | null; refId: string | null; needsAnswer: boolean; read: boolean; createdAt: number };
export type Preferences = { defaultCurrency: Currency; theme: 'system'|'light'|'dark'; notificationsOn: boolean };
// view models shared by both service implementations
export type Pair = { userId: string; name: string; netMinor: number };            // + = they owe the viewer
export type SpaceBalance = { spaceId: string; currency: Currency; netMinor: number; pairs: Pair[]; openBalances: number; counterpartyName: string | null; counterpartyCount: number; settled: boolean };
export type OverallLine = { currency: Currency; netMinor: number; oweMinor: number; owedMinor: number };
export type ActivityRow =
  | { kind: 'expense'; id: string; description: string; date: number; amountMinor: number; paidById: string; paidByName: string; myPartMinor: number | null; myResponse: ShareResponse | null; disputed: boolean }
  | { kind: 'payment'; id: string; date: number; fromId: string; fromName: string; toId: string; toName: string; amountMinor: number; status: SettlementStatus };
```

- `money.ts`:
  - `CURRENCY_INFO: Record<Currency, {symbol, locale, name}>`, from the prototype's table plus AUD (`A$`, `en-AU`) and CAD (`C$`, `en-CA`).
  - `formatMoney(minor: number, currency: Currency, opts?: {compact?: boolean; signed?: boolean}): string` (`Intl.NumberFormat` with the currency's locale; compact drops `.00`).
  - `parseAmountInput(text: string): number | null` (≤ 2 decimals, > 0, ≤ 999999999 minor).
  - `parseMoneyString(s: string): number` (server decimal strings, no floats).
- `phone.ts`: `toE164(national: string, country: CountryCode): string | null` (libphonenumber-js, validated for the country), `maskPhone(e164): string` → `+91 80******31`, `prettyPhone(e164): string`, and `COUNTRIES` (the prototype list).
- `dates.ts`: `relDate(ms)`, `fullDate(ms)`, `monthKey(ms)`, ported from the prototype.
- `split.ts`: `computeSplit(totalMinor: number, type: SplitType, rows: {userId: string; input: number | null}[]): {valid: boolean; amounts: {userId: string; amountMinor: number}[]; helper: string}`, ported from prototype `computeSplit` + `distribute` with the § 1 rounding rule.
- `balances.ts`:
  - `pairwise(expenses: Expense[], settlements: Settlement[]): Map<string, number>`.
  - `spaceBalance(space: Space, expenses: Expense[], settlements: Settlement[], viewerId: string, nameOf: (id: string) => string): SpaceBalance`.
  - `overall(balances: SpaceBalance[]): OverallLine[]`.
  - `settleMax(space, expenses, settlements, fromId, toId): number` (amount owed minus pending settlements, § 9).
  - Rules are exactly the contract's "Pairwise semantics".
- `phrases.ts`: `balanceText(b: SpaceBalance, compact?: boolean): {tone: 'owe'|'owed'|'muted'; text: string; sub: string}` (port of prototype `balPhrase`), and `overallLines(lines: OverallLine[]): {tone; text}[]` (net per currency: "Overall, you owe ₹20" / "Overall, you’re owed ₹250"; an empty list gives one line "You’re all settled up").

- [ ] **Step 1: Write failing tests** with these exact assertions:
  - `formatMoney(12345650,'INR') === '₹1,23,456.50'`, `formatMoney(12345650,'USD') === '$123,456.50'`, `formatMoney(2000,'INR',{compact:true}) === '₹20'`, `parseMoneyString('-100.10') === -10010`, `parseAmountInput('12.345') === null`.
  - `maskPhone('+918012345631') === '+91 80******31'`; `toE164('98765 43210','IN') === '+919876543210'`; `toE164('12345','IN') === null`.
  - `computeSplit(10000,'equal',[a,b,c])` amounts are `[3334,3333,3333]` and sum to 10000. `percent` with 33.33/33.33/33.34 on 10000 sums to 10000. `shares` 2:1:1 on 30000 → `[15000,7500,7500]`. `exact` 4000+5000 on 10000 → `valid === false` and `helper === '₹10.00 left to assign'`. Over by 10.00 → `'₹10.00 over'`.
  - Balances: the same five cases as backend Task 2 (pending counts, disputed excluded, confirmed vs pending settlement, counterparty on the side of the net → `'Swetha'`, zero net with 2 open), plus `overall` for INR + USD never summed.
  - Phrases: `balanceText` for `−2000` with one counterparty named "Swetha Iyer" → `{tone:'owe', text:'You owe ₹20', sub:'Swetha'}` (first word only); settled → `'Settled up'`; zero net with 2 open → `{text:'₹0 net', sub:'2 open balances'}`. `overallLines([])` → `[{text:'You’re all settled up'}]`.
- [ ] **Step 2: Run** `npx jest src/domain`. Expected: FAIL.
- [ ] **Step 3: Implement** by porting from `prototype/js/data.js` (`money`, `distribute`, `computeSplit`, `pairwise`, `spaceBalance`, `overall`, `pendingTo`, `maskPhone`, `relDate`) and `app.js` `balPhrase`.
- [ ] **Step 4: Run** `npx jest src/domain && npx tsc --noEmit`. Expected: PASS.

## Task 8: Service interfaces + demo implementation

**Files:**
- Create: `mobile/src/services/types.ts`, `mobile/src/services/errors.ts`, `mobile/src/services/demo/seed.ts`, `mobile/src/services/demo/db.ts`, `mobile/src/services/demo/index.ts`, `mobile/src/services/__tests__/demo.test.ts`

**Interfaces:**
- Consumes: Task 7 types and functions.
- Produces:

```ts
// errors.ts
export type AppErrorCode = 'network'|'not_on_server'|'invalid_credentials'|'too_many_attempts'|'username_taken'|'phone_taken'|'invalid_code'|'code_expired'|'otp_locked'|'unknown_username'|'session_expired'|'not_found'|'forbidden'|'validation_error'|'simulated'|'unknown';
export class AppError extends Error { constructor(public code: AppErrorCode, message: string, public extra?: Record<string, unknown>) }
export const notOnServer = () => new AppError('not_on_server', 'Not available on this server yet');
// types.ts
export interface Services {
  mode: 'demo'|'server';
  auth: {
    signUp(i: {username: string; name: string; phone: string; password: string}): Promise<{pendingId: string; maskedPhone: string}>;
    verifySignUpOtp(pendingId: string, code: string): Promise<User>;
    resendOtp(ref: string): Promise<{resendAfterSeconds: number}>;
    signIn(username: string, password: string): Promise<User>;
    signOut(): Promise<void>;
    restore(): Promise<User | null>;                       // on launch
    checkUsername(u: string): Promise<boolean>; checkPhone(e164: string): Promise<boolean>;
    requestResetOtp(username: string): Promise<{resetId: string; maskedPhone: string}>;
    verifyResetOtp(resetId: string, code: string): Promise<{resetToken: string}>;
    resetPassword(resetToken: string, newPassword: string): Promise<{username: string}>;
  };
  users: { search(q: string): Promise<User[]> };            // never returns the viewer
  spaces: {
    list(): Promise<{space: Space; balance: SpaceBalance; lastActivity: number}[]>;  // sorted, newest activity first
    overall(): Promise<OverallLine[]>;
    get(id: string): Promise<{space: Space; members: User[]; balance: SpaceBalance; activity: ActivityRow[]}>;
    create(i: {name: string; icon: SpaceIcon; currency: Currency; memberIds: string[]}): Promise<Space>;
    update(id: string, p: Partial<Pick<Space,'name'|'icon'|'currency'>>): Promise<Space>;
    addMembers(id: string, userIds: string[]): Promise<void>; removeMember(id: string, userId: string): Promise<void>;
    leave(id: string): Promise<void>; remove(id: string): Promise<void>;
  };
  expenses: {
    get(id: string): Promise<{expense: Expense; space: Space; members: User[]}>;
    create(i: Omit<Expense,'id'|'createdBy'|'updatedAt'>): Promise<Expense>; update(id: string, i: Omit<Expense,'id'|'createdBy'|'updatedAt'>): Promise<Expense>;
    remove(id: string): Promise<void>; acceptShare(id: string): Promise<void>; rejectShare(id: string): Promise<void>;
  };
  settlements: {
    get(id: string): Promise<{settlement: Settlement; space: Space; from: User; to: User}>;
    payees(spaceId: string): Promise<{user: User; maxMinor: number}[]>;
    create(i: {spaceId: string; toUserId: string; amountMinor: number}): Promise<Settlement>;
    confirm(id: string): Promise<void>; reject(id: string): Promise<void>; cancel(id: string): Promise<void>;
  };
  notifications: { list(): Promise<AppNotification[]>; markRead(id: string): Promise<void>; markAllRead(): Promise<void>; unreadCount(): Promise<number> };
  transactions: { list(f: {kind: 'all'|'expenses'|'payments'; spaceId?: string}): Promise<(ActivityRow & {spaceId: string; spaceName: string; currency: Currency})[]> };
  profile: { get(): Promise<User>; update(p: {name?: string; avatarUrl?: string | null}): Promise<User>; getPreferences(): Promise<Preferences>; setPreferences(p: Preferences): Promise<void> };
  debug: null | { users(): Promise<User[]>; actAs(userId: string): Promise<User>; resetDemoData(): Promise<void>; setSimulateErrors(on: boolean): Promise<void>; setOffline(on: boolean): Promise<void>; state(): Promise<{simulateErrors: boolean; offline: boolean}> };
}
export function createDemoServices(storage?: Storage): Services;   // demo/index.ts; Storage = AsyncStorage-compatible
```

- Demo behaviour, ported from prototype `data.js` `A`:
  - Every call waits 300–800 ms (0 ms when `process.env.NODE_ENV === 'test'`).
  - It throws `AppError('simulated')` when simulateErrors is on, and every write throws `AppError('network')` when offline is on.
  - The db is saved to AsyncStorage key `uomi.demo.v1` after every write.
  - Notifications follow `specs.md` § 11.2. An accepted share sends nothing, a rejected share notifies the creator, and an edit resets every share to `pending` and re-notifies.
  - OTP is `123456`; 5 wrong tries → `otp_locked`; 5-minute expiry → `code_expired`.
  - Permission rules follow `specs.md` § 10.1, throwing `forbidden` with the spec's reason text.

- [ ] **Step 1: Write failing tests** `demo.test.ts` (in-memory storage):
  - `seed balances match the plan table`: as `kabir.r`, `spaces.list()` and `spaces.overall()` equal the "Seed expected values" table at the top of this plan (same numbers the backend seed test uses).
  - `money loop`, run as kabir.r:
    1. kabir.r creates a space with swetha.i, then an equal 30000 expense.
    2. swetha.i gets an `expense_share` with `needsAnswer`.
    3. `actAs(swetha)`, `acceptShare` → kabir.r gets no notification.
    4. swetha.i records a payment with `payees()[0].maxMinor === 15000`, then `create` → kabir.r gets `payment_to_confirm`.
    5. `actAs(kabir)`, `confirm` → the space balance is 0, and swetha.i gets `payment_answered`.
  - `reject makes disputed and notifies creator`.
  - `persistence`: write, create a new `createDemoServices(sameStorage)`, then `restore()` returns the same user and the data survives (Review Focus 2).
  - `otp rules`: a wrong code → `invalid_code`; after 5 wrong → `otp_locked`; `123456` → success.
  - `only creator can delete expense`: as non-creator → `forbidden`.
  - `owner cannot leave`.
- [ ] **Step 2: Run** `npx jest src/services`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `npx jest && npx tsc --noEmit`. Expected: PASS.

## Task 9: Server implementation (HTTP client)

**Files:**
- Create: `mobile/src/services/server/http.ts`, `tokens.ts`, `mappers.ts`, `index.ts`, `mobile/src/services/__tests__/server.test.ts`

**Interfaces:**
- Consumes: the backend contract (top of this plan), Task 8 `Services` and `AppError`.
- Produces: `createServerServices(opts: {baseUrl: string; tokenStore?: TokenStore; fetchImpl?: typeof fetch; now?: () => number; onSignedOut: (reason: string) => void; onActivity?: () => void}): Services`, where `TokenStore = {get(): Promise<{access: string; refresh: string; lastRequestAt: number; idleSeconds: number} | null>; set(t): Promise<void>; clear(): Promise<void>}` (the default uses expo-secure-store; the tests pass a memory store).
- Behaviour:
  - Bearer header on every request.
  - `401 token_expired` → one shared in-flight `POST /auth/refresh` promise (single-flight), store the new pair, retry the original request once.
  - `session_expired | invalid_token | invalid_refresh_token | not_authenticated` → `tokenStore.clear()`, `onSignedOut(message)`, throw `AppError('session_expired')`.
  - A fetch rejection or timeout (10 s, AbortController) → `AppError('network')`; the tokens are kept.
  - Error envelope `detail.code` maps to the `AppErrorCode` of the same name, otherwise `unknown`.
  - `lastRequestAt` is updated after every successful authenticated request, and `onActivity` is called.
  - `restore()`: if tokens exist and `now − lastRequestAt > (idleSeconds − 30) * 1000`, then clear and return `null`; otherwise `GET /users/me`.
- Mapping:
  - Usernames become `User.id`. Space ids become strings. `plate = ((position − 1) % 6) + 1`. Server `date` / ISO strings become ms.
  - `ExpenseRow`: `myPartMinor = paid_by == me ? amount_minor − (my_share_minor ?? 0) : my_share_minor === null ? null : −my_share_minor`.
- Operations with no endpoint throw `notOnServer()`: `auth.signUp, verifySignUpOtp, resendOtp, checkUsername, checkPhone, requestResetOtp, verifyResetOtp, resetPassword`, `spaces.update, addMembers, removeMember, leave, remove`, everything in `expenses`, `settlements` and `transactions`, and `profile.update` / `setPreferences`. `getPreferences` returns `{defaultCurrency: me.currency, theme: 'system', notificationsOn: true}`. `debug` is `null`.

- [ ] **Step 1: Write failing tests** `server.test.ts` with a fake `fetchImpl`:
  - `signIn stores tokens and loads /users/me`.
  - `single-flight refresh`: two parallel requests both get `token_expired`; exactly one `/auth/refresh` call is made, both requests are retried once and both resolve.
  - `session_expired signs out`: `onSignedOut` is called once, the store is cleared, and the call rejects with `session_expired`.
  - `network failure keeps session` (Review Focus 1): fetch rejects → `AppError('network')`, and the store still holds tokens.
  - `restore after idle returns null` (Review Focus 2): `lastRequestAt = now − 571 s` with `idleSeconds 600` → `null` and the store is cleared. At 500 s → it calls `/users/me`.
  - `maps space detail`: a contract-shaped fixture → `space.currency`, `balance.counterpartyName`, an `activity` mixing expenses and payments sorted newest first, and `myPartMinor` per the rule above.
  - `notOnServer`: `expenses.create` rejects with code `not_on_server`.
- [ ] **Step 2: Run** `npx jest src/services/__tests__/server.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `npx jest && npx tsc --noEmit`. Expected: PASS.

## Task 10: App shell, session, navigation, UI kit, server settings

**Files:**
- Create:
  - `mobile/src/state/session.ts`
  - `mobile/src/services/useServices.ts` (and a query-keys module, `mobile/src/services/queries.ts`)
  - `mobile/src/ui/*.tsx`, one component per file: `Icon`, `AppBar`, `TabBar`, `Button`, `IconButton`, `Field`, `TextField`, `PasswordField`, `OtpInput`, `Fab`, `Sheet`, `Rows`/`LedgerRow`, `MemberPlate`, `SpaceIcon`, `Stamp`, `CarbonCopy`, `Toast`/`useToast`, `ConfirmDialog`/`useConfirm`, `BottomSheet`, `Skeleton`, `StateBox` (empty / error with Retry), `NotOnServer`, `OfflineBanner`, `Segmented`, `Chip`, `Switch`, `Screen` (safe area + scroll padding)
  - `mobile/src/ui/useDiscardGuard.ts`, `mobile/src/ui/ServerSettingsSheet.tsx`
  - Routes: `mobile/app/_layout.tsx` (update), `mobile/app/(auth)/_layout.tsx`, `mobile/app/(tabs)/_layout.tsx`, and placeholder screens for every route (listed below)
  - Tests: `mobile/src/__tests__/shell.test.tsx`
- Route list (later tasks fill them): `(auth)/welcome, signup, verify, signin, forgot, forgot-otp, reset`; `(tabs)/index` (Home), `(tabs)/notifications`, `(tabs)/transactions`, `(tabs)/profile`; `space/add-people`, `space/[id]/index`, `space/[id]/members`, `space/[id]/settle`, `space/[id]/expense-new`; `expense/[id]/index`, `expense/[id]/edit`; `payment/[id]`; `profile-edit`.

**Interfaces — Produces:**
- `useSession` (Zustand, persisted to AsyncStorage key `uomi.session.v1`) holds `{mode: 'demo'|'server'; serverUrl: string; user: User | null}`. Its actions are `setMode(mode, url?)`, `signedIn(user)` and `signedOut(reason?)`. `setMode` calls `signOut` on the current services, clears the QueryClient and sets `user = null` (Review Focus 3).
- `useServices(): Services` returns a memoised `createDemoServices()` or `createServerServices({baseUrl, onSignedOut, onActivity})` for the current mode.
- `useDiscardGuard(dirty: boolean)` intercepts the router's back navigation and the Android hardware back button, and confirms "Discard changes?" with "Discard" / "Keep editing" (Review Focus 4).
- `Icon` takes `name` from the prototype's `P` map in `app.js`. It draws `react-native-svg` paths at 24 px with a 1.75 stroke.
- `StateBox` props: `{kind: 'empty'|'error'; title; body?; onRetry?; action?}`. The error copy defaults to the prototype's "Couldn’t load this".
- `NotOnServer` renders the shared panel, "Not available on this server yet" plus one line on why.
- `TabBar` and `OtpInput` text sets `maxFontSizeMultiplier={1.5}` (Review Focus 5).
- Navigation gate: with `user === null`, only the `(auth)` routes are reachable; with a user, `(auth)` redirects to `(tabs)`. On launch the app calls `services.auth.restore()` (`specs.md` § 4.1).
- In server mode, an idle timer from the session (`idleSeconds − 30`) runs `signedOut('You were signed out after 10 minutes of inactivity.')`. It resets on every successful request (`onActivity`), and an AppState listener re-checks it on resume.
- `ServerSettingsSheet` has the Mode segmented control (Demo / Server), a URL `TextField` (validated `^https?://`), and **Test connection** (`GET {url}/health` → "Connected" / "Couldn’t reach the server"). **Save** calls `setMode`.

- [ ] **Step 1: Write failing tests** `shell.test.tsx` (RNTL):
  - `signed out shows Welcome`.
  - `switching mode signs out and clears cache`: seed the QueryClient with a demo key, call `setMode('server','http://x')`, and expect the cache to be empty and `user` to be null.
  - `discard guard confirms when dirty`: render a dirty form with `useDiscardGuard(true)`, fire a hardware back event, and expect "Discard changes?" to be visible. With `false`, there is no dialog.
  - `TabBar labels cap font scale`: each label has `maxFontSizeMultiplier === 1.5`.
  - `error StateBox calls onRetry`.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.**
  - Match `DESIGN.md` § Components (the button, chip, input, tab-bar, badge and FAB sizes in its front matter) and `prototype/css/app.css` for each component.
  - `CarbonCopy` draws the pink and yellow offset sheets (5px/7px at 0.7deg, 10px/14px at 1.5deg). `Stamp` is the 80 px double-ring stamp.
  - Use React Native `Animated` for press compression (0.98, or 0.92 for answer controls, over 120 ms), the stamp press (220 ms from 1.35×, −18deg → −12deg, ease-out, no overshoot) and the copy peel. All of it crossfades when `AccessibilityInfo.isReduceMotionEnabled()`.
- [ ] **Step 4: Run** `npx jest && npx tsc --noEmit`. Expected: PASS. Then start `uomi-mobile-web` and confirm Welcome renders at 390×844 in light and dark (screenshot in the task report).

## Task 11: Auth screens

**Files:** fill `mobile/app/(auth)/{welcome,signup,verify,signin,forgot,forgot-otp,reset}.tsx`. Test: `mobile/src/__tests__/auth.test.tsx`.

**Interfaces:**
- Consumes: Task 8/9 `Services.auth`, Task 10 UI kit and `useSession`.
- Source: `specs.md` §§ 3.3, 3.4, 4.1–4.5, and prototype `R.welcome`, `R.signup`, `R.verify`, `R.signin`, `R.forgot`, `R.reset`, `countrySheet`.
- Rules:
  - Validation runs on blur and again on submit (React Hook Form + Zod). Fields are a username of 3–20 characters from `[a-z0-9_.]`, a name of 1–50, a phone validated for the chosen country with `toE164`, and a password of at least 8 characters with a letter and a number, plus a confirm field that must match.
  - The username's ✓/✗ hint (`checkUsername`) runs 400 ms after typing stops.
  - The OTP resend countdown is 30 s in demo mode.
  - Long-pressing the Welcome wordmark opens `ServerSettingsSheet`.
  - In server mode, "Create Account" and "Forgot password?" stay visible but open the `NotOnServer` panel.
  - Sign In shows "Username or password is incorrect" for `invalid_credentials`. For `too_many_attempts` it shows "Too many attempts — try again in N minutes", with N taken from `extra.retry_after_seconds`.

- [ ] **Step 1: Write failing tests:**
  - `sign up → verify with 123456 → lands on Home` (demo).
  - `wrong OTP clears boxes and shows "That code is incorrect"`.
  - `forgot: unknown username shows "We couldn’t find that username"`.
  - `reset → Sign In with username prefilled`.
  - `server mode: Create Account shows "Not available on this server yet"`.
  - `invalid credentials message`.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `npx jest && npx tsc --noEmit`. Expected: PASS.

## Task 12: Home, Create Space, Space Page

**Files:** fill `mobile/app/(tabs)/index.tsx`, `mobile/app/space/add-people.tsx`, `mobile/app/space/[id]/index.tsx`, and create `mobile/src/features/space/SpaceNamePopup.tsx`. Test: `mobile/src/__tests__/spaces.test.tsx`.

**Interfaces:**
- Consumes: `Services.spaces`, `users.search`, `notifications`, `expenses.acceptShare` / `rejectShare`, `settlements.confirm` / `reject`; and `balanceText`, `overallLines`, `formatMoney`, `relDate`, `monthKey`.
- Source: `specs.md` §§ 5, 6, 7, 11.2 (the ✕/✓ actions on the Home card), and prototype `R.home`, `pendingCard`, `spaceRow`, `createSpacePopup`, `R.addPeople`, `R.space`, `activityRows`, `expenseRow`, `paymentRow`.
- Rules:
  - The Home card shows the latest `needsAnswer` notification, wrapped in a `CarbonCopy` with ✕/✓.
  - After an answer the badge drops by one. In server mode, answering throws `not_on_server`, which shows as a toast.
  - The Overall banner uses `overallLines`.
  - Space cards use `balanceText`.
  - The Space Name pop-up has a name of 1–30 characters, 8 icons with the first pre-selected, and a currency defaulting to `profile.getPreferences().defaultCurrency`. Back from Add People returns to the pop-up with the draft kept (hold the draft in a Zustand store).
  - Add People search starts 300 ms after typing stops. Row 1 is "You" and can't be removed. ✓ is enabled once there is at least one other person, then shows the toast "Space created".
  - The Space Page shows the first 3 pairwise lines plus "See all", and Settle up only when the user owes someone. Activity is grouped by month with Disputed, Needs your answer and Pending tags. The + FAB opens `space/[id]/expense-new`.
  - Every screen has loading (Skeleton), empty, and error with Retry.

- [ ] **Step 1: Write failing tests (demo):**
  - `home shows overall net per currency`.
  - `accept on home card removes it and decrements badge`.
  - `create space: confirm disabled until one person added; creates and opens Space Page with toast`.
  - `space page shows "You owe Swetha ₹…" breakdown and Settle up only when owing`.
  - `empty space shows "No expenses yet — tap + to add the first one."`.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `npx jest && npx tsc --noEmit`. Expected: PASS.

## Task 13: Expenses, Settle Up, Settlement Detail, Members & Space Settings

**Files:** fill `mobile/app/space/[id]/expense-new.tsx`, `mobile/app/expense/[id]/index.tsx`, `mobile/app/expense/[id]/edit.tsx`, `mobile/app/space/[id]/settle.tsx`, `mobile/app/payment/[id].tsx`, `mobile/app/space/[id]/members.tsx`, and create `mobile/src/features/expense/ExpenseForm.tsx`. Test: `mobile/src/__tests__/money-screens.test.tsx`.

**Interfaces:**
- Consumes: `Services.expenses`, `settlements`, `spaces` (`update`, `addMembers`, `removeMember`, `leave`, `remove`), `computeSplit`, `settleMax` via `settlements.payees`.
- Source: `specs.md` §§ 8, 9, 10, and prototype `expenseForm`, `R.exp`, `R.settle`, `R.pay`, `R.members`.
- Rules:
  - The amount field is the borderless 40 px carbon hero figure.
  - The split type is a `Segmented` control. The helper line and per-row amounts update live from `computeSplit`. Switching type keeps the ticked people and clears their values.
  - Dates can't be in the future.
  - Edit and Delete appear only for the creator.
  - "Delete ‘Dinner’? Balances will be recalculated." uses `useConfirm`.
  - Settle Up pre-selects the person when there is only one, and pre-fills `maxMinor`, which can be lowered but not raised.
  - Cancelling a payment is allowed only for the person who recorded it, and only while it is pending.
  - Members & Settings follow the permission table in § 10.1, with disabled reasons "Settle up first" and "Can't change after expenses are added".
  - In server mode each screen renders `NotOnServer` (the Members list itself still shows from `spaces.get`).
  - Forms use `useDiscardGuard`.

- [ ] **Step 1: Write failing tests (demo):**
  - `add expense equal split saves and returns with toast "Expense added"`.
  - `exact split shows "₹40.00 left to assign" and Save disabled`.
  - `non-creator sees no Edit/Delete on Expense Detail`.
  - `settle up prefilled with max and cannot exceed it`.
  - `receiver confirms payment from Settlement Detail`.
  - `owner remove member disabled with "Settle up first" when unsettled`.
  - `server mode Add expense shows Not available on this server yet`.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `npx jest && npx tsc --noEmit`. Expected: PASS.

## Task 14: Notifications, Transactions, Profile, Edit Profile, debug menu

**Files:** fill `mobile/app/(tabs)/notifications.tsx`, `(tabs)/transactions.tsx`, `(tabs)/profile.tsx`, `mobile/app/profile-edit.tsx`, and create `mobile/src/features/debug/DebugSheet.tsx`. Test: `mobile/src/__tests__/tabs.test.tsx`.

**Interfaces:**
- Consumes: `Services.notifications`, `transactions`, `profile`, `debug`, `ServerSettingsSheet`, `useTheme().setPreference`.
- Source: `specs.md` §§ 11, 12, 13, 14.1, and prototype `R.notifs`, `openNotif`, `R.trans`, `R.profile`, `R.editProfile`, `debugSheet`, `resetDemo`.
- Rules:
  - Notifications are split into "Needs your answer" and "Earlier", with the Earlier list grouped Today / Yesterday / date. Tapping an item marks it read and opens its target; a Reminder opens Settle Up instead.
  - "Mark all as read" calls `markAllRead`.
  - Transactions has chips (All · Expenses · Payments) and a Space dropdown. The filtered-empty state shows "Nothing matches these filters" with a "Clear filters" button.
  - Profile shows the member plate or photo (`expo-image-picker` on Edit Profile), plus default currency, the notifications toggle, the theme toggle and Logout with confirm "Log out of UOMi?".
  - Long-pressing the Profile wordmark opens `DebugSheet`. It has Act as… (the demo user list), Simulate errors, Offline, Reset demo data, and Server settings. In server mode only Server settings is shown.

- [ ] **Step 1: Write failing tests (demo):**
  - `mark all as read clears badge`.
  - `tapping reminder opens Settle Up`.
  - `transactions filtered empty shows Clear filters`.
  - `logout confirm returns to Welcome`.
  - `act as switches user and Home reflects them`.
  - `theme toggle switches scheme`.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `npx jest && npx tsc --noEmit`. Expected: PASS.

## Task 15: End-to-end verification (controller, browser pane)

Not a subagent task: the controller does it with the browser tools.

- [ ] Backend:
  - `pytest -q` passes.
  - Fresh scratch DB: `alembic upgrade head`, then `alembic check`, then `seed_demo.py`.
  - `uvicorn` on `127.0.0.1:8000` with `CORS_ORIGINS=http://localhost:8081`.
- [ ] `npx jest` and `npx tsc --noEmit` are clean, then start `uomi-mobile-web`.
- [ ] Demo mode at 390×844, light then dark: walk every route in Task 10's list, including the money loop with Act as…. Check the console for errors.
- [ ] At 320×640, with RN-web font scaling checked: no clipped amounts, OTP cells or tab labels (Review Focus 5).
- [ ] Server mode against the local backend: sign in as `kabir.r` / `demo1234`. Home balances must equal demo mode's for the same seed. Check Create Space with USD, search, the Notifications mark-all, and that Create Account / Add expense show NotOnServer. Stop uvicorn mid-session and expect the Error + Retry state with the user still signed in (Review Focus 1).
- [ ] Record the issues found, fix them (in the owning task's files) and re-check.

## Task 16: Release APK

**Files:** `mobile/android/` (generated, git-ignored), `dist/UOMi-0.1.0.apk`.

- [ ] **Step 1: Prebuild.** Run `npx expo prebuild --platform android --clean` from `mobile/`. In `mobile/android/gradle.properties`, set `reactNativeArchitectures=armeabi-v7a,arm64-v8a` (real phones only; this makes the APK smaller and the build faster).
- [ ] **Step 2: Build.** Set `JAVA_HOME=%LOCALAPPDATA%\uomi-toolchain\jdk17` and `ANDROID_HOME=%LOCALAPPDATA%\uomi-toolchain\android-sdk`, then run `android\gradlew.bat assembleRelease` in the background (the first run downloads Gradle, the NDK and the SDK platforms).
  - If CMake or Ninja fails with a path longer than 260 characters, `subst U: C:\Users\prem.b\work\UOMi\mobile` and build from `U:\android`.
  - Release builds are signed with the template's debug keystore.
- [ ] **Step 3: Verify the APK.** Use `apkanalyzer` (in `cmdline-tools\latest\bin`):
  - `files list` contains `assets/index.android.bundle` (the JS is bundled, so no dev server is needed) and the five `Fraunces-*.ttf` fonts.
  - `manifest application-id` is `com.uomi.app`.
  - `manifest print` contains `usesCleartextTraffic="true"`.
  - Record `apk file-size`.
- [ ] **Step 4: Deliver.** Copy the APK to `dist/UOMi-0.1.0.apk`, then report the absolute path, its size, and the on-phone check list: install and open (demo, signed out) → sign in as `kabir.r` / `demo1234` → money loop with Act as… → Server settings with the laptop IP → sign in on server.

## Task 17: Final review and hand-off (controller)

- [ ] Run a whole-change review (a fresh reviewer over the backend and `mobile/`) and fix the findings.
- [ ] Write `BACKEND-DEVIATIONS.md` at the repo root for the backend team. Cover:
  - What was changed and why, in the order of design § 5.
  - What is still open, from the three reviews' findings that were not fixed: sign-up OTP, username-based reset, the space management, expense and settlement endpoints, rate limiting for search/register/forgot, refresh reuse detection, the login lockout race on Postgres, security headers, pinned dependencies, and the 3-letter search rule kept.
  - Each item with its file:line.
- [ ] `git status` shows only uncommitted changes (no commits made). Then report to the user.
