# UOMi backend reference

FastAPI + SQLAlchemy 2 + Alembic. This page is the detailed reference for the API in `app/`. For setup, see the [README](../README.md). For what the backend still lacks, see [`BACKEND-DEVIATIONS.md`](../BACKEND-DEVIATIONS.md).

Interactive docs (Swagger UI) are at <http://127.0.0.1:8000/docs> while the server is running.

## Conventions

- Every field is `snake_case`.
- Money fields end in `_minor` and are whole numbers of minor units (`234000` is 2,340.00). There are no floats anywhere.
- Times are ISO-8601 UTC ending in `Z`.
- A space's `currency` is one of `INR, USD, EUR, GBP, AED, SGD, AUD, CAD` and defaults to the creator's own currency. Currencies are never added together: the Home `overall` block has one line per currency.
- Every error has one shape, including unknown paths, validation errors and crashes: `{"detail": {"code": "...", "message": "...", ...extra}}`.

## Endpoints

| Area | Endpoint |
|---|---|
| Health | `GET /health` |
| Sign up | `POST /auth/register` |
| Sign in | `POST /auth/login`, `POST /auth/refresh` |
| Forgot password | `POST /auth/forgot` (text a code), `POST /auth/verify-otp`, `POST /auth/reset` |
| Logout | `POST /auth/logout` |
| Who am I | `GET /users/me` returns `username`, `name`, `phone`, `currency` |
| Find people | `GET /users/search?q=` |
| Create space | `POST /spaces` takes `name`, `icon`, optional `currency` and `usernames`; returns the Space page |
| Home | `GET /spaces` returns `overall` (one line per currency: `currency`, `net_minor`, `owe_minor`, `owed_minor`) and `spaces` (one card per space, latest activity first) |
| Space page | `GET /spaces/{id}` returns the owner, currency, members, expenses, settlements and who owes whom (`pairwise`) |
| Notifications | `GET /notifications?before=&limit=` returns `items`, `next_before`, `unread_count`. `GET /notifications/unread-count` returns `{"unread_count"}`. `PATCH /notifications/{id}` takes `{"read": true}`. `PATCH /notifications/read-all` returns `{"updated_count"}` |

Not built yet: expenses, settlements, space management, transactions, profile and preferences. The tables for expenses and settlements exist, and balances are computed from them. See [`BACKEND-DEVIATIONS.md`](../BACKEND-DEVIATIONS.md) § 2.

## Balance rules

- Pending and accepted shares count toward balances.
- An expense with a rejected share is disputed and is left out of the balances entirely.
- Only confirmed settlements reduce a balance.
- Pairwise lines are computed by `app/services/balance_service.py` (`pairwise`, `side_of`, `viewer_pairs`). A positive value means they owe you.

## Payment reminders

When `REMINDERS_ENABLED=true`, the API process runs a scheduler once a day (APScheduler). It reminds a debtor on days 3, 5, 7 and 10 after they accepted a share, as long as they still owe that payer. Each (share, day) is sent once, and each run sends at most one notification per debtor, payer and space. Set `REMINDERS_ENABLED=false` to turn it off. The code is in `app/services/reminder_service.py` and `reminder_scheduler.py`.

## Settings

All of these live in `.env`. Defaults are in `.env.example`.

| What | Setting | Default |
|---|---|---|
| Signed out after no activity | `SESSION_IDLE_TIMEOUT_MINUTES` | 10 |
| Access token lifetime (then call `/auth/refresh`) | `ACCESS_TOKEN_EXPIRE_MINUTES` | 15 |
| Longest a session can last, even when active | `REFRESH_TOKEN_EXPIRE_DAYS` | 7 |
| Texted code valid for | `OTP_TTL_MINUTES` | 5 |
| Wrong guesses before the code is dead | `OTP_MAX_ATTEMPTS` | 5 |
| Wait before asking for another code | `OTP_RESEND_COOLDOWN_SECONDS` | 60 |
| Codes per phone number per hour | `OTP_MAX_REQUESTS_PER_HOUR` | 3 |
| Time to set the new password after the code is accepted | `RESET_SESSION_TIMEOUT_MINUTES` | 10 |
| Failed sign-ins before a lockout, and how long it lasts | `LOGIN_MAX_ATTEMPTS`, `LOGIN_LOCKOUT_MINUTES` | 5, 15 |
| Browser origins allowed to call the API | `CORS_ORIGINS` | the Expo web dev server |
| Send payment reminders | `REMINDERS_ENABLED` | `true` |
| Text message delivery | `SMS_BACKEND` | `console` |

`SECRET_KEY` is required, at least 32 characters, and has no default on purpose.

## How the 10-minute inactivity sign-out works

A sign-in creates one row in `refresh_tokens`: that row is the session. Every authenticated request looks the row up and moves `last_activity_at` forward. If the last activity was more than 10 minutes ago, the request is refused with `401 session_expired` and the row is deleted. Because the check happens on the server, it cannot be skipped by keeping an old access token. `/auth/refresh` obeys the same rule, so an idle session cannot be revived.

The app also runs its own timer, using `idle_timeout_seconds` from the sign-in response minus a 30-second margin. It returns to Sign In without waiting for a request to fail.

## Error codes the app switches on

| Code | Status | The app should |
|---|---|---|
| `validation_error` | 422 | show each problem next to its field: `fields` is a list of `{field, message}` (the input is never echoed back) |
| `not_found`, `method_not_allowed` | 404, 405 | a wrong path or method: a bug in the app, not something to show the user |
| `space_not_found`, `notification_not_found` | 404 | that space or card does not exist (or is not yours) |
| `internal_error` | 500 | say something went wrong and offer Retry; the body is still JSON |
| `not_authenticated`, `invalid_token` | 401 | show Sign In |
| `token_expired` | 401 | call `/auth/refresh`, then retry |
| `session_expired` | 401 | show Sign In (idle, logged out, or past the 7-day limit) |
| `invalid_refresh_token` | 401 | show Sign In |
| `invalid_credentials` | 401 | wrong username or password (the same message for both) |
| `too_many_attempts` | 429 | wait `retry_after_seconds` (also in the `Retry-After` header) |
| `resend_too_soon`, `too_many_requests` | 429 | wait before asking for another code |
| `invalid_code` | 400 | wrong or expired code |
| `reset_session_expired` | 400 | start forgot password again |
| `username_taken`, `phone_taken` | 409 | show it on the sign-up form |
| `unknown_usernames` | 422 | the response lists them in `usernames` |

## Design decisions worth knowing

- **Username is the key.** It is the primary key, goes in the token, and cannot be changed.
- **Search:** friends (people who share a space with you) match from the first letter and come first. Everyone else matches by username from 3 letters. A phone number only matches when it is complete. At most 10 rows, and phone numbers are never returned.
- **Adding people to a space is immediate.** They get a "you were added" card, with no accept step. The tick and cross belong to expense shares.
- **A space can start with just its creator.** It holds at most 50 people.
- **Signing out everywhere:** a password reset ends every session of that user and lifts a sign-in lockout.
- **SQLite by default**, with no setup. To use PostgreSQL, install `psycopg[binary]` and set `DATABASE_URL` to `postgresql+psycopg://user:password@localhost:5432/uomi`. Migration `0002` has only been tested on SQLite.
- **Development SMS:** with `SMS_BACKEND=console` the code is printed in the server output (for example `[SMS to +919876543210] Your UOMi code is 482913. ...`). Never run the console backend in production, because it logs every code.
- If you have an older `.env`, set `DEBUG=false`. With `DEBUG=true` an unexpected error returns a traceback page instead of the JSON `internal_error` reply the app expects.

## Code layout

```
app/
  main.py  config.py  database.py  dependencies.py  currencies.py
  models/     tables (group.py holds Space, expense_split.py holds ExpenseShare, payment.py holds Settlement)
  schemas/    request and response shapes
  routers/    HTTP endpoints, kept thin: auth, users, groups (spaces), notifications
  services/   the logic: auth, session, sms, user (search), group, balance, notification, reminder
  utils/      security.py, validators.py, errors.py
migrations/   Alembic: 0001 initial schema, 0002 spec alignment, bdc30b15495a payment reminders
scripts/      seed_demo.py, the demo data for the phone app
tests/        127 tests on an in-memory database
```
