# Backend: what changed in this round, and what is still open

For the backend team. Written 2026-11-07, while the mobile app was built and wired to the Round 1 backend.

- **Plan:** `specs.md` (screens and rules) plus the build design in `docs/superpowers/specs/2026-11-06-uomi-mobile-app-design.md` § 5.
- **Exact API shapes:** the "Backend contract after the fixes" table in `docs/superpowers/plans/2026-11-06-uomi-mobile-app.md`. `README.md` lists the endpoints and the error envelope.

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
| 1 | **Sign-up phone verification.** | specs § 4.3: the account exists only after an OTP. | `POST /auth/register` (`auth_service.register_user`) creates the account and signs the user in at once. There is no pending sign-up and no `checkUsername`/`checkPhone`. The app disables Create Account in server mode. |
| 2 | **Forgot password by username, with a masked phone.** | specs § 4.5. | `POST /auth/forgot` takes a phone number (`auth_service.request_password_reset`), and `/auth/reset` doesn't return the username. The app disables Forgot password in server mode. |
| 3 | **OTP wording and timings.** | specs § 3.4: "incorrect", "expired" and "too many attempts" are separate messages; resend after 30 s. | There is a single `invalid_code`. The resend cooldown is 60 s, there is a cap of 3 codes per hour, and there is no 10-minute lock (`config.OTP_*`). |
| 4 | **Space management.** | specs § 10, § 14.4: `update`, `addMembers`, `removeMember`, `leave`, `delete`. | No endpoints. |
| 5 | **Expenses.** | specs § 8, § 14.4: create, update, delete, accept share, reject share, plus the `expense_share` and `share_rejected` notifications. | The tables exist (Task 1 shape) but there are no endpoints. Notification rows must use `ref_id` = expense id. |
| 6 | **Settlements.** | specs § 9, § 14.4: create, confirm, reject, cancel, plus the `payment_to_confirm` and `payment_answered` notifications. | The tables exist but there are no endpoints. `ref_id` = settlement id. |
| 7 | **Transactions.** | specs § 12: `list(filter)`. | No endpoint. |
| 8 | **Profile and preferences.** | specs § 13, § 14.4: update the name and photo; default currency, theme and notifications preference. | Only `GET /users/me` exists. |
| 9 | **Server-side validation the app enforces today.** | specs § 4.2 (username 3–20 characters, name 1–50, password must contain a letter and a number), § 6.1 (space name 1–30, 8 icon presets), § 6.2 (at least one other member). | The server accepts wider input: usernames 3–30, names up to 100, an 8-character password with no letter-or-digit rule, a space name up to 100 characters, any icon key, and a space with no other members (`schemas/user.py`, `schemas/group.py`). |
| 10 | **Phone numbers.** | specs § 1, § 4.2: validated for the country picked. | `validators.normalize_phone` assumes +91 for national numbers and only checks 8–15 digits. The app always sends full E.164. |
| 11 | **Search rules (decision kept).** | specs § 6.2: username prefix from the first letter. | `user_service.search_users`: friends match from the first letter and come first; everyone else needs 3 letters. This is stricter than the spec and protects privacy, and was kept on purpose. |
| 12 | **Idle sign-out (decision).** | Not in the spec. | The server ends a session after 10 minutes without activity (`SESSION_IDLE_TIMEOUT_MINUTES`). The app applies this only in server mode and returns to Sign In; demo mode stays signed in. Confirm with product whether 10 minutes is right for a "fast at the moment of spending" app. |
| 13 | **Reminders.** | specs § 11.2 (seed only in this phase). | The type exists but nothing generates reminders. The seed has one. |

---

## 3. Before this API goes on a public URL

These are from the security review, still open, highest first. None of them blocks local or LAN testing.

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
