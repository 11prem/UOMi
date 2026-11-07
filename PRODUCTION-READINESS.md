# UOMi: production readiness plan

**For:** the build and deployment team. **From:** the UOMi app and backend team. **Written:** 2026-11-07, against `main` at `e7588e1` and release `v0.1.0`.

This is the complete list of what is left between today's test build and a live production launch of UOMi: a PostgreSQL-backed API, the Android app talking to it, and everything around them (security, infrastructure, delivery, monitoring, legal). Work through it **in order**. Each phase says what it needs from earlier phases.

## 0. How to read this document

### Decisions already made

These came from the product owner on 2026-11-07 and shape every phase below.

| Topic | Decision |
|---|---|
| Hosting | **Cloud-neutral.** The plan names the kind of service needed (managed PostgreSQL, containers, load balancer). The build team picks the provider. |
| Market | **India only** at launch. INR first. Indian SMS rules (DLT registration) and the DPDP Act apply. |
| App distribution | **Direct APK only.** No Play Store and no iOS. A signed APK is hosted on a download page. This means **no automatic updates**, so the app needs its own update check (task 6.10). |
| In scope for launch | Push notifications. The missing backend features (expenses, settlements, space management, transactions, profile). Crash and usage monitoring. Account deletion and data export. |

### Task format

Every task has an ID (`1.3.2`) and a short statement with **Done when** criteria where it helps. Use the IDs in your tracker. Priority tags:

- **[Blocker]**: production cannot launch without it.
- **[Required]**: needed for launch but can run in parallel with other work.
- **[Decide]**: a decision someone with authority has to make before the task can start. All of them are collected in Appendix B.

### What exists today (the starting point)

| Area | State today |
|---|---|
| Android app (`mobile/`) | Every screen built, in light and dark. **Demo mode** is complete. **Server mode** works only for sign-in, Home, Create Space, people search, the Space page and Notifications. Everything else shows "Not available on this server yet". |
| Backend (`app/`) | FastAPI, SQLAlchemy 2, Alembic. Accounts, sessions, forgot password (by phone number), spaces (create and read), people search, notifications, balance rules, and payment reminders. SQLite by default. 127 tests pass. |
| Database | SQLite for development and tests. **Migrations have never run on PostgreSQL.** The head is `bdc30b15495a` (reminders), on top of `0002` and `0001`. |
| Infrastructure | **None.** There is no Dockerfile, no CI, no staging or production environment, no domain, no monitoring. |
| SMS | Console only: the one-time code is printed in the server log. No real provider. |
| Distribution | A debug-signed APK on GitHub Releases (`v0.1.0`, pre-release). A build signed with a different key cannot update it in place. |

Reference documents in this repository:

| File | Use |
|---|---|
| `specs.md` | The product specification: every screen, rule and permission. Section numbers are quoted below as `specs § n`. |
| `docs/backend-api.md` | The current API, settings, error codes and decisions. |
| `BACKEND-DEVIATIONS.md` | What differs between the backend and the spec, and the security review findings. |
| `HANDOVER.md` | What was built and how it was checked. |
| `docs/superpowers/plans/2026-11-06-uomi-mobile-app.md` | The API contract table and the balance rules shared by the app and backend. |
| `mobile/README.md` | Building the app and the APK. |

---

## Phase 0: Decisions, accounts and long-lead items

**Start every task in this phase first, in parallel.** Several have waiting times that nothing else can shorten.

| ID | Task | Why it is first |
|---|---|---|
| 0.1 | **[Decide] Answer every open decision in Appendix B** (owners and dates). | Phases 1, 6 and 8 are blocked by some of them. |
| 0.2 | **[Blocker] Choose the cloud provider and region.** Pick an **India region**. | Data location (task 8.3), latency and SMS rules depend on it. Everything in Phases 3 and 4 follows from it. |
| 0.3 | **[Blocker] Create the cloud account(s) and an organisation structure** with separate staging and production projects or subscriptions, billing alerts and named owners. | No environment can be built without it. |
| 0.4 | **[Blocker] Register for Indian SMS delivery (DLT).** Pick an SMS provider that supports India. Register the business entity on a telecom operator's DLT platform. Register a sender ID (header) and the one-time-code message template. | **This is likely the longest wait of any item (days to weeks).** Without an approved template, Indian carriers drop the texts, so sign-up and password reset fail for real users. |
| 0.5 | **[Required] Buy the domain** and decide the hostnames, for example `api.<domain>` for the API, `<domain>` or `get.<domain>` for the download page, and a status page. Put DNS under the team's control. | TLS certificates and the app's baked-in server URL need it. |
| 0.6 | **[Required] Create the Firebase project** for push notifications (FCM). Register the Android app id `com.uomi.app`. | Needed for tasks 1.8 and 6.4. |
| 0.7 | **[Required] Create the monitoring accounts** (crash reporting such as Sentry, uptime checks, log and metric platform, alert routing to named people). | Needed for Phase 7 and the app's crash reporting. |
| 0.8 | **[Blocker] Generate the release signing keystore and store it safely** (task 6.9). Back it up in two places. **If it is lost, no future build can update an installed app.** | An APK signed with a different key cannot update the installed one. The key must exist before the first production APK. |
| 0.9 | **[Required] Start the legal documents** (privacy policy, terms of use, consent text, grievance contact). See Phase 8. | Legal review takes time and is needed before sign-up screens go live. |
| 0.10 | **[Required] Finalise the brand:** logo, launcher icon, palette. The app has Expo placeholder icons today (`specs § 16.2`). | Task 6.8 needs the files. |
| 0.11 | **[Required] Name the owners:** who owns the API, the database, the mobile build, security sign-off, on-call and support. | Every later phase needs a name against it. |

---

## Phase 1: Finish the backend features

The app already has the screens and the demo implementation of every feature below. The server mode of each is a stub: in `mobile/src/services/server/index.ts` every missing operation is the function `no`, which makes the screen show "Not available on this server yet". **A backend feature is complete when the matching `no` can be replaced with a real HTTP call** (task 6.1).

General rules for every task in this phase:

- Follow the conventions in `docs/backend-api.md`: `snake_case` fields, money as integer `_minor` fields, UTC `Z` timestamps, and the error envelope `{"detail": {"code", "message", ...}}`.
- **Every rule is enforced on the server.** The app checks them for convenience, but a server that trusts the app is not safe.
- Each task needs tests, in the same style as `tests/`.
- Money maths and the rounding rule (`specs § 1`): amounts are integers of the smallest unit. Leftover units go one at a time to the people in the split, in member-list order, so the shares always add up to the total. The reference implementation is `mobile/src/domain/split.ts` and its tests. **The server must give exactly the same answers.**
- Permissions are listed in `specs § 10.1`. Return `403` with a specific error code for a wrong user, never `404`, unless the object should be invisible to that user.

### 1.1 Accounts

| ID | Task | Done when |
|---|---|---|
| 1.1.1 | **[Blocker] Sign-up with phone verification** (`specs § 4.3`). The account must exist **only after** the texted code is accepted. Today `POST /auth/register` creates the account and signs the user in at once. Add a pending sign-up record, a verify step, a resend step (30 s cooldown), and the live checks the app needs: is this username free, is this phone free. | A user cannot sign in with a phone they never verified. A pending sign-up expires. Resend, wrong-code and expiry cases return distinct codes. |
| 1.1.2 | **[Blocker] Forgot password by username** (`specs § 4.5`). The flow is username, then a **masked phone** (`+91 80******31`), then the code, then the new password. Today `POST /auth/forgot` takes a phone number and `/auth/reset` does not return the username. | The masked number follows `specs § 1`. An unknown username must not reveal that it is unknown (same reply either way, see 2.1). |
| 1.1.3 | **[Required] One-time-code messages and timings** (`specs § 3.4`). Separate messages for incorrect, expired and too many attempts. Resend after 30 s. 10-minute lock after too many wrong codes. Today there is a single `invalid_code`, a 60 s cooldown and no lock (`app/config.py` `OTP_*`). | Each case has its own error code. The app maps them to the spec's wording. |
| 1.1.4 | **[Required] Tighten input validation to the spec** (`BACKEND-DEVIATIONS § 2` item 9): username 3–20 characters (server allows 3–30), name 1–50 (allows 100), password at least 8 with a letter and a number (no rule today), space name 1–30 (allows 100), the eight icon keys only (any key allowed today). | A request the app would refuse is refused by the API with a `validation_error`. Decide how to treat any older, looser values (Appendix B, B.9). |
| 1.1.5 | **[Required] Phone validation per country** (`specs § 1, § 4.2`). `validators.normalize_phone` assumes +91 for national numbers and only checks 8–15 digits. Use the same library family as the app (libphonenumber), accept mobile numbers only, and reject non-ASCII digits (`\d` in `app/utils/validators.py` accepts them). | `+91…`, `+1…` and similar numbers validate correctly. Look-alike Unicode digits are rejected. |
| 1.1.6 | **[Decide] Idle sign-out length.** The server signs a user out after 10 minutes without activity. The app is meant to be fast at the moment of spending (Appendix B, B.1). | The chosen value is set in `SESSION_IDLE_TIMEOUT_MINUTES` and the app's timer follows it. |

### 1.2 Space management (`specs § 6, § 10`)

| ID | Task | Done when |
|---|---|---|
| 1.2.1 | **[Blocker] Rename a space and change its icon.** Any member may. Same limits as creating (1.1.4). | A non-member gets 403. |
| 1.2.2 | **[Blocker] Change a space's currency.** Owner only, and **only while the space has no expenses**. | Changing after the first expense returns a specific error the app can explain ("Can't change after expenses are added"). |
| 1.2.3 | **[Blocker] Add people.** Any member. The new person is a member at once and gets a `space_added` notification, with no accept step. The space holds at most 50 people. | Adding an existing member is rejected. The 51st person is rejected. |
| 1.2.4 | **[Blocker] Remove a member.** Owner only, and only when **all** of that member's pairwise balances in the space are zero. | Otherwise return a specific error for "Settle up first". Open payments and unanswered shares are handled (Appendix B, B.10). |
| 1.2.5 | **[Blocker] Leave a space.** Any member **except the owner**, only when all that member's pairwise balances are zero. | The owner gets a specific error. |
| 1.2.6 | **[Blocker] Delete a space.** Owner only, only when everyone is settled up. Every member gets a `space_deleted` notification. Notification rows keep their text because `space_id` becomes null (`SET NULL`). | Deleting removes the expenses, shares and settlements of the space. Members' old notifications still display. |
| 1.2.7 | **[Decide] A space with only its creator.** The spec (`§ 6.2`) requires at least one other member. The backend allows a creator-only space (Appendix B, B.8). | The chosen rule is enforced on the server and in the app. |

### 1.3 Expenses (`specs § 8`)

| ID | Task | Done when |
|---|---|---|
| 1.3.1 | **[Blocker] Create an expense.** Any member. Fields: description 1–50, amount greater than 0 and within the spec's limit (99,99,999.99 for INR, 9,999,999.99 for other currencies), one payer who is a member, split type `equal`, `exact`, `percent` or `shares`, the people in the split (at least one), the date (not in the future). | The server computes every share with the rounding rule and rejects splits that do not add up (`exact` totals, `percent` totalling 100, `shares` at least 1). The payer's own share is `accepted` automatically. Everyone else is `pending`. |
| 1.3.2 | **[Blocker] Expense notifications.** Everyone in the split except the creator gets an `expense_share` notification with `needs_answer = true` and `ref_id` = the expense id. The message follows the example in `specs § 11.2`. | Notifications are created in the same database transaction as the expense. |
| 1.3.3 | **[Blocker] Accept or reject a share.** Only the person whose share it is. Accepting sends no notification. **Rejecting sends `share_rejected` to the expense's creator**, and the expense becomes **disputed** (excluded from balances until fixed). The answer clears `needs_answer` on the original card. | Answering an already-answered share is either rejected or idempotent: decide and test. |
| 1.3.4 | **[Blocker] Edit an expense.** Creator only. Saving an edit **resets every share's answer to pending and notifies everyone in the split again** (`specs § 8.1`). | A disputed expense stops being disputed after the creator's edit. |
| 1.3.5 | **[Blocker] Delete an expense.** Creator only. Balances recalculate. Related notifications for that expense are removed or marked so they no longer ask for an answer. | No orphan "needs answer" cards remain. |
| 1.3.6 | **[Required] Expense detail and the full expense list.** `GET /spaces/{id}` caps expenses at 50 today and does not page settlements (`BACKEND-DEVIATIONS § 4`). Add paging and a detail endpoint for one expense (summary, payer, per-person share and answer). | A space with more than 50 expenses is fully reachable. |
| 1.3.7 | **[Required] Reminders use the new flow.** `app/services/reminder_service.py` already reminds on days 3, 5, 7 and 10 after a share is accepted, if the person still owes. Re-test it against shares created through the API. | The reminder tests pass against data created through the API, not only seeded rows. |

### 1.4 Settlements (`specs § 9`)

A settlement **records** a payment made outside the app. No money moves through UOMi.

| ID | Task | Done when |
|---|---|---|
| 1.4.1 | **[Blocker] Payees list.** For a space, the people the viewer owes, each with the amount owed **minus pending payments to that person**. | Matches the app's `settlements.payees`. |
| 1.4.2 | **[Blocker] Record a payment.** Only the person who owes. Amount is greater than 0 and cannot exceed the payee figure from 1.4.1 (so the same debt cannot be recorded twice). Creates a `pending` settlement and a `payment_to_confirm` notification (`needs_answer = true`, `ref_id` = the settlement id) for the receiver. | A second pending payment cannot push the total above what is owed. |
| 1.4.3 | **[Blocker] Confirm or reject.** Only the receiver, only while pending. The payer gets a `payment_answered` notification. Only **confirmed** payments reduce balances. | Sets `answered_at`. Answering twice is rejected. |
| 1.4.4 | **[Blocker] Cancel.** Only the person who recorded it, only while pending. The receiver's notification disappears. Confirmed payments cannot be cancelled. | Status becomes `cancelled`. |
| 1.4.5 | **[Required] Settlement detail.** One endpoint for the payment screen. | Returns status and `answered_at`. |

### 1.5 Transactions (`specs § 12`)

| ID | Task | Done when |
|---|---|---|
| 1.5.1 | **[Blocker] Transactions list** across all the viewer's spaces. Filters: all, expenses, payments, and one space. Newest first (the app groups by month). Each row carries what the app needs to show the viewer's effect in that space's currency ("you owe", "you lent", "you paid", "you received") and the tags Pending and Disputed. Page it. | No totals are returned (rows can be in different currencies). |

### 1.6 Profile and preferences (`specs § 13`)

| ID | Task | Done when |
|---|---|---|
| 1.6.1 | **[Required] Update the name.** Username and phone are read-only. | 1–50 characters. |
| 1.6.2 | **[Required] Profile photo.** The backend stores no photos today (the app sends `avatarUrl`). Add an upload endpoint (type and size limits, image re-encoding, EXIF removal), store the file in **object storage** (task 4.6.3), and return a URL. Also support removing the photo. | Only image types are accepted. Files are never served from the API server's own disk. |
| 1.6.3 | **[Required] Preferences.** Default currency (used for new spaces) and the notifications on/off switch. Today the app answers these from the device. Store them on the user. The theme stays on the device. | The default currency feeds `POST /spaces` when `currency` is omitted (already the rule). The switch is honoured by 1.8. |

### 1.7 Account deletion and data export (launch requirement)

| ID | Task | Done when |
|---|---|---|
| 1.7.1 | **[Decide] What deleting an account does to shared money records** (Appendix B, B.6). Users are the primary key of many tables and other people's balances depend on them. | The rule is written down. |
| 1.7.2 | **[Required] Delete my account.** Requires the password or a fresh code. Ends all sessions, removes or anonymises personal data (name, phone, photo, device tokens) according to 1.7.1, and keeps other people's ledgers consistent. | A deleted user cannot sign in. Whether the phone number and username can be reused is decided and tested. Spaces they own are handled (Appendix B, B.6). |
| 1.7.3 | **[Required] Export my data.** A machine-readable file with the user's profile, spaces, expenses, shares, payments and notifications. | Limited to data the user is entitled to see. |
| 1.7.4 | **[Required] Retention jobs.** Delete expired `refresh_tokens`, `login_attempts`, `password_resets`, and old notifications on a schedule. Nothing cleans these tables today. | Tables stay bounded. |

### 1.8 Push notifications

Push is **not built** anywhere today (`specs § 0`: the in-app list exists, OS push does not).

| ID | Task | Done when |
|---|---|---|
| 1.8.1 | **[Required] Device registration.** A table for device push tokens (user, token, platform, last seen) with an endpoint to register and remove a token. Tokens are removed on sign-out and on account deletion. | One user can have several devices. |
| 1.8.2 | **[Required] Sender.** When a notification row is created, send a push through FCM using the Firebase project from 0.6. Send the same text as the in-app card, unless product decides to hide amounts on the lock screen (Appendix B, B.7). Handle invalid-token errors by deleting the token. | Honours the user's notifications on/off switch (1.6.3). Failures never block the API request that created the notification. |
| 1.8.3 | **[Required] Delivery runs outside the request.** Use a queue or a background worker so a slow FCM call cannot slow the API (task 4.4.2). | A push outage does not slow or fail normal requests. |
| 1.8.4 | **[Required] Reminders also push.** The daily reminder job uses the same path. | A reminder produces both a card and a push. |

### 1.9 Backend quality gaps (from the code reviews)

| ID | Task |
|---|---|
| 1.9.1 | **[Required]** Add the missing tests listed in `BACKEND-DEVIATIONS § 4`: payer outside the split, a migration downgrade test that checks indexes and foreign keys, and make `tests/test_balances.py` stop comparing dates at assert time (it can fail around midnight UTC). |
| 1.9.2 | **[Required]** Money columns are 32-bit `Integer` in PostgreSQL (up to 2,147,483,647). The spec limit per expense (999,999,999 minor units) fits, but sums and future limits may not. **Change the `amount_minor` columns to `BigInteger`** in a new migration, and reflect it in the models. |
| 1.9.3 | **[Required]** The `--reset` option of `scripts/seed_demo.py` deletes every space a demo user created, even if real users are members. **The seed script must refuse to run against production** (task 4.6.4). |
| 1.9.4 | **[Required]** Refresh the stale docstring in `app/models/expense_split.py` and keep `docs/backend-api.md` in step with every new endpoint. |
| 1.9.5 | **[Required]** Record the final API in the contract table in `docs/superpowers/plans/2026-11-06-uomi-mobile-app.md` or a new API reference, so the app and the backend stay in step. Consider generating a typed client from the OpenAPI schema. |

---

## Phase 2: Security hardening of the API

These come from the three code reviews (plan conformance, FastAPI quality, security). **Every [Blocker] below must be closed before the API has a public address.** Local and internal testing can proceed without them. Details and file references are in `BACKEND-DEVIATIONS § 3`.

| ID | Task | Done when |
|---|---|---|
| 2.1 | **[Blocker] Stop the enumeration oracles.** `/auth/register` answers `phone_taken` and `username_taken` with no throttle, so anyone can discover which numbers are registered. `/users/search` has no rate limit. Fix: verify the phone at sign-up (1.1.1), give one generic registration reply, and rate-limit by IP and by user. The live availability checks (1.1.1) need their own tight limits. | A script cannot list registered numbers. |
| 2.2 | **[Blocker] SMS-pumping protection.** Once a real SMS provider is connected, anonymous sign-up and `/auth/forgot` can be abused to burn the SMS budget. Add per-IP, per-device and global caps, a daily spend ceiling at the provider, and spend alerts (task 7.5). | A flood of requests hits a cap and an alert. |
| 2.3 | **[Blocker] Production defaults.** `SMS_BACKEND=console` logs every code, and `/docs` is public. The app must **refuse to start** in production with the console SMS backend, with `DEBUG=true`, or with a short or default `SECRET_KEY`. Turn off `/docs`, `/redoc` and `/openapi.json` in production. | Starting with unsafe settings exits with a clear error. |
| 2.4 | **[Blocker] Refresh-token reuse detection.** Rotation has no reuse detection, and the swap is select-then-update, so two parallel refreshes can both succeed (`session_service.refresh_session`). Keep the previous hash, end the session when a rotated-out token comes back, and swap atomically with `UPDATE … WHERE token_hash = :old`. | Replaying an old refresh token ends the session. |
| 2.5 | **[Blocker] Login lockout.** It counts per username only, so anyone can lock a victim out, and it records the attempt after the slow password check, so a burst of parallel guesses can get past it on PostgreSQL (`auth_service.login`). Record the attempt **before** verifying, add per-IP throttling, and do not reveal whether the username exists. | Parallel guesses cannot exceed the limit. |
| 2.6 | **[Required] Forgot-password denial of service.** An anonymous `/auth/forgot` cancels the victim's pending code. Do not cancel a valid pending code for a repeat request. | |
| 2.7 | **[Required] Token and crypto hygiene:** pin `HS256`, add `iss` and `aud` claims, use a **separate key for the one-time-code HMAC**, enforce a bcrypt rounds floor of at least 12 outside tests, make the reset-token single-use check atomic. | |
| 2.8 | **[Required] Logs and headers.** Full phone numbers appear in access logs through `/users/search?q=`: keep sensitive values out of the query string or redact them in logs. Add HSTS and `Cache-Control: no-store` on authenticated responses. Make 500 responses carry CORS headers. | |
| 2.9 | **[Required] Dependencies.** Pin every dependency to an exact version with a lock file (`requirements.txt` is open-ended today). `pydantic-settings` must be 2.7 or newer (`NoDecode`). Run a dependency audit (`pip-audit`, `npm audit`) in CI (task 5.4). | |
| 2.10 | **[Required] CORS in production.** `CORS_ORIGINS` defaults to the Expo web dev server. The native app does not use CORS, so set it to the exact web origins you need, or empty. | |
| 2.11 | **[Required] Independent security test.** A penetration test or an independent review of the production deployment, with every high finding fixed before launch (task 9.4). | |

---

## Phase 3: The PostgreSQL database

PostgreSQL is the production database. SQLite is for development and tests only.

| ID | Task | Done when |
|---|---|---|
| 3.1 | **[Blocker] Choose the version and provision a managed PostgreSQL.** Use a currently supported major version, in the **same India region** as the API, with high availability (a standby in another zone), automated daily backups, **point-in-time recovery**, and encryption at rest. Start modest and size from the load test (task 9.3). | A staging and a production instance exist, in separate accounts or projects. |
| 3.2 | **[Blocker] Network and access.** The database has **no public address**. Only the API and worker can reach it, from private networking. TLS is required for connections. Create separate roles: an **owner/migration role** (used only by the deploy step) and a **runtime role** with only the rights the app needs (no `DROP`, no `CREATE`). Store credentials in the secrets manager (task 4.6.1). | The runtime role cannot alter tables. |
| 3.3 | **[Blocker] Driver and connection string.** Add `psycopg[binary]` to `requirements.txt` (it is commented out today) and set `DATABASE_URL=postgresql+psycopg://USER:PASSWORD@HOST:5432/DBNAME`. Require TLS (`sslmode=require` or stricter). | The app starts against PostgreSQL. |
| 3.4 | **[Blocker] Run the migrations on PostgreSQL.** `0001`, `0002` and `bdc30b15495a` have only ever been run on SQLite. Migration `0002` calls `drop_constraint` on a notifications foreign key using SQLite's batch naming, which may fail on PostgreSQL (`BACKEND-DEVIATIONS § 3` item 9). Fix it with explicit constraint names, then run `alembic upgrade head` and a downgrade on an empty PostgreSQL database. | `alembic upgrade head` succeeds on an empty PostgreSQL database, `alembic check` reports no drift, and downgrade works. |
| 3.5 | **[Blocker] Run the whole test suite on PostgreSQL.** The 127 tests use an in-memory SQLite database. Add a PostgreSQL service to CI and run the same tests there (task 5.2). Watch for case-sensitive text comparison (usernames are lower-cased, keep it), timezone handling (the `UTCDateTime` type), aggregate result types, and the atomic OTP counter. | The suite is green on PostgreSQL. |
| 3.6 | **[Required] Money columns to `BigInteger`** (task 1.9.2) as the first new migration on the PostgreSQL baseline. | |
| 3.7 | **[Required] Indexes and constraints review.** Run the real queries with `EXPLAIN` on realistic data. Expect to need indexes for the notification list (user, read, created), expense and share lookups by user and space, settlements by space and users, and transaction history. Add the unique and check constraints the application relies on (one share per user per expense, positive amounts, valid status values). | No sequential scan on a hot query at the expected row counts. |
| 3.8 | **[Required] Connection pooling.** Set the SQLAlchemy pool size and overflow for the number of API workers, and put a pooler (for example PgBouncer or the provider's proxy) in front if the connection count would exceed the database limit. `pool_pre_ping` is already on for non-SQLite URLs. | Peak workers never exceed the database's connection limit. |
| 3.9 | **[Required] Migration procedure.** Migrations run as a **separate release step** with the owner role, before the new app version starts, never at app startup. Make each migration compatible with the previous app version for one release (expand, then contract) so a rollback is safe. Check each migration against a copy of production-shaped data first. | The runbook (task 7.7) states the order and the rollback. |
| 3.10 | **[Required] Backups proven, not assumed.** Restore the latest backup into a fresh instance and check it, and do the same for a point-in-time restore. Repeat on a schedule. Set a recovery point and recovery time target and write them down (task 7.7). | A timed restore drill is on record. |
| 3.11 | **[Required] No demo data in production.** Never run `scripts/seed_demo.py` there (its passwords are public). Production starts empty. | The seed script refuses to run when the environment is `production` (task 4.6.4). |
| 3.12 | **[Required] Maintenance.** Monitor autovacuum, alert on storage growth, enable slow-query logging and plan for major-version upgrades. | Alerts exist (task 7.3). |
| 3.13 | **[Required] Staging database** with production-like volume built from **generated** data. Never copy real user data into staging. | Used by the load test and by migration rehearsals. |

---

## Phase 4: Backend runtime and the other servers

### 4.0 Everything that has to run (infrastructure inventory)

| Component | Purpose | Notes |
|---|---|---|
| **API servers** (at least 2 instances) | Run the FastAPI app behind a load balancer. | Stateless. Scale out by adding instances. |
| **PostgreSQL** (managed, highly available) | The system of record. | Phase 3. |
| **Worker / scheduler** (exactly 1 active) | Runs the daily payment-reminder job, retention jobs and push delivery. | Today the scheduler runs **inside each API process** (APScheduler, the `lifespan` in `app/main.py`). With several instances or workers, **every one runs it**. See 4.4.1. |
| **Redis** (or an equivalent shared store) | Shared rate-limit counters and a queue for push and background work. | Needed as soon as there is more than one API process, because in-process counters are not shared. A PostgreSQL-based limiter is a smaller alternative; the build team decides (B.13). |
| **Load balancer / reverse proxy with TLS** | HTTPS termination, health checks, request size limits, optional web application firewall. | Plain HTTP is allowed in the test APK only (task 6.5). |
| **Object storage + CDN** | Profile photos, and the hosted APK. | Private bucket for photos with signed or proxied access. |
| **SMS provider** | Delivers one-time codes in India. | Task 0.4. |
| **FCM** | Delivers push notifications. | Task 0.6. |
| **Secrets manager** | Holds `SECRET_KEY`, database credentials, provider keys. | Never in the image, the repository or plain environment files. |
| **Container registry** | Stores built images. | Task 4.1.1. |
| **CI/CD runners** | Test, build and deploy. | Phase 5. |
| **Monitoring and logging stack** | Metrics, logs, traces, uptime checks, alerts, crash reports. | Phase 7. |
| **Staging environment** | A smaller copy of everything above. | Used for every release before production. |
| **Static download site** | Hosts the APK, release notes, checksum and the privacy policy. | Task 6.11. |

### 4.1 Build and run

| ID | Task | Done when |
|---|---|---|
| 4.1.1 | **[Blocker] Containerise the API.** A `Dockerfile` (small base image, non-root user, no dev dependencies, pinned dependencies) and a `.dockerignore`. Run it with an ASGI process manager (for example Gunicorn with Uvicorn workers) with a worker count based on CPU. | The image builds in CI and starts from environment variables alone. |
| 4.1.2 | **[Blocker] Health and readiness.** `/health` returns `ok` today and does not check anything. Add a readiness check that verifies the database connection, and keep a cheap liveness check. The load balancer uses readiness. | An instance with no database is taken out of rotation. |
| 4.1.3 | **[Required] Graceful shutdown and timeouts.** Finish in-flight requests on deploy, set request and keep-alive timeouts, set a maximum request body size. | |
| 4.1.4 | **[Required] Trusted proxy handling.** Behind the load balancer, read the real client address from forwarded headers only from the trusted proxy. Rate limiting and logs depend on it. | |

### 4.2 Configuration and secrets

| ID | Task | Done when |
|---|---|---|
| 4.2.1 | **[Blocker] Production configuration reference.** See Appendix C. Every value comes from the environment or the secrets manager. | No secret appears in an image, a log or the repository. |
| 4.2.2 | **[Blocker] `SECRET_KEY`** is at least 32 random characters, unique per environment, rotated on a schedule, and the rotation procedure is written down (rotating invalidates sessions). | |
| 4.2.3 | **[Required] Fail fast.** The settings loader rejects missing or unsafe values at startup (task 2.3). | |

### 4.4 Scheduling, queues and workers

| ID | Task | Done when |
|---|---|---|
| 4.4.1 | **[Blocker] Run the reminder job once, not once per process.** Set `REMINDERS_ENABLED=false` on the API instances and run the job from **one** worker or from a scheduled job in the platform, or guard it with a database advisory lock. `process_due_reminders` records a `Reminder` row per share and day so it does not repeat, but concurrent runs can race. | Two instances never both send a reminder. |
| 4.4.2 | **[Required] Background worker** for push delivery (1.8) and the retention jobs (1.7.4), with retries and a record of failures. | |
| 4.4.3 | **[Required] Job monitoring.** Alert when a scheduled job did not run or keeps failing (task 7.3). | |

### 4.5 Real SMS

| ID | Task | Done when |
|---|---|---|
| 4.5.1 | **[Blocker] Implement the SMS provider** behind `app/services/sms_service.py`. Only the `console` backend exists. Add the provider branch, a timeout, retries with a cap, and a delivery-failure path the app can show ("we couldn't send the code"). Use the DLT-approved template and sender ID from 0.4. | A real phone receives the code within seconds. |
| 4.5.2 | **[Required] Delivery tracking.** Record provider message ids and delivery receipts. Alert on a falling delivery rate (task 7.3). | |
| 4.5.3 | **[Required] Cost control.** A daily spend limit at the provider, per-user and per-IP limits in the API (task 2.2), and an alert at a fraction of the budget. | |

### 4.6 Secrets, storage, domain and TLS

| ID | Task | Done when |
|---|---|---|
| 4.6.1 | **[Blocker] Secrets manager** wired to the runtime, with separate secrets per environment. | |
| 4.6.2 | **[Blocker] Domain, DNS and TLS certificates** for the API and the download site, with automatic renewal and an expiry alert. Redirect HTTP to HTTPS. Allow modern TLS only. | |
| 4.6.3 | **[Required] Object storage** with a private bucket for photos, encryption at rest, lifecycle rules, and an upload path validated by 1.6.2. | |
| 4.6.4 | **[Required] Environment guard.** Add an explicit `ENVIRONMENT` setting (`development`, `staging`, `production`). The seed script and any destructive tool check it (tasks 1.9.3 and 3.11). | |

### 4.7 Logging and privacy in logs

| ID | Task |
|---|---|
| 4.7.1 | **[Required]** Structured JSON logs with a request id, user id (never the phone number or token), route, status and duration. |
| 4.7.2 | **[Required]** Never log passwords, tokens, one-time codes or full phone numbers. The console SMS log line must not exist in production (task 2.3). Mask phone numbers to the form in `specs § 1`. |
| 4.7.3 | **[Required]** Ship logs to the central platform with a retention period that matches the privacy policy (Phase 8). |

---

## Phase 5: Environments and CI/CD

There is **no CI and no pipeline today**. Everything is built and tested by hand.

| ID | Task | Done when |
|---|---|---|
| 5.1 | **[Blocker] Environments:** `development` (local), `staging` and `production`, with separate databases, secrets, SMS sender, FCM project and domains. Staging must mirror production's shape. | A change reaches production only after staging. |
| 5.2 | **[Blocker] CI pipeline** on every pull request: install, `pytest` against a PostgreSQL service (3.5), `alembic upgrade head` plus `alembic check`, app `npm ci`, `npx tsc --noEmit`, `npx jest`, and a build of the container image. Block merging on any failure. | The branch protection rule on `main` requires the pipeline. |
| 5.3 | **[Blocker] CD pipeline:** build the image once, tag it with the commit, deploy to staging automatically, deploy to production by approval. Order: migrate, then roll out, then smoke test. **Rolling back** is one command and has been tested (task 7.7). | A deploy and a rollback have both been done end to end on staging. |
| 5.4 | **[Required] Automated security checks:** secret scanning, dependency audit (`pip-audit`, `npm audit`), static analysis (for example Semgrep or CodeQL), and container image scanning. | New high findings fail the build. |
| 5.5 | **[Required] Dependency updates.** An automated tool (for example Dependabot) opens update pull requests. Lock files are committed for both the backend and the app. | |
| 5.6 | **[Required] Repository hygiene.** Branch protection on `main` (reviews required, no force pushes), CODEOWNERS, an issue and pull request template, and a `LICENSE` decision (there is none today, B.12). | |
| 5.7 | **[Required] Versioning and release process.** Semantic versions, a changelog, tagged releases, and a checklist per release (Phase 10). | |
| 5.8 | **[Required] The mobile build in CI.** The APK is built today on a Windows laptop with `mobile/scripts/build-apk.ps1` because of Windows path limits. Production APKs must come from a **clean, reproducible CI build** (a Linux runner has no path-length problem) using the release keystore from the secrets manager, never from a developer machine. | A tagged commit produces a signed APK and its SHA-256 checksum as build artifacts. |

---

## Phase 6: The mobile app for production

All paths are under `mobile/`. The app is React Native 0.88 on Expo SDK 58.

### 6.1 Turn on server mode for every feature

| ID | Task | Done when |
|---|---|---|
| 6.1 | **[Blocker] Replace each `no` in `src/services/server/index.ts`** with the real call as the matching backend task lands: `spaces.update`, `addMembers`, `removeMember`, `leave`, `remove`; `expenses.get/create/update/remove/acceptShare/rejectShare`; `settlements.get/payees/create/confirm/reject/cancel`; `transactions.list`; `profile.update` and `setPreferences`. Add the mappers in `server/mappers.ts` and tests in `src/services/__tests__/server.test.ts`. The screens already handle both modes. | No "Not available on this server yet" panel appears in server mode. |
| 6.2 | **[Blocker] Enable Create Account and Forgot password in server mode** once 1.1.1 and 1.1.2 exist. Today those screens are disabled with the same panel. | The full sign-up and reset flow works against the staging API. |
| 6.3 | **[Required] Match the server's error codes** to the spec's wording (task 1.1.3) and handle the new codes from Phase 1. | |

### 6.2 Make the build production-shaped

| ID | Task | Done when |
|---|---|---|
| 6.4 | **[Required] Push notifications in the app.** Add `expo-notifications` and the Firebase config (`google-services.json` from 0.6), ask permission at a sensible moment, register the device token with the API (1.8.1), unregister on sign-out, and open the right screen when a push is tapped (the expense, the payment, the space, or Settle Up for a reminder, as in `specs § 11.1`). Respect the on/off switch in Profile. | A push arrives on a real phone with the app closed, and tapping it opens the correct screen. Test on at least one phone with aggressive battery management. |
| 6.5 | **[Blocker] HTTPS only.** The test APK sets `usesCleartextTraffic: true` (in `app.json`, through `expo-build-properties`) so it can talk to `http://` laptops. **Production must set it to false** and the server URL must be `https://`. Decide on certificate pinning (B.14). | The release APK cannot make plain-HTTP requests. |
| 6.6 | **[Blocker] Bake in the production server URL** and make server mode the default. Today the app starts in demo mode with an empty server URL entered by hand (`src/state/session.ts`). Production behaviour: server mode on, the URL fixed at build time through a build-time setting, no server picker for normal users. | A fresh install connects to production without any setup. |
| 6.7 | **[Blocker] Remove demo mode and the debug menu from the production build.** The spec says the debug menu is "left out of production builds" (`specs § 14.1`), but the test APK ships it (long-press on the wordmark). The "Act as…" switch lets a person view any seeded user, which must never exist in production. Gate demo mode, the debug menu and the server switch behind a build flag that is **off** in the production build, and add a test that fails if they are present. | The production APK has no demo data, no debug menu and no server switch. |
| 6.8 | **[Required] Brand assets.** Replace the Expo placeholder launcher icon, adaptive icon (foreground, background, monochrome), splash screen and the text wordmark with the final brand (`specs § 3.7, § 16.2`). Confirm the palette against the contrast rules in light and dark. Files live in `mobile/assets/images/` and `app.json`. | The launcher icon and splash are the real brand. |
| 6.9 | **[Blocker] Release signing.** Create a release keystore (task 0.8) and a signed release configuration. The test APK is signed with the template's debug key, which is public. Plan `versionCode` (it must rise with every build; it is `1` today) and `versionName`. Keep the keystore and its passwords in the secrets manager and in an offline backup. | The production APK is signed with the release key, and `apksigner verify` passes. |
| 6.10 | **[Blocker] In-app update check.** With direct APK distribution there is no store to push updates. Add a version endpoint on the API (latest version, minimum supported version, download URL, checksum) and have the app check at launch. A **forced upgrade** screen blocks versions below the minimum, and a **soft prompt** offers newer ones. The API can also refuse a too-old app with a specific error code. | An old app is told to update, and the download link opens the current APK. |
| 6.11 | **[Required] Hosting and delivery of the APK.** A download page over HTTPS with the current APK, its SHA-256 checksum, install steps ("allow install from this source"), a note on the Play Protect warning that Android may show for apps installed outside the store, release notes, and the privacy policy link. Keep older builds available for rollback. | A person with no technical help can install from the page. |
| 6.12 | **[Required] Crash and usage reporting.** Add crash reporting (for example Sentry for React Native) with source maps uploaded from CI, release tagging, and user identifiers that carry no personal data. Decide what product analytics, if any, are collected (B.11) and say so in the privacy policy (Phase 8). | A deliberate test crash appears in the dashboard with a readable stack trace. |
| 6.13 | **[Required] Account deletion and data export screens** in Profile, using 1.7. Confirmation dialogs and clear wording about what happens to shared records (task 1.7.1). | |
| 6.14 | **[Required] Profile photo upload** to the new endpoint (1.6.2) with camera and gallery, size reduction on the device and a remove option. | |
| 6.15 | **[Required] Consent and legal screens.** A consent notice at sign-up with links to the privacy policy and terms (Phase 8). Show the policy inside the app too. | |
| 6.16 | **[Decide] Idle timer.** The app follows the server's idle limit minus a 30-second margin (`src/state/idle.ts`). Change it together with 1.1.6. | |

### 6.3 Quality work still open in the app

| ID | Task |
|---|---|
| 6.17 | **[Blocker] Real-device QA** on at least a low-end and a recent Android phone, on Android 7 (the minimum, `minSdkVersion 24`) through the newest version. Nothing has run on real hardware by the build tooling. Check: fonts and the stamp render correctly, **Fraunces is legible at 12–14 pt** (`specs § 3.8`), the keyboard never covers the save buttons, the Android **Back button** asks "Discard changes?" on forms, camera and gallery for the profile photo, the **largest system font size**, light and dark, portrait lock, and one-time-code autofill from SMS. |
| 6.18 | **[Required] Performance on big data.** Lists are not virtualised in several screens, which is fine for demo data but not for a space with hundreds of expenses. Use `FlatList` or similar with paging wired to the new paged endpoints (1.3.6, 1.5.1). Check startup time and memory on a low-end phone. |
| 6.19 | **[Required] Offline and bad networks.** Verify the Offline banner, retry behaviour, timeouts and what the user sees when the server is down, slow or returns 5xx. Make sure money actions (add expense, record payment) cannot be submitted twice. |
| 6.20 | **[Required] Accessibility pass** against `specs § 3.6`: screen-reader labels, touch targets, contrast, never colour alone for owe or owed. |
| 6.21 | **[Required] Small known items:** the "Transactions" tab label may shrink on 320 dp phones, and a few kit components are duplicated between feature folders. |
| 6.22 | **[Required] Permissions review.** The app asks for camera and gallery (profile photo) and, after 6.4, notifications. Request each at the moment of use, with a clear reason, and nothing else. |
| 6.23 | **[Required] Upgrade path testing.** Install version N, then N+1 over it: stored data, session tokens (in secure storage) and settings survive. Test the forced-upgrade screen (6.10). |

> **Out of scope:** iOS and the Play Store. The code is cross-platform Expo and has never been built for iOS, and the product owner chose direct APK only. Revisit if that changes.

---

## Phase 7: Observability, operations and resilience

| ID | Task | Done when |
|---|---|---|
| 7.1 | **[Blocker] Metrics and dashboards:** request rate, error rate, latency per route, API instance CPU and memory, database connections, query time, storage and replication lag, worker queue depth and age. | One dashboard per component. |
| 7.2 | **[Blocker] Uptime checks and a public status page.** An external probe hits the readiness endpoint (4.1.2) and a real sign-in path. | |
| 7.3 | **[Blocker] Alerts routed to named people:** high error rate, slow responses, unhealthy instances, database nearly out of connections or storage, replication broken, failed backup, failed scheduled job, certificate expiring, SMS delivery rate falling, push failure spike, spend over budget. Each alert links to a runbook. | |
| 7.4 | **[Required] Central logs** searchable by request id (task 4.7). | |
| 7.5 | **[Required] Cost and quota monitoring** for the cloud account, SMS spend and FCM limits, with budgets and alerts. | |
| 7.6 | **[Required] Crash dashboards** for the app (6.12) and the API (an error tracker with release tags). | |
| 7.7 | **[Blocker] Runbooks:** deploy, rollback, migration, restore from backup, rotate `SECRET_KEY` and other secrets, SMS provider outage, FCM outage, database failover, "the app shows an error everywhere", and a leaked-secret procedure. Write down the recovery point and recovery time targets. | Each runbook has been practised once. |
| 7.8 | **[Required] On-call rota and escalation path**, with who is called for what and how users reach support. | |
| 7.9 | **[Required] Disaster recovery.** Decide what happens if the region fails (restore from cross-region backups into another region, and how long that takes), and test it once. | |
| 7.10 | **[Required] Capacity plan.** Document expected users and requests, the headroom at launch, and the point at which each component is scaled. | |

---

## Phase 8: Legal, privacy and compliance (India)

UOMi stores names, phone numbers, photos and who owes whom. Treat all of it as personal data. **Have a lawyer review this phase.** The points below are engineering inputs, not legal advice.

| ID | Task | Done when |
|---|---|---|
| 8.1 | **[Blocker] Privacy policy and terms of use** covering what is collected (name, phone, username, photo, spaces, expenses, payments, device tokens, crash data), why, who sees it (other members of a space see names and balances), how long it is kept, where it is stored, who the processors are (cloud, SMS, FCM, crash reporting), user rights, and the grievance contact. Link them in the app (6.15) and on the download page. | |
| 8.2 | **[Blocker] Consent at sign-up** with a record of what was accepted and when (store the policy version and the time per user). | |
| 8.3 | **[Required] Data location.** Host the database, backups and photos in an **India region** unless counsel advises otherwise. Check every processor's data location (SMS, crash reporting, FCM metadata). | |
| 8.4 | **[Required] Rights handling.** A process to answer access, correction and deletion requests inside the legal time, using 1.7. A named grievance officer and a contact address. | |
| 8.5 | **[Required] Retention schedule** for every table and log (tasks 1.7.4 and 4.7.3). Delete what is not needed. | |
| 8.6 | **[Required] Protect personal data:** encryption in transit and at rest, access to production data limited and logged, no real data in staging, and phone numbers masked in logs and in the UI where the spec requires it. | |
| 8.7 | **[Required] Breach response plan:** who decides, who is told (users and the regulator within the required time), and how evidence is kept. | |
| 8.8 | **[Required] SMS compliance.** Keep proof of the entity, sender and template registration (0.4), and send only the registered template. Follow the opt-out and do-not-disturb rules your provider requires. | |
| 8.9 | **[Required] Money wording.** UOMi only **records** payments made outside the app and moves no money (`specs § 0`). Say so plainly in the terms, and do not describe it as a payment service. | |
| 8.10 | **[Required] Open-source licences.** Produce the list of third-party licences for the app (including Fraunces, under the SIL Open Font License, shipped as `mobile/assets/fonts/OFL.txt`) and show the notices in the app. Decide the licence for this repository (5.6). | |

---

## Phase 9: Verification before launch

| ID | Task | Done when |
|---|---|---|
| 9.1 | **[Blocker] Full end-to-end test on staging** with real phones and the real SMS and push providers: sign up with a real code, create a space, add people, add an expense of every split type, accept and reject shares, record and confirm a payment, check every balance on every screen, receive pushes, reset a password, delete an account. The whole **money loop** must work for several real people on several phones. | |
| 9.2 | **[Blocker] The anti-goals from `specs § 0`:** a balance never disagrees between two screens, rounding never loses or invents a paisa, currencies are never added together, colour is never the only owe/owed signal. Test each on staging data. | |
| 9.3 | **[Blocker] Load and soak test** on staging with generated data: the expected launch load plus a margin, with the reminder job and push worker running. Record the results and fix what they show. | |
| 9.4 | **[Blocker] Security test** (task 2.11) and a re-test of every finding. Re-run the Phase 2 abuse cases (enumeration, SMS flood, token reuse, lockout) against the production-like environment. | |
| 9.5 | **[Blocker] Migration rehearsal.** Take a production-sized staging database through the exact deploy and rollback procedure. | |
| 9.6 | **[Blocker] Backup restore drill** (3.10) and **failover drill** (3.1) on staging. | |
| 9.7 | **[Required] SMS delivery test across Indian carriers and device types**, including a number on do-not-disturb, and the failure screens when delivery fails. | |
| 9.8 | **[Required] Device and Android-version matrix** for the app (6.17), including push on phones with aggressive battery savers. | |
| 9.9 | **[Required] User acceptance test** with a small group of real users, with a way to collect their problems. | |
| 9.10 | **[Required] Content edge cases:** large fonts, screen reader, long names, names with non-Latin characters, long descriptions, and the other seven currencies (`INR, USD, EUR, GBP, AED, SGD, AUD, CAD`). | |
| 9.11 | **[Required] Time and date edge cases:** midnight UTC, members in other time zones, future-date rejection, and the date shown to each user in their own zone. | |

---

## Phase 10: Launch and after

| ID | Task |
|---|---|
| 10.1 | **[Blocker] Go-live checklist** signed by the owners from 0.11: every [Blocker] above is closed, staging is green, backups are verified, alerts are live, runbooks are practised, legal documents are published, and the rollback is ready. |
| 10.2 | **[Required] Staged rollout.** Start with an invite-only group, watch the dashboards for a set period, then widen (B.15). The in-app update check (6.10) lets you stop old versions if a serious bug appears. |
| 10.3 | **[Required] Launch-day roster:** who watches the dashboards, who answers support, who can decide to roll back. |
| 10.4 | **[Required] Production smoke test** right after each deploy (sign in, load Home, create a space, read notifications). |
| 10.5 | **[Required] Support channel and a known-issues page**, and a way for users to report problems from inside the app. |
| 10.6 | **[Required] First-week review:** error rate, crash rate, SMS delivery, push delivery, cost, support tickets, and a list of fixes. |
| 10.7 | **[Required] Regular chores:** rotate secrets, patch the base image and dependencies, review access, test a restore every quarter. |

### After launch: out of scope for this plan

These are deliberate non-goals in `specs § 0` and `§ 13.1`. Do not start them until the launch is stable.

- iOS, the App Store and the Play Store (if distribution changes).
- Real payments such as UPI or cards. Settle Up only records payments.
- Currency conversion, receipt photos and attachments, expense comments, recurring expenses.
- Inviting people who are not yet UOMi users.
- Transferring space ownership, change-password inside the app, "simplify debts" rerouting, and tablet or landscape layouts.

---

## Appendix A: critical path and long-lead items

Do these first; everything else waits on them.

1. **Day 0:** decisions (0.1), cloud account (0.3), SMS and DLT registration (0.4), Firebase (0.6), keystore (0.8), legal drafts (0.9), brand (0.10).
2. **Backend features (Phase 1)** and **PostgreSQL (Phase 3)** can run **in parallel** by two people. Migrations on PostgreSQL (3.4) and the CI pipeline (5.2) should be done in the first days, because every other task depends on a green pipeline on PostgreSQL.
3. **Security (Phase 2)** runs alongside Phase 1 and **must finish before any public URL exists.**
4. **Infrastructure (Phases 4 and 5)** gets built once for staging, then copied for production.
5. **The app (Phase 6)** tracks the backend: each endpoint that lands is wired the same day (6.1).
6. **Verification (Phase 9)** starts when staging has every feature, then launch (Phase 10).

## Appendix B: open decisions that need an owner

| # | Decision | Where it matters | Today's behaviour |
|---|---|---|---|
| B.1 | Is a **10-minute idle sign-out** right for an app people open "at the moment of spending"? | 1.1.6, 6.16 | 10 minutes on the server, 9.5 in the app. |
| B.2 | Which **SMS provider** and which **message template wording**. | 0.4, 4.5 | None. Console only. |
| B.3 | Which **cloud provider and region**. | 0.2 | None. |
| B.4 | **Cross-currency "overall" banner**: the Home banner shows one net figure per currency, never summed. Keep? | `specs § 5.1` | Yes, per currency. |
| B.5 | **People search privacy.** Friends match from the first letter, everyone else needs 3 letters, and phone numbers only match when complete. The spec says search by username prefix from the first letter. Keep the stricter rule? | `user_service.search_users` | Stricter than the spec, on purpose. |
| B.6 | **Account deletion semantics.** What happens to a user's past expenses, shares and payments in other people's spaces, and to spaces they own? Options: anonymise the person ("Deleted user") and keep the ledger, or block deletion until settled up. Can the username and phone number be reused? | 1.7 | Not built. |
| B.7 | **Push content on the lock screen.** Show amounts and names, or only "You have a new request"? | 1.8.2 | Not built. |
| B.8 | **A space with only its creator.** The spec requires at least one other member. The backend allows none. | 1.2.7 | Allowed on the server. |
| B.9 | **Tighter validation and existing users.** Will users created under looser rules (long usernames, weak passwords) be grandfathered? | 1.1.4 | No real users yet. Decide before launch to avoid a migration later. |
| B.10 | **Removing a member who has an unanswered share or a pending payment.** Block, or resolve automatically? | 1.2.4 | Not built. |
| B.11 | **Analytics.** Which usage events, if any, are collected, and is consent needed? | 6.12, 8.1 | None collected. |
| B.12 | **Repository licence.** | 5.6, 8.10 | None. |
| B.13 | **Redis versus a PostgreSQL-backed rate limiter** and queue. | 4.0 | Neither exists. |
| B.14 | **Certificate pinning in the app.** Worth the lock-out risk? | 6.5 | Not used. |
| B.15 | **Launch size and invite policy.** Invite-only first? How many users at the start? | 9.3, 10.2 | Unknown. |

## Appendix C: production configuration reference

Every setting is read by `app/config.py` from the environment (or `.env` in development). Defaults are in `.env.example`.

| Setting | Production value |
|---|---|
| `APP_NAME` | `UOMi` |
| `DEBUG` | **`false`** (a `true` value returns a traceback page instead of the JSON error the app expects) |
| `DATABASE_URL` | `postgresql+psycopg://USER:PASSWORD@HOST:5432/DBNAME` with TLS required, from the secrets manager, runtime role |
| `CORS_ORIGINS` | Exact web origins, or empty. The default is the Expo dev server. |
| `SECRET_KEY` | **Required**, at least 32 random characters, unique per environment, from the secrets manager |
| `ACCESS_TOKEN_EXPIRE_MINUTES` | `15` |
| `REFRESH_TOKEN_EXPIRE_DAYS` | `7` |
| `SESSION_IDLE_TIMEOUT_MINUTES` | `10`, pending B.1 |
| `LOGIN_MAX_ATTEMPTS`, `LOGIN_LOCKOUT_MINUTES` | `5`, `15`, pending 2.5 |
| `OTP_TTL_MINUTES`, `OTP_MAX_ATTEMPTS`, `OTP_MAX_REQUESTS_PER_HOUR`, `OTP_RESEND_COOLDOWN_SECONDS` | `5`, `5`, `3`, `60`. The spec wants resend after 30 s and a 10-minute lock (1.1.3). |
| `RESET_SESSION_TIMEOUT_MINUTES` | `10` |
| `BCRYPT_ROUNDS` | `12` or higher |
| `DEFAULT_COUNTRY_CODE`, `DEFAULT_CURRENCY` | `+91`, `INR` |
| `SMS_BACKEND` | **A real provider.** `console` must make the app refuse to start in production (2.3). |
| `REMINDERS_ENABLED` | `false` on API instances, `true` only on the single worker (4.4.1) |

New settings the work above will add (names are suggestions): `ENVIRONMENT`, the SMS provider's key and sender, FCM credentials, the object-storage bucket and keys, the Redis URL, the app's minimum and latest versions with the APK URL and checksum, the crash-reporting DSN, and the policy version for consent records.

## Appendix D: backend endpoint backlog

The shapes are the build team's call, within the conventions in `docs/backend-api.md`. The app needs these operations (names are from `mobile/src/services/types.ts`).

| Area | Operations the app needs | Backend task |
|---|---|---|
| Auth | `signUp`, `verifySignUpOtp`, `resendOtp`, `checkUsername`, `checkPhone`, `requestResetOtp(username)` returning the masked phone, `verifyResetOtp`, `resetPassword` | 1.1.1 to 1.1.3 |
| Spaces | `update` (name, icon, currency), `addMembers`, `removeMember`, `leave`, `delete` | 1.2 |
| Expenses | `get`, `create`, `update`, `remove`, `acceptShare`, `rejectShare` (and a paged list) | 1.3 |
| Settlements | `payees`, `create`, `get`, `confirm`, `reject`, `cancel` | 1.4 |
| Transactions | `list(filter)` | 1.5 |
| Profile | `update` (name, photo), `getPreferences`, `setPreferences` | 1.6 |
| Account | delete account, export data | 1.7 |
| Devices | register and remove a push token | 1.8 |
| Meta | latest and minimum app version, readiness check | 6.10, 4.1.2 |

Exists today and should be kept: `POST /auth/login`, `/auth/refresh`, `/auth/logout`; `GET /users/me`, `GET /users/search`; `GET /spaces`, `POST /spaces`, `GET /spaces/{id}`; `GET /notifications`, `GET /notifications/unread-count`, `PATCH /notifications/{id}`, `PATCH /notifications/read-all`; `GET /health`.

## Appendix E: summary checklist by phase

Tick a phase only when every [Blocker] and [Required] task in it is done.

- [ ] **Phase 0:** decisions, accounts and long-lead items
- [ ] **Phase 1:** backend features (accounts, spaces, expenses, settlements, transactions, profile, deletion and export, push, quality)
- [ ] **Phase 2:** security hardening
- [ ] **Phase 3:** PostgreSQL database
- [ ] **Phase 4:** runtime and the other servers
- [ ] **Phase 5:** environments and CI/CD
- [ ] **Phase 6:** the mobile app for production
- [ ] **Phase 7:** observability and operations
- [ ] **Phase 8:** legal, privacy and compliance
- [ ] **Phase 9:** verification
- [ ] **Phase 10:** launch
