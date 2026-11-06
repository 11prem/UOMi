# UOMi
A mobile app created so that "you don't owe me and I don't owe you"

## UOMi backend: Round 1

FastAPI + SQLAlchemy 2 + Alembic. Built from the UOMi technical flow map.

Round 1 covers accounts and spaces: sign up, sign in, forgot password (phone code), logout, find people,
create space, Home page, Group page and notifications. Live updates, Profile, expenses, settle up,
Transactions and reminders are later rounds.

### Endpoints

| Module | Endpoint |
|---|---|
| Sign up | `POST /auth/register` |
| Sign in | `POST /auth/login`, `POST /auth/refresh` |
| Forgot password | `POST /auth/forgot` (text a code), `POST /auth/verify-otp`, `POST /auth/reset` |
| Logout | `POST /auth/logout` |
| Find people | `GET /users/search?q=` |
| Create space | `POST /spaces` |
| Home page | `GET /spaces` |
| Group page | `GET /spaces/{id}` |
| Notifications | `GET /notifications?before=&limit=`, `PATCH /notifications/{id}` |

Interactive docs: http://127.0.0.1:8000/docs once the server is running.

### Timeouts

All of these are settings in `.env` (defaults shown).

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

#### How the 10-minute inactivity sign-out works

A sign-in creates one row in `refresh_tokens`: that row is the session. Every authenticated request
looks the row up and moves `last_activity_at` forward. If the last activity was more than 10 minutes ago,
the request is refused with `401 session_expired` and the row is deleted. Because the check happens on
the server, it cannot be skipped by keeping an old access token. `/auth/refresh` obeys the same rule, so
an idle session cannot be revived.

The app should also run its own timer using `idle_timeout_seconds` from the sign-in response, so it can
return to the Login page without waiting for a request to fail.

#### Error codes the app can switch on

Errors look like `{"detail": {"code": "...", "message": "..."}}`.

| Code | Status | The app should |
|---|---|---|
| `not_authenticated`, `invalid_token` | 401 | show the Login page |
| `token_expired` | 401 | call `/auth/refresh`, then retry |
| `session_expired` | 401 | show the Login page (idle, logged out, or past the 7-day limit) |
| `invalid_refresh_token` | 401 | show the Login page |
| `invalid_credentials` | 401 | wrong username or password (the same message for both) |
| `too_many_attempts` | 429 | wait `retry_after_seconds` (also in the `Retry-After` header) |
| `resend_too_soon`, `too_many_requests` | 429 | wait before asking for another code |
| `invalid_code` | 400 | wrong or expired code |
| `reset_session_expired` | 400 | start forgot password again |
| `username_taken`, `phone_taken` | 409 | show it on the sign-up form |
| `unknown_usernames` | 422 | the response lists them in `usernames` |

### Run it

Needs Python 3.10 or newer. Create the virtual environment **outside** this folder: it lives in OneDrive,
which would try to sync thousands of package files.

```powershell
py -m venv $env:LOCALAPPDATA\uomi-venv
& $env:LOCALAPPDATA\uomi-venv\Scripts\Activate.ps1
pip install -r requirements.txt
Copy-Item .env.example .env   # then open .env and set SECRET_KEY
alembic upgrade head
uvicorn app.main:app --reload
```

`.env` is not committed because it holds your secret key. Set `SECRET_KEY` in it to a long random value, for example
the output of `python -c "import secrets; print(secrets.token_hex(32))"`. Use a different key for any real deployment.

No SMS provider is connected. With `SMS_BACKEND=console`, the forgot-password text is printed in the
server output, for example `[SMS to +919876543210] Your UOMi code is 482913. ...`. That is how you read the
code while developing. Never run with the console backend in production, because it logs the code.

#### Tests

```powershell
pytest
```

The tests use an in-memory database and never touch `uomi.db`.

### Layout

```
app/
  main.py  config.py  database.py  dependencies.py
  models/     tables (group.py holds Space, expense_split.py holds ExpenseShare, payment.py holds Settlement)
  schemas/    request and response shapes
  routers/    HTTP endpoints, kept thin
  services/   the logic: auth, session, sms, user (search), group, balance, notification
  utils/      security.py, validators.py, errors.py
migrations/   Alembic, with the initial schema in versions/0001_initial_schema.py
tests/
```

### Decisions to check

- **Username is the key.** It is the primary key, goes in the token, and cannot be changed.
- **Search:** friends (people who share a space with you) match from the first letter and come first; everyone
  else matches by username from 3 letters; a phone number only matches when it is complete; at most 10 rows;
  phone numbers are never returned.
- **Adding people to a space is immediate.** They get a "you were added" card, with no accept step. The tick and
  cross belong to expense shares, which come with expenses in a later round.
- **A space can start with just its creator.** It holds at most 50 people.
- **Balances count only accepted shares and confirmed settlements.** Until expenses exist, every balance is 0.
- **Signing out everywhere:** a password reset ends every session of that user and lifts a sign-in lockout.
- **SQLite by default** (no setup). To use PostgreSQL, install `psycopg[binary]` and set `DATABASE_URL` to
  `postgresql+psycopg://user:password@localhost:5432/uomi`. The live-update module in a later round needs PostgreSQL.
