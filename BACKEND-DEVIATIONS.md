# Backend: what changed in this round, and what is still open

For the backend team. Written 2026-11-07, while the mobile app was built and wired to the Round 1 backend.

- **Plan:** `specs.md` (screens and rules) plus the build design in `docs/superpowers/specs/2026-11-06-uomi-mobile-app-design.md` § 5.
- **Exact API shapes:** the "Backend contract after the fixes" table in `docs/superpowers/plans/2026-11-06-uomi-mobile-app.md`. `docs/backend-api.md` lists the endpoints and the error envelope.

The code was reviewed three ways before any change: against the plan, for FastAPI quality (including a live test run) and for security. Every change below went through its own code review. The full suite passes (118 tests).

---

## 1. What changed, and why

The changes are in commit order on branch `mobile-app-round1`. Each one is its own commit.

| Commit | Change | Why (plan reference) |
|---|---|---|
| `feat(backend): spec-aligned data model and migration 0002` | Changes in migration `0002_spec_alignment.py`, which keeps existing data and can be downgraded:<br>- Money is stored as integer minor units (`amount_minor`).<br>- `spaces.currency` is added.<br>- Split types are `equal`/`exact`/`percent`/`shares` (`item` is removed).<br>- Expenses gain `created_by`, `date`, `updated_at` and a 50-character `description`; shares gain `input`.<br>- Settlement statuses are `pending`/`confirmed`/`rejected`/`cancelled`, with `answered_at`.<br>- Notifications gain `message`, `space_name`, `needs_answer` and `read`, and `space_id` is now `SET NULL`. | specs § 1 (integer money, rounding) and § 14.3 (entities). On SQLite the old `Numeric` columns were stored as floats. |
| `feat(backend): spec balance rules and reshaped spaces API` | - Balances now count pending and accepted shares, exclude disputed expenses entirely, and count only confirmed settlements.<br>- `GET /spaces` returns `overall` per currency (`net/owe/owed_minor`) plus `counterparty_*` and `last_activity_at` on each card.<br>- `GET /spaces/{id}` returns the owner, currency, expenses, settlements and pairwise lines in minor units.<br>- `POST /spaces` accepts `currency`. | specs § 14.2 (balance rules), § 5.1 (Home: per-currency totals, never summed; "You owe ₹20 · Swetha"), § 7 (Space page). |
| `feat(backend): notifications contract and GET /users/me` | - `NotificationOut` has `message`, `space_name`, `needs_answer` and `read`.<br>- The list returns `unread_count`.<br>- The seven notification types from § 11.2 are supported.<br>- `GET /users/me` is new. | specs § 11, § 14.3. The app had no way to learn the signed-in user's own name or phone. |
| `fix(backend): CORS, unified error envelope, id bounds, atomic OTP counter` | - CORS uses an allowlist (`CORS_ORIGINS`).<br>- Every error is `{"detail": {"code", "message"}}`, and 422s no longer echo the submitted input, so passwords stay out of responses.<br>- Oversized ids return 422 instead of 500.<br>- The OTP wrong-guess counter is a single atomic `UPDATE`.<br>- `91…` numbers no longer get a second `+91`.<br>- `.env.example` has `DEBUG=false`.<br>- A password mismatch is reported on `confirm_password`. | Findings from the quality and security reviews. Before this fix, parallel guesses could get past the 5-try limit. |
| `feat(backend): demo seed script and phone-app run guide` | - `scripts/seed_demo.py [--reset]` loads the app's demo users, spaces and money. Every user's password is `demo1234`.<br>- The README explains how to run the API for a phone over Wi-Fi or USB. | Server mode in the app has no sign-up (see § 2), so testers need seeded accounts. The seed numbers match the app's demo mode exactly. |
| `feat(notifications): adopt PR #3 unread-count and PATCH read-all` | Pavan's PR #3 (`GET /notifications/unread-count`, `PATCH /notifications/read-all`) is merged on `main` and carried onto the new model. `POST /notifications/read-all` now returns 405. | specs § 11.1 (mark all as read), § 14.4 (`unreadCount`). |

### Breaking changes for code written against Round 1

Any branch started from the Round 1 code (`25afa76`) needs these renames before it merges. PR #4 needed all of them.

| Area | Round 1 | Now |
|---|---|---|
| Money columns | `Expense.amount`, `ExpenseShare.amount`, `Settlement.amount` (`Numeric`, major units) | `amount_minor` (`int`, minor units: `"500"` rupees is `50000`) |
| Expense | `title` (200) | `description` (50), plus `created_by`, `date`, `updated_at` |
| Settlement | `confirmed_at`; statuses `pending`/`confirmed` | `answered_at`; statuses `pending`/`confirmed`/`rejected`/`cancelled` |
| Split types | `equal`/`exact`/`item` | `equal`/`exact`/`percent`/`shares` |
| Notification columns | `title`, `body`, `is_read`; `space_id` cascades on delete | `message`, `read`, `space_name`, `needs_answer`; `space_id` is `SET NULL` |
| Notification types | `share_request`, `share_response`, `settlement_request`, `payment_reminder`, … | `expense_share`, `share_rejected`, `payment_to_confirm`, `payment_answered`, `space_added`, `space_deleted`, `reminder` |
| `create_notification(...)` | `notification_type=`, `title=`, `body=` | `type=`, `message=`, `space_name=`, `needs_answer=` |
| `balance_service` | `get_balances`, `get_space_balance`, `get_debts` | `pairwise(db, space_id)`, `side_of(pairs, username)`, `viewer_pairs(db, space_id, username)` (positive = they owe you) |
| Migrations | head `0001` | head `0002_spec_alignment`; a new migration must revise the current head |

---

## 2. Still open against the plan

The app handles every gap below without crashing. In **server mode** it shows "Not available on this server yet" wherever an endpoint is missing, and in **demo mode** the full flow works on built-in data.

| # | Gap | Plan | What exists today |
|---|---|---|---|
| 1 | **Sign-up phone verification.** | specs § 4.3: the account exists only after an OTP. | **Backend done** (task 1.1.1, `auth_service.start_signup` / `verify_signup`, `models/pending_signup.py`, migration `0004`, `tests/test_signup_verification.py`): `POST /auth/register` texts a code and creates nothing, `POST /auth/register/verify` creates the account, `POST /auth/otp/resend`, and `GET /auth/check-username` and `/auth/check-phone`. A sign-up that is never verified expires and reserves nothing. **Still open:** the app's `auth.signUp`, `verifySignUpOtp`, `resendOtp`, `checkUsername` and `checkPhone` are still the stub `no`, and Create Account is disabled in server mode. |
| 2 | **Forgot password by username, with a masked phone.** | specs § 4.5. | **Backend done** (task 1.1.2, `auth_service.request_password_reset`, `tests/test_password_reset.py`): `POST /auth/forgot` takes a username and returns the masked phone (`+91 98******10`) and a `reset_id`; `/auth/verify-otp` takes the `reset_id` and the code; `/auth/reset` returns the username. An unknown username gets the same kind of reply, with a made-up masked number. **Still open:** the app's `requestResetOtp`, `verifyResetOtp` and `resetPassword` are still the stub `no`, and Forgot password is disabled in server mode. |
| 3 | **OTP wording and timings.** | specs § 3.4: "incorrect", "expired" and "too many attempts" are separate messages; resend after 30 s. | **Done** (task 1.1.3, `otp_service.py`): `invalid_code` ("That code is incorrect"), `code_expired` ("Code expired — resend"), `otp_locked` ("Too many attempts — try again in 10 minutes", with `retry_after_seconds`), `resend_too_soon`. Resend after 30 s, a 10-minute lock after the 5th wrong code, at most 3 texts per request. The app already maps `invalid_code`, `code_expired` and `otp_locked` (`mobile/src/services/server/http.ts`); `resend_too_soon`, `too_many_requests` and the `verification_*` codes still need mapping when the screens are wired (task 6.1). |
| 4 | **Space management.** | specs § 10, § 14.4: `update`, `addMembers`, `removeMember`, `leave`, `delete`. | **Backend done** (task 1.2, `group_service.py`, `routers/groups.py`, `tests/test_space_management.py`): rename and icon (any member), currency (owner, before the first expense), add people (any member, at most 50), remove a member (owner), leave (not the owner), delete the space (owner, when everyone is settled up). The app's five `spaces.*` calls now make real requests (`mobile/src/services/server/index.ts`). **Decisions taken:** only a zero balance blocks removing or leaving; a payment waiting for an answer, or a share nobody has answered, is left as it is (Appendix B, B.10); the person who deletes a space is not sent the "space deleted" card (as in the app's demo, the spec's table says "all members"); a non-member gets 404, not the 403 the task text names, as everywhere else. **Still open:** the members screen is still gated in server mode, so the app shows "Not available on this server yet" there until task 6.1, and a new space now needs one other person (1.2.7, decided). |
| 5 | **Expenses.** | specs § 8, § 14.4: create, update, delete, accept share, reject share, plus the `expense_share` and `share_rejected` notifications. | **Backend done** (task 1.3, `expense_service.py`, `routers/expenses.py`, `tests/test_expenses.py`): add, edit, delete, accept, reject, the detail screen, the paged list, and the cards, with `ref_id` = expense id. **Still open:** the app's `expenses.*` calls are still the stub `no`, and the expense screens are gated in server mode. |
| 6 | **Settlements.** | specs § 9, § 14.4: create, confirm, reject, cancel, plus the `payment_to_confirm` and `payment_answered` notifications. | **Backend done** (task 1.4, `settlement_service.py`, `routers/settlements.py`, `tests/test_settlements.py`), with `ref_id` = settlement id. The app's six `settlements.*` calls now make real requests (`mobile/src/services/server/index.ts`). **Still open:** `app/payment/[id].tsx` and `app/space/[id]/settle.tsx` still show "Not available on this server yet" in server mode until their `server` gating is removed (task 6.1), and the app's tests for that have not been run. |
| 7 | **Transactions.** | specs § 12: `list(filter)`. | **Done** (task 1.5, `transaction_service.py`, `routers/transactions.py`, `schemas/transaction.py`, `tests/test_transactions.py`): `GET /transactions` with `kind`, `space_id`, `before` and `limit`, paged by a marker. The app's `transactions.list` follows the pages (`mobile/src/services/server/index.ts`) and the Transactions tab now works in server mode. **Still open:** tapping a row opens the expense or payment screen, and those are still gated in server mode, and the app's tests for the tab have not been run. |
| 8 | **Profile and preferences.** | specs § 13, § 14.4: update the name and photo; default currency, theme and notifications preference. | **Done on the server** (task 1.6): `PATCH /users/me` changes the name, the default currency and the notifications switch (`users.notifications_on`, migration `0006`); the theme stays on the phone. **Not done:** the photo (Phase 3 object storage), and the app's `profile.update` / `profile.setPreferences` calls still use the local fallback in server mode. |
| 9 | **Server-side validation the app enforces today.** | specs § 4.2 (username 3–20 characters, name 1–50, password must contain a letter and a number), § 6.1 (space name 1–30, 8 icon presets), § 6.2 (at least one other member). | **Done** except the last rule (task 1.1.4, `utils/validators.py`, `schemas/group.py`, `tests/test_validation_rules.py`): a new username is 3–20, a name 1–50, a password 8+ with a letter and a number, a space name 1–30, the icon one of the eight keys. **Older looser values are left alone** (decision for Appendix B, B.9): an existing 21–30 character username still signs in, is found and can be added to a space, an old weak password still signs in, and an old long space name or other icon still displays. **Decided (task 1.2.7, Appendix B, B.8):** a new space must have at least one other member, enforced by the server (422 on `usernames`) as well as by the app. |
| 10 | **Phone numbers.** | specs § 1, § 4.2: validated for the country picked. | **Done** (task 1.1.5, `validators.normalize_phone`): checked with libphonenumber (the `phonenumbers` package, pinned in `requirements.txt`): a valid mobile number for its country, landlines refused where libphonenumber can tell, and only ASCII digits accepted (Arabic-Indic, fullwidth and other look-alike digits are refused, also in codes and search). In the US and Canada libphonenumber cannot tell a landline from a mobile, so a landline there is accepted. A number typed with no country code is still read as +91. |
| 11 | **Search rules (decision kept).** | specs § 6.2: username prefix from the first letter. | `user_service.search_users`: friends match from the first letter and come first; everyone else needs 3 letters. This is stricter than the spec and protects privacy, and was kept on purpose. |
| 12 | **Idle sign-out (decided).** | Not in the spec. | **Decided (task 1.1.6, Appendix B, B.1): 30 minutes**, up from 10, so the app is not asking for the password again at the moment of spending. It is one setting, `SESSION_IDLE_TIMEOUT_MINUTES`, and the app already follows the server's value (`idle_timeout_seconds`, minus a 30-second margin), so nothing changes in the app. The 7-day limit still ends every session. Set it back to 10 in `.env` if product prefers. |
| 13 | **Reminders.** | specs § 11.2 (seed only in this phase). | The type exists but nothing generates reminders. The seed has one. |
| 14 | **Deleting an account (decided).** | Not in the spec. | **Decided (task 1.7.1, Appendix B, B.6) and built (1.7.2):** the account is anonymised, not erased, so other people's ledgers stay correct; the username is retired, the phone is freed; refused until settled up in every space and while the person owns a space with others in it. `users.phone` is now nullable and `users.deleted_at` exists (migration `0007`). Details: `docs/backend-api.md`, *Deleting an account*. Not built: transferring a space to another owner, the app screen (task 6.13). |
| 15 | **Export and clean-up (built).** | Not in the spec. | **Built (tasks 1.7.3 and 1.7.4):** `GET /users/me/export`, and a daily job that deletes expired sessions, sign-in attempts, reset and sign-up requests, and old cards (`RETENTION_ENABLED`, `NOTIFICATION_RETENTION_DAYS`). Both have tests. The job runs inside the API process, so with several processes each one runs it (harmless: deleting twice is the same as once). A separate worker is task 4.4.2. |

---

## 3. Before this API goes on a public URL

**Status after branch `phase2-security-hardening` (PRODUCTION-READINESS tasks 2.1 to 2.10).** The list below is the original review, kept as it was. What the branch did to each item:

| Item | State |
|---|---|
| 1. Enumeration oracles | **Partly closed.** Rate limits: sign-up per address, search per user and per address, and a much tighter per-user limit on searches by a complete phone number. **Closed:** the phone is now verified at sign-up (task 1.1.1), so nobody can register someone else's number. **Still true:** `/auth/register` and the live `check-username` / `check-phone` answers still say whether a username or number is taken, because the spec asks for that. They are limited per address (the phone check much tighter). The limits make probing slow and costly. They do not make it impossible. |
| 2. SMS pumping | **Closed in code:** per-address limits on `/auth/forgot` and `/auth/verify-otp`, and `SMS_DAILY_CAP` for all numbers together. **Not code:** a daily spend ceiling and spend alerts at the SMS provider (task 7.5). There is no per-device cap, because the API has no device id: the address is all it can count. |
| 3. Dev defaults | **Closed.** `ENVIRONMENT=production` refuses to start with the console SMS backend, `DEBUG=true`, a placeholder `SECRET_KEY`, a missing `OTP_HMAC_KEY` or non-https CORS origins, and turns off `/docs`, `/redoc` and `/openapi.json`. |
| 4. Refresh tokens | **Closed.** One conditional UPDATE swaps the token, and a replayed token ends its session. Only the most recent swapped-out token is remembered, and a reply lost on a bad connection signs the user out (see `docs/backend-api.md`). |
| 5. Login lockout | **Closed for the race and the per-address case.** The attempt is committed before the password check, refused attempts are taken back out, and `LOGIN_MAX_PER_IP` limits one address. **Still true:** the lockout counts per username, so someone using many addresses can still lock out a username they know. |
| 6. Forgot-password denial of service | **Closed for cancelling:** asking again starts a separate request and no longer cancels an earlier code or an open reset session. **Still true:** 3 requests per hour per username can be used up by anyone, which blocks that username for the hour. |
| 7. Unicode digits in phone numbers | **Closed** (task 1.1.5): only ASCII digits are read, in phone numbers, codes and search. |
| 8. Smaller items | **Closed:** HS256 fixed in code, `iss` / `aud` claims, a separate OTP key, bcrypt floor of 12 outside `test`, atomic single-use reset token, search terms redacted from the access log, `no-store` and HSTS, CORS headers on 500 replies, pinned dependencies. **Still open:** old `password_resets` and `refresh_tokens` rows are never deleted (task 1.7.4). |
| 9. PostgreSQL | Not part of this branch. Migration `0003` is plain `batch_alter_table` and should be fine, but has only run on SQLite. |

These are from the security review, highest first. None of them blocks local or LAN testing.

1. **Registration and search act as enumeration oracles.**
   - `/auth/register` answers `phone_taken`/`username_taken` with no throttle, and the phone is never verified (gap 1). Anyone can test which numbers are registered, or register someone else's number.
   - `/users/search` has no rate limit.
   - Fix: verify the phone at sign-up, give one generic registration reply, and rate-limit by IP and by user.
2. **SMS pumping.** Once a real SMS provider is connected, unverified sign-ups plus `/auth/forgot` (3 codes per hour per number) can be abused. Fix: per-IP, per-device and global SMS caps, with a daily spend ceiling.
3. **Dev defaults.** `SMS_BACKEND=console` logs every code, and `/docs` is public. Fix: refuse to start with the console backend outside development, and turn off docs in production.
4. **Refresh tokens.**
   - Rotation has no reuse detection.
   - The rotation itself is select-then-update, so two parallel refreshes can both succeed (`session_service.refresh_session`).
   - Fix: keep the previous hash and end the session when a rotated-out token comes back. Swap atomically with `UPDATE … WHERE token_hash = :old`.
   - The app already refreshes one request at a time.
5. **Login lockout.**
   - It counts per username only, so anyone can lock a victim out.
   - It checks first and records the attempt after bcrypt, so on PostgreSQL a burst of parallel guesses can bypass it (`auth_service.login`).
   - Fix: record the attempt before verifying, and add per-IP throttling.
6. **Forgot-password denial of service.** An anonymous `/auth/forgot` cancels the victim's pending code.
7. **Unicode digits in phone numbers.** `\d` accepts non-ASCII digits (`validators.py`). Use `[0-9]` or `re.ASCII`.
8. **Smaller items:**
   - JWT: pin `HS256`, add `iss`/`aud`, and use a separate OTP HMAC key.
   - Enforce a bcrypt rounds floor of at least 12 outside tests.
   - Full phone numbers appear in access logs through `/users/search?q=`.
   - The reset-token single-use check races.
   - No old rows in `password_resets` or `refresh_tokens` are ever deleted.
   - There are no HSTS or `no-store` headers.
   - `requirements.txt` is unpinned. `NoDecode` needs `pydantic-settings>=2.7`.
   - 500 responses carry no CORS headers.
9. **PostgreSQL.** Migration `0002` was tested on SQLite only. `drop_constraint` for the notifications foreign key uses the SQLite batch naming convention. Run it against PostgreSQL before switching.

## 4. Smaller follow-ups from the code reviews

- `GET /spaces/{id}` settlements are not paged; expenses are capped at 50.
- The `--reset` option of `scripts/seed_demo.py` also deletes spaces that a demo user created, even when real users are members. It refuses only if `kabir.r` exists.
- Test gaps:
  - No test where the payer is outside the split.
  - `tests/test_balances.py` compares dates at assert time, which can fail around midnight UTC.
  - No test that runs the downgrade and checks indexes and foreign keys.
- `app/models/expense_split.py`'s docstring still says only accepted shares count.
