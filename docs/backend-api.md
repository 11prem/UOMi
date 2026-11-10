# UOMi backend reference

FastAPI + SQLAlchemy 2 + Alembic. This page is the detailed reference for the API in `app/`. For setup, see the [README](../README.md). For what the backend still lacks, see [`BACKEND-DEVIATIONS.md`](../BACKEND-DEVIATIONS.md). To add to it, see [`adding-to-the-backend.md`](adding-to-the-backend.md).

Interactive docs (Swagger UI) are at <http://127.0.0.1:8000/docs> while the server is running. They are switched off (like `/redoc` and `/openapi.json`) when `ENVIRONMENT=production`.

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
| Sign up (2 steps) | `POST /auth/register` takes `username`, `name`, `phone`, `password`, `confirm_password`, texts a code and returns 202 `{pending_id, masked_phone, expires_in_seconds, resend_after_seconds}`. **No account exists yet.** `POST /auth/register/verify` takes `{pending_id, code}`; the right code creates the account and returns 201 and the tokens |
| Live checks on Create Account | `GET /auth/check-username?username=` and `GET /auth/check-phone?phone=` return `{"available": true/false}` (422 for something that could never be a username or number) |
| Resend code | `POST /auth/otp/resend` takes `{id}`, a `pending_id` or a `reset_id`, and returns `{expires_in_seconds, resend_after_seconds}` |
| Sign in | `POST /auth/login`, `POST /auth/refresh` |
| Forgot password | `POST /auth/forgot` takes `{username}`, texts a code to its phone and returns 202 `{reset_id, masked_phone, message, expires_in_seconds, resend_after_seconds}`; `POST /auth/verify-otp` takes `{reset_id, code}` and returns `{reset_token, expires_in_seconds}`; `POST /auth/reset` takes `{reset_token, new_password, confirm_password}` and returns `{message, username}` |
| Logout | `POST /auth/logout` |
| Who am I | `GET /users/me` returns `username`, `name`, `phone`, `currency`, `notifications_on` |
| Edit my profile and preferences | `PATCH /users/me` takes any of `name` (1–50), `currency` (the default for a new space) and `notifications_on` (a real true or false). A field left out, or null, stays as it is. Anything else, the username and phone included, is a 422. Returns the same as `GET /users/me`. The theme stays on the phone |
| Export my data | `GET /users/me/export` returns a JSON file (`Content-Disposition: attachment`) with `profile`, `spaces` (members by name only, every expense with its shares, every payment) and `notifications`. Only what the person can see: spaces they have left are not in it, and never another person's phone, a password hash or a token. Limited to `EXPORT_MAX_PER_USER_PER_HOUR` per person |
| Delete my account | `POST /users/me/delete` takes `{password}` and returns 204. Wrong password: 403 `forbidden` / `wrong_password` (counted like a failed sign-in, and locked the same way: 429 `too_many_attempts`). Not settled up in every space: 403 `not_settled`. Owns a space with other people in it: 403 `owns_shared_space`. Both list the spaces (`spaces: [{id, name}]`). See *Deleting an account* below |
| Find people | `GET /users/search?q=` |
| Create space | `POST /spaces` takes `name`, `icon`, optional `currency` and `usernames`; returns the Space page |
| Home | `GET /spaces` returns `overall` (one line per currency: `currency`, `net_minor`, `owe_minor`, `owed_minor`) and `spaces` (one card per space, latest activity first) |
| Space page | `GET /spaces/{id}` returns the owner, currency, members, expenses, settlements and who owes whom (`pairwise`) |
| Notifications | `GET /notifications?before=&limit=` returns `items`, `next_before`, `unread_count`. `GET /notifications/unread-count` returns `{"unread_count"}`. `PATCH /notifications/{id}` takes `{"read": true}`. `PATCH /notifications/read-all` returns `{"updated_count"}` |

| Expenses | `GET /spaces/{id}/expenses?before=&limit=` (1–100, default 50) returns `items` and `next_before`. `POST /spaces/{id}/expenses` and `PUT /expenses/{id}` take `description`, `amount_minor`, `paid_by`, `split_type` (`equal`, `exact`, `percent`, `shares`), `shares` (`[{username, input}]`) and `date`; both return the expense. `GET /expenses/{id}` returns the expense with its space, members and each person's share and answer. `DELETE /expenses/{id}` returns 204. `POST /expenses/{id}/accept` and `POST /expenses/{id}/reject` answer your own share |
| Settle up | `GET /spaces/{id}/payees` returns `[{user, owed_minor, max_minor}]`. `POST /spaces/{id}/settlements` takes `to_username` and `amount_minor` and returns the payment (201). `GET /settlements/{id}` returns it. `POST /settlements/{id}/confirm`, `POST /settlements/{id}/reject` and `POST /settlements/{id}/cancel` return it with its new `status` |
| Transactions | `GET /transactions?kind=all\|expenses\|payments&space_id=&before=&limit=` (limit 1–100, default 50) returns `items` and `next_before`. Every expense in the viewer's spaces and every payment the viewer is part of, newest first, each with `kind` (`expense` or `payment`), `space_id`, `space_name` and `currency`. An expense row is the Space page's card (with the viewer's own share and `disputed`), a payment row is the Space page's payment (with its `status`). No totals. `space_id` narrows to one space (404 `space_not_found` if the viewer is not in it). Pass `next_before` back as `before` for the next page |
| Space settings and people | `PATCH /spaces/{id}` takes any of `name`, `icon`, `currency` and returns the Space page (any member may rename and change the icon; only the owner may change the currency, and only before the first expense). `POST /spaces/{id}/members` takes `{usernames}` (any member; at most 50 people) and returns the Space page. `DELETE /spaces/{id}/members/{username}` removes a member (owner only). `POST /spaces/{id}/leave` (any member but the owner). `DELETE /spaces/{id}` deletes the space (owner only). The last three return 204 |

What is not built yet is listed in [`BACKEND-DEVIATIONS.md`](../BACKEND-DEVIATIONS.md) § 2.

## Balance rules

- Pending and accepted shares count toward balances.
- An expense with a rejected share is disputed and is left out of the balances entirely.
- Only confirmed settlements reduce a balance.
- Pairwise lines are computed by `app/services/balance_service.py` (`pairwise`, `side_of`, `viewer_pairs`). A positive value means they owe you.

## Payment reminders

When `REMINDERS_ENABLED=true`, the API process runs a scheduler once a day (APScheduler). It reminds a debtor on days 3, 5, 7 and 10 after they accepted a share, as long as they still owe that payer. Each (share, day) is sent once, and each run sends at most one notification per debtor, payer and space. Set `REMINDERS_ENABLED=false` to turn it off. The code is in `app/services/reminder_service.py` and `reminder_scheduler.py`.

## Deleting an account

Decided in task 1.7.1 (Appendix B, B.6), built in 1.7.2 (`app/services/account_service.py`):

- **The account is anonymised, not erased.** The `users` row stays, because the username is the key that other people's expenses, shares and payments point at, so everyone else's ledger keeps adding up. Its name becomes "Deleted user", the phone is cleared, the password is replaced by one nobody knows, and `deleted_at` is set. Old records name the person "Deleted user".
- **The username is retired for good.** Nobody can sign up with it again (`username_taken`), so nobody can pose as the old person in old spaces.
- **The phone number is free.** It can sign up a new account straight away (the usual 30-second wait between texts to one number still applies).
- **It is refused until the person is settled up in every space** (their balance with everyone is zero, the same rule as leaving a space), **and while they own a space with other people in it** (they delete the space or remove the others first). A space only they are in is deleted with the account.
- **What is removed:** every session, every card, every password-reset and sign-in record, their place in each space, and any payment of theirs still waiting for an answer (it is cancelled, and the card asking about it goes). A share of theirs that nobody answered stays as it is, as when someone leaves a space.
- **A deleted account is treated as one that never existed:** it cannot sign in (`invalid_credentials`), cannot be found by search or added to a space (`unknown_usernames`), and forgot password answers for it exactly as for an unknown username, without sending a text. Its old tokens stop working.
- **Not rewritten:** names inside *other* people's old cards ("Alice added you to ..."). The clean-up job deletes those cards after `NOTIFICATION_RETENTION_DAYS`.
- **Not built:** handing a space to another owner (so an owner with a busy space has to delete it), and the Delete my account screen in the app (task 6.13).

## The clean-up job

When `RETENTION_ENABLED=true` the API process runs `app/services/retention_service.py` once a day, so tables that only grow stay bounded (task 1.7.4). It deletes: sessions whose 7-day limit ended more than a day ago; sign-in attempts older than the lockout window; password-reset requests and sign-up requests older than a day; and cards older than `NOTIFICATION_RETENTION_DAYS` (180) unless they still ask a question. Sign-up and reset requests are kept a whole day because the daily text cap counts them. Set `RETENTION_ENABLED=false` to turn it off.

## Settings

All of these live in `.env`. Defaults are in `.env.example`.

| What | Setting | Default |
|---|---|---|
| Signed out after no activity | `SESSION_IDLE_TIMEOUT_MINUTES` | 30 |
| Access token lifetime (then call `/auth/refresh`) | `ACCESS_TOKEN_EXPIRE_MINUTES` | 15 |
| Longest a session can last, even when active | `REFRESH_TOKEN_EXPIRE_DAYS` | 7 |
| Texted code valid for | `OTP_TTL_MINUTES` | 5 |
| Wrong guesses before a sign-up or reset is locked, and how long the lock lasts | `OTP_MAX_ATTEMPTS`, `OTP_LOCK_MINUTES` | 5, 10 |
| Wait before asking for another code ("Resend code") | `OTP_RESEND_COOLDOWN_SECONDS` | 30 |
| Sign-up or reset requests per phone number (sign-up) or typed username (forgot) per hour | `OTP_MAX_REQUESTS_PER_HOUR` | 3 |
| Texts for one request, the first included | `OTP_MAX_SENDS_PER_REQUEST` | 3 |
| How long an unfinished sign-up or reset request stays open | `OTP_FLOW_TTL_MINUTES` | 30 |
| Time to set the new password after the code is accepted | `RESET_SESSION_TIMEOUT_MINUTES` | 10 |
| Failed sign-ins before a lockout, and how long it lasts | `LOGIN_MAX_ATTEMPTS`, `LOGIN_LOCKOUT_MINUTES` | 5, 15 |
| Sign-in attempts from one address per lockout window | `LOGIN_MAX_PER_IP` | 30 |
| Sign-ups from one address per hour | `REGISTER_MAX_PER_IP_PER_HOUR` | 20 |
| Code requests from one address per hour (any usernames) | `FORGOT_MAX_PER_IP_PER_HOUR` | 10 |
| "Resend code" from one address per hour | `RESEND_MAX_PER_IP_PER_HOUR` | 30 |
| Code checks from one address per hour (sign-up and reset) | `VERIFY_OTP_MAX_PER_IP_PER_HOUR` | 30 |
| "Is this username free" checks from one address per minute | `USERNAME_CHECK_MAX_PER_IP_PER_MINUTE` | 60 |
| "Is this phone free" checks from one address per hour | `PHONE_CHECK_MAX_PER_IP_PER_HOUR` | 30 |
| Searches per user, and per address, per minute | `SEARCH_MAX_PER_USER_PER_MINUTE`, `SEARCH_MAX_PER_IP_PER_MINUTE` | 120, 240 |
| Searches by a complete phone number, per user per hour | `PHONE_LOOKUPS_PER_USER_PER_HOUR` | 20 |
| Codes (texts) for all numbers together, per UTC day | `SMS_DAILY_CAP` | 1000 |
| Proxies in front of the API | `TRUSTED_PROXY_COUNT` | 0 |
| Browser origins allowed to call the API | `CORS_ORIGINS` | the Expo web dev server (nothing in production) |
| Send payment reminders | `REMINDERS_ENABLED` | `true` |
| Run the daily clean-up job | `RETENTION_ENABLED` | `true` |
| Delete cards older than this many days (unless they still ask a question) | `NOTIFICATION_RETENTION_DAYS` | 180 |
| Data exports per person per hour | `EXPORT_MAX_PER_USER_PER_HOUR` | 5 |
| Text message delivery | `SMS_BACKEND` | `console` |
| `development`, `test`, `staging` or `production` | `ENVIRONMENT` | `development` |
| Own key for the texted codes | `OTP_HMAC_KEY` | empty (required in production) |

`SECRET_KEY` is required, at least 32 characters, and has no default on purpose. `BCRYPT_ROUNDS` (default 12) cannot be set below 12 in any environment except `test`.

**Production mode.** With `ENVIRONMENT=production` the API refuses to start, with a message that lists every problem, if: `DEBUG` is true; `SMS_BACKEND` is `console`; `SECRET_KEY` looks like a placeholder or has too few different characters; `OTP_HMAC_KEY` is missing, equal to `SECRET_KEY` or weak; or `CORS_ORIGINS` has `*` or an origin that is not `https://`. In production `CORS_ORIGINS` defaults to nothing (the native app does not use CORS) and `/docs`, `/redoc` and `/openapi.json` are off.

## How the 30-minute inactivity sign-out works

A sign-in creates one row in `refresh_tokens`: that row is the session. Every authenticated request looks the row up and moves `last_activity_at` forward. If the last activity was more than `SESSION_IDLE_TIMEOUT_MINUTES` (30) ago, the request is refused with `401 session_expired` and the row is deleted. Because the check happens on the server, it cannot be skipped by keeping an old access token. `/auth/refresh` obeys the same rule, so an idle session cannot be revived.

The app also runs its own timer, using `idle_timeout_seconds` from the sign-in response minus a 30-second margin. It returns to Sign In without waiting for a request to fail.

## Error codes the app switches on

| Code | Status | The app should |
|---|---|---|
| `validation_error` | 422 | show each problem next to its field: `fields` is a list of `{field, message}` (the input is never echoed back) |
| `not_found`, `method_not_allowed` | 404, 405 | a wrong path or method: a bug in the app, not something to show the user |
| `space_not_found`, `notification_not_found`, `expense_not_found`, `settlement_not_found` | 404 | that space, card, expense or payment does not exist (or you are not in its space) |
| `person_not_found` | 404 | the person you tried to pay is yourself, does not exist, or is outside the space and owed nothing |
| `forbidden` | 403 | you may not do this. `reason` says which rule: `not_creator`, `not_your_share`, `own_share`, `not_payee`, `not_payer`, `already_answered`, `not_pending`, `owes_nothing`, `not_owner`, `has_expenses`, `owner_cannot_be_removed`, `owner_cannot_leave`, `not_settled`, `wrong_password`, `owns_shared_space`. `not_settled` and `owns_shared_space` on account deletion also carry `spaces: [{id, name}]`. Show `message` |
| `member_not_found` | 404 | the person to remove is not in this space |
| `already_member`, `space_full` | 409 | adding people: someone is already in (they are listed in `usernames`), or the space would pass 50 people. Nobody is added |
| `internal_error` | 500 | say something went wrong and offer Retry; the body is still JSON |
| `not_authenticated`, `invalid_token` | 401 | show Sign In |
| `token_expired` | 401 | call `/auth/refresh`, then retry |
| `session_expired` | 401 | show Sign In (idle, logged out, or past the 7-day limit) |
| `invalid_refresh_token` | 401 | show Sign In |
| `invalid_credentials` | 401 | wrong username or password (the same message for both) |
| `too_many_attempts` | 429 | wait `retry_after_seconds` (also in the `Retry-After` header): too many failed sign-ins for that username, or too many sign-in attempts from this address |
| `resend_too_soon` | 429 | wait `retry_after_seconds` (30 s after the last text) before "Resend code" or asking again |
| `too_many_requests` | 429 | wait `retry_after_seconds`: too many requests for a number or username, too many texts for one request, any per-address or per-user rate limit (sign-up, search, phone lookups, the live checks, code requests and checks), or the daily code cap |
| `invalid_code` | 400 | "That code is incorrect": clear the boxes. The 5th wrong code is `otp_locked` instead |
| `code_expired` | 400 | "Code expired — resend" |
| `otp_locked` | 429 | "Too many attempts — try again in 10 minutes", wait `retry_after_seconds`. While locked every guess and "Resend code" is refused, the right code included |
| `verification_not_found` | 404 | that sign-up or reset id is unknown, or was already used: start again |
| `verification_expired` | 400 | the sign-up or reset request ran out (30 minutes), or the reset was already verified or finished: start again |
| `reset_session_expired` | 400 | the reset token is unknown, used or too old: start forgot password again |
| `username_taken`, `phone_taken` | 409 | show it on the sign-up form. `already_registered` (409) is the rare case of both being taken in the same instant |
| `unknown_usernames` | 422 | the response lists them in `usernames` |

## Design decisions worth knowing

- **Username is the key.** It is the primary key, goes in the token, and cannot be changed.
- **Search:** friends (people who share a space with you) match from the first letter and come first. Everyone else matches by username from 3 letters. A phone number only matches when it is complete. At most 10 rows, and phone numbers are never returned.
- **Adding people to a space is immediate.** They get a "you were added" card, with no accept step. The tick and cross belong to expense shares.
- **A new space needs at least one other person (specs § 6.2, decision 1.2.7).** Creating one with nobody else, or with only the creator's own username, is a 422 on `usernames`; the app's Create button was already disabled until someone is added. After that a space may shrink to just its owner (everyone else leaves or is removed) and keeps working. It holds at most 50 people.
- **Idle sign-out is 30 minutes (decision 1.1.6).** It was 10; people open the app at the moment of spending, and asking for the password again there was the cost. It is the one setting `SESSION_IDLE_TIMEOUT_MINUTES`, and the app follows the value the server sends (`idle_timeout_seconds`).
- **A deleted account keeps its row** (decision 1.7.1): see *Deleting an account*. `users.phone` is therefore empty for those rows, and `users.deleted_at` is set.
- **Signing out everywhere:** a password reset ends every session of that user and lifts a sign-in lockout.
- **SQLite by default**, with no setup. To use PostgreSQL, install `psycopg[binary]` and set `DATABASE_URL` to `postgresql+psycopg://user:password@localhost:5432/uomi`. Migration `0002` has only been tested on SQLite.
- **Development SMS:** with `SMS_BACKEND=console` the code is printed in the server output (for example `[SMS to +919876543210] Your UOMi code is 482913. ...`). Never run the console backend in production, because it logs every code.
- If you have an older `.env`, set `DEBUG=false` (production refuses `DEBUG=true`).
- **The code text is sent after the reply.** It runs as a background task, and for forgot password only for usernames that exist, so how long a reply takes does not tell anyone which usernames have an account. A failed send is logged, never raised.
- **The daily code cap has a cost.** Whoever uses all of `SMS_DAILY_CAP` blocks sign-ups and password resets for everyone until UTC midnight, so set it well above real daily use, and also set a spend limit at the SMS provider. It counts every text (first sends and resends, sign-up and reset) from the rows made that day, and unfinished sign-ups are kept for a day after they end so the count cannot be reset by letting them expire.
- **`TRUSTED_PROXY_COUNT` is only safe when the API is reachable only through those proxies.** If clients can also connect directly, they can send their own `X-Forwarded-For` and choose the address the per-address limits see.
- **Rate limits are counted in memory** (`app/utils/rate_limit.py`). They are exact inside one API process, start from zero after a restart, and with several processes each one counts alone. Move the counters to PostgreSQL or Redis before running more than one worker. Behind a load balancer set `TRUSTED_PROXY_COUNT`, otherwise every request looks as if it came from the balancer. A blocked attempt is not counted, so hammering a blocked address does not extend its wait.
- **Sign-up creates the account only after the code (specs § 4.3).** `POST /auth/register` keeps a `pending_signups` row (the password only as its bcrypt hash, the code only as an HMAC) and creates no user. An unverified sign-up reserves nothing: the username and phone stay free, and whoever verifies first gets them (the other gets `username_taken` or `phone_taken` at verify). The right code marks the row used (its password hash is wiped) and creates the user and the first session in one transaction. The row is kept for a day, because the daily text cap counts it. Of two parallel requests with the same right code exactly one succeeds, because the row is claimed with one conditional `UPDATE` before anything else.
- **Forgot password is by username (specs § 4.5), and an unknown username looks like a real one.** The reply has the same fields, the same status, the same limits and the same answers to guesses. For a name that does not exist nothing is texted, and the masked number is a made-up one derived from the username under the OTP key, so asking again gives the same number. A real +91 number cannot be told from a made-up one; a real number from another country can (the made-up ones are +91-shaped).
- **Asking again starts a separate request and does not cancel the earlier one.** Anyone can ask for a code for any username, so an earlier request stays valid until it expires, and an open reset session survives. Only the holder of a request's id (`pending_id`, `reset_id`) can resend its code. Finishing a reset closes every other open request and reset session for that user.
- **The rules for a code (specs § 3.4).** Valid 5 minutes (`code_expired` after). The 5th wrong code locks that request for 10 minutes (`otp_locked`); a lock refuses everything, "Resend code" too, and ends by itself. The code lives only 5 minutes, so when the lock ends the code has expired: the person taps "Resend code" and gets a new one. "Resend code" gives the same request a fresh code, 30 seconds after the last text, at most 3 texts per request; the new code starts from zero wrong guesses. Wrong guesses are counted in one `UPDATE ... RETURNING`, so parallel guesses each get their own number.
- **The limits on starting a sign-up or reset hold under a burst of parallel requests.** A request is recorded and committed first and the limits are counted again afterwards, as the sign-in lockout does: the k-th request to be committed sees at least k rows, so only the first few get through, and a refused request takes its own row back out. The price is that two requests at the very same instant for one number can both be refused (the cooldown), and the person simply tries again 30 seconds later. Finished and abandoned sign-ups, and reset requests, are forgotten a day after they ended, never sooner, because the daily text cap counts them.
- **The live checks tell anyone whether a username or number has an account.** That is what the spec asks for, so they are limited per address (the phone check much tighter), and `phone` is redacted from the access log. Sign-up itself answers `phone_taken` / `username_taken` the same way.
- **Input rules (specs § 4.2, § 6.1).** A new username is 3–20 characters, a name 1–50, a password at least 8 with a letter and a number (ASCII), a space name 1–30 and the icon one of `home trip food office friends car party other`. **Older accounts and spaces made under looser rules are left alone**: a username of up to 30 characters still signs in, is found by search and can be added to a space, an old weak password still signs in (only a NEW password is checked), and an old long space name or other icon still displays. Only creating or changing is checked.
- **Phone numbers are checked with libphonenumber** (the `phonenumbers` package, as the app does): a valid mobile number for its country, stored as E.164. A number typed without a country code is read as `DEFAULT_COUNTRY_CODE` (+91). A landline is refused where libphonenumber can tell it from a mobile (India, the UK, the UAE and most countries). In the US and Canada fixed and mobile numbers share ranges, so it cannot tell, and a landline there is accepted: the text simply never arrives. Look-alike digits (Arabic-Indic, fullwidth and other scripts) are refused: only ASCII digits, spaces, dashes, dots and brackets are accepted.
- **Refresh tokens are single use, and a replay ends the session.** The hash of the token a session just swapped out is kept (`previous_token_hash`). If that old token comes back, someone holds a copy, so the whole session is ended and the owner signs in again. The reply is the same `invalid_refresh_token` as for any unknown token. Only the most recently swapped-out token is remembered. A reply lost on a bad connection leaves the app holding the old token, so its retry signs the user out.
- **Sign-in attempts are recorded before the password is checked,** and an attempt that is refused is taken back out, so hammering a locked account does not keep the lockout going.
- **Crashes are JSON and carry the CORS headers.** Responses to requests with a token, and everything under `/auth`, are sent with `Cache-Control: no-store`. `Strict-Transport-Security` is sent in production only.
- **The access log does not hold search terms.** `q`, `phone`, `code` and `token` query values are replaced with `[redacted]` in uvicorn's access lines.
- **Access tokens carry `iss` and `aud`** and are refused without them. Tokens issued before this was added are refused too, so everyone signs in again once.
- **The server works out every share** (`app/services/split_service.py`), with the same integer rounding as the app's `computeSplit`: leftover units go one at a time to people in member-list order, never to someone with a weight of 0. A split is refused when the amounts do not add up, the percentages are not 100, a share count is not a whole number of at least 1, or anyone would owe nothing. The largest amount is 999,999,999 minor units.
- **Expense answers.** The payer's share and the creator's share are accepted at once; everyone else is pending and gets an `expense_share` card with `needs_answer`. You may change your mind: rejecting disputes the expense (it leaves every balance) and tells its creator each time, accepting again lifts the dispute, and repeating the same answer changes nothing. An edit resets every answer, replaces the old cards, keeps the `share_rejected` history, and clears the reminder log. Deleting removes only that expense's `expense_share` and `share_rejected` cards, because `ref_id` is an expense id for those but a payment id for payment cards.
- **The Transactions list is ordered and paged by a marker, not by a page number.** Newest first, by the moment a row takes in the list: a payment's `created_at`, and for an expense the midnight (UTC) that starts its `date`. At exactly the same moment a payment comes before an expense, and then the higher id first. `next_before` is `<microseconds since 1970>.<0 for a payment, 1 for an expense>.<id>` of the last row on the page, so a row added or deleted between two requests cannot shift or repeat a row. It is opaque to the app, and a marker that is not one from this list is a 422 on `before`. Each table is read in its own order, `limit + 1` rows from each after the marker, and merged; the first `limit + 1` of the merge are exactly the next page and one row more (which says whether there is a next page). The list holds only payments the viewer is part of, and only spaces the viewer is still in.
- **Space management follows specs § 10.1.** Any member may rename a space, change its icon and add people (at once, with a "you were added" card and no accept step; nobody is added unless everyone can be). Only the owner may change the currency, and only before the first expense (naming the current currency again is no change, so it is always fine), remove a member, or delete the space. The owner can never leave or be removed, and ownership cannot be handed over. A member is removed, or leaves, only when their balance with everyone in the space is 0 ("Settle up first"). Nothing else blocks it (Appendix B, B.10): a share of theirs that nobody answered, or a payment still waiting for an answer, is left as it is, because the balance already counts the share and nobody is stuck (a payment can still be answered by its receiver or cancelled by its payer, and blocking on an unanswered share would trap someone who has paid everything, since only they can answer it). The space is deleted only when every pair in it is settled up. The other members then get a "space deleted" card (the person who deleted it does not), everything in the space goes with it (the database cascades), and every card about the space stays and still reads, because its `space_id` becomes null and its name was copied onto it. A card that was still asking a question about the space is no longer asking. A person who is not in the space gets the usual 404, not a 403. Creator-only spaces are still allowed (Appendix B, B.8 is a decision that is still open).
- **Changes to a space take the space's lock.** "Everyone is settled up", "no expenses yet" and "fewer than 50 people" are each checked and then acted on, so adding, editing, deleting or answering an expense, recording or confirming a payment, and every space-management call first take the space's row (a write that changes nothing: a row lock on PostgreSQL, the write lock on SQLite). One request at a time can change a space, and a check cannot go stale before it is acted on: a space cannot be deleted while an expense is being saved into it, and a person cannot be removed while an expense that includes them is being saved.
- **A payment can never record more than is owed.** `max_minor` is what the payer owes the receiver minus their payments still waiting for an answer, so one debt cannot be recorded twice. Only confirmed payments change a balance. Recording a payment first takes a lock on the payer's membership row (a write that changes nothing: a row lock on PostgreSQL, the write lock on SQLite) and only then reads what is owed, so two requests at the same moment run one after the other and the second sees the first. Confirm, reject and cancel each claim the payment with one `UPDATE ... WHERE status = 'pending'`: of a confirm and a cancel at the same moment exactly one wins, and only the winner sends a card. Giving the same answer to an expense share twice at the same moment changes nothing the second time, for the same reason.

## Code layout

```
app/
  main.py  config.py  database.py  dependencies.py  currencies.py
  models/     tables (group.py holds Space, expense_split.py holds ExpenseShare, payment.py holds Settlement)
  schemas/    request and response shapes
  routers/    HTTP endpoints, kept thin: auth, users, groups (spaces), expenses, settlements, transactions, notifications
  services/   the logic: auth, otp (texted codes), session, sms, user (search), group, space_access, expense, split, settlement, transaction, balance, notification, reminder
  utils/      security.py, validators.py, errors.py, rate_limit.py, middleware.py, log_redaction.py
migrations/   Alembic: 0001 initial schema, 0002 spec alignment, bdc30b15495a payment reminders, 0003 refresh token reuse, 0004 phone-verified sign-up
scripts/      seed_demo.py, the demo data for the phone app
tests/        in-memory database (a few tests use a temporary SQLite file, to race threads); test_integration_guards.py checks the wiring
```
