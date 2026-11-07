# UOMi

**Settle up without the awkwardness: "you don't owe me and I don't owe you".**

UOMi is a shared-expense app for small groups. Friends, flatmates or a travelling group create a *space*, add expenses and split them four ways. Everyone sees one clear balance per person, and debts are settled through a confirm-the-payment step, so the books always agree.

This repository holds the whole product: the Android app, the FastAPI backend, and the design and specification documents that both were built from.

> **Status: v0.1.0, a test build.** The app is complete in *demo mode*. Against the real backend, sign-in, Home, Create Space, the Space page and Notifications work today. Expenses, settle up and the rest are still being built on the server. See [Project status](#project-status).

**Quick start:** download `UOMi-0.1.0.apk` from the [Releases page](https://github.com/11prem/UOMi/releases), install it on an Android phone, and sign in as `kabir.r` / `demo1234`. No server is needed.

## Contents

- [What it does](#what-it-does)
- [How it is built](#how-it-is-built)
- [Try the app](#try-the-app)
- [Run the backend](#run-the-backend)
- [Develop the app](#develop-the-app)
- [Build the APK](#build-the-apk)
- [Test](#test)
- [Repository layout](#repository-layout)
- [Project status](#project-status)
- [Documentation](#documentation)

## What it does

- **Spaces.** A group of up to 50 people with a name, an icon and a currency. Add people by searching for their username.
- **Four ways to split an expense:** equally, by exact amounts, by percentages, or by shares. Rounding follows one fixed rule, so no paisa is lost or invented.
- **Accept or reject your share.** Each person confirms the share they are asked to pay. An expense with a rejected share is treated as disputed and left out of the balances until it is sorted.
- **Settle up with a confirmation.** One person records a payment, the other confirms or rejects it, and only confirmed payments change a balance.
- **Clear balances.** Each person sees what they owe or are owed per space and overall. Different currencies are never added together, and the wording ("You owe ₹20 · Swetha") never depends on colour alone.
- **Notifications and reminders.** Cards for new shares, payments to confirm, answers and additions, plus automatic payment reminders on days 3, 5, 7 and 10.
- **Phone sign-in.** Username and password, with a texted one-time code to reset a forgotten password and a 10-minute inactivity sign-out.
- **Light and dark themes,** with the Fraunces typeface bundled in the app.

Money is stored as whole minor units (paise, cents) everywhere. There are no floating-point amounts.

## How it is built

| Part | Technology |
|---|---|
| **Mobile app** (`mobile/`) | React Native 0.88 and Expo SDK 58, TypeScript, Expo Router. TanStack Query, Zustand, React Hook Form and Zod. Jest and React Native Testing Library. |
| **Backend** (`app/`) | FastAPI, SQLAlchemy 2, Alembic, Pydantic v2, PyJWT, bcrypt, APScheduler. SQLite by default, PostgreSQL supported. pytest. |
| **Design** | [`DESIGN.md`](DESIGN.md) is the visual system. [`prototype/`](prototype/) is the approved HTML prototype. |

The app has two data modes behind one set of service interfaces, so every screen works in both:

| Mode | What it uses | When |
|---|---|---|
| **Demo** (default) | Built-in sample data stored on the phone. Every screen works, including expenses, settle up and an "Act as…" switch to play any person. | Out of the box. Nothing else is needed. |
| **Server** | The FastAPI backend in [`app/`](app/). | Choose it in the app and enter the backend URL. Features the backend doesn't have yet show "Not available on this server yet". |

Switching modes signs you out and clears cached data, so the two never mix.

## Try the app

### 1. On an Android phone (demo mode)

1. Download `UOMi-0.1.0.apk` from the [Releases page](https://github.com/11prem/UOMi/releases) and copy it to the phone (Android 7.0 or later).
2. Open it and allow "install unknown apps" when asked.
3. Sign in as `kabir.r` with the password `demo1234`.

Other demo users are `swetha.i`, `arun.n`, `meera.s`, `rohan.d` and `priya.m`, all with the same password. The demo one-time code is `123456`. To act as someone else, long-press the **UOMi** wordmark on the Profile tab and choose **Act as…**. The same menu has **Reset demo data**.

The release APK is signed with a debug key, so it can be sideloaded but not uploaded to the Play Store. It includes the debug menu and allows plain-HTTP server URLs, both for testing only.

### 2. Against your own backend (server mode)

1. [Run the backend](#run-the-backend) and seed the demo data.
2. Make the laptop reachable from the phone:
   - **Same Wi-Fi:** use `http://<laptop Wi-Fi IP>:8000`. Find the IP with `ipconfig`. Windows Firewall may ask you to allow Python.
   - **USB:** if the network blocks phone-to-laptop traffic, plug the phone in with USB debugging on, run `adb reverse tcp:8000 tcp:8000`, and use `http://127.0.0.1:8000`.
3. In the app, long-press the **UOMi** wordmark on the Welcome screen, choose **Server**, enter the URL, tap **Test connection**, then **Save**.
4. Sign in as `kabir.r` / `demo1234`. The balances match demo mode exactly, because the seed script creates the same data.

## Run the backend

You need Python 3.10 or newer.

```powershell
py -m venv .venv
.venv\Scripts\Activate.ps1
pip install -r requirements.txt
Copy-Item .env.example .env   # then open .env and set SECRET_KEY
alembic upgrade head
python scripts/seed_demo.py
uvicorn app.main:app --reload
```

On macOS or Linux, use `python3 -m venv .venv`, `source .venv/bin/activate` and `cp .env.example .env`.

- `SECRET_KEY` is required and must be at least 32 characters. Generate one with `python -c "import secrets; print(secrets.token_hex(32))"`. Use a different key for any real deployment. `.env` is never committed.
- To let a phone reach the server, start it with `uvicorn app.main:app --host 0.0.0.0 --port 8000`.
- `python scripts/seed_demo.py` creates 6 people, 5 spaces, 10 expenses, 4 payments and 7 notifications. If `kabir.r` already exists it stops with exit code 1. `--reset` deletes the demo users and **every space they created, including other people's data in those spaces**, then recreates the demo data. The demo passwords are public, so use the seed for development only.
- There is no SMS provider connected. With `SMS_BACKEND=console`, the one-time code is printed in the server output. Never run that setting in production.
- Interactive API docs are at <http://127.0.0.1:8000/docs>.

The full endpoint list, settings, error codes and design decisions are in [`docs/backend-api.md`](docs/backend-api.md).

## Develop the app

```bash
cd mobile
npm install
npm run web          # browser preview at http://localhost:8081 (use a 390x844 phone viewport)
npm test             # unit and screen tests
npx tsc --noEmit     # type check
```

The browser preview can also talk to the backend, because `CORS_ORIGINS` already allows `http://localhost:8081`.

More detail on the app, including the code map, is in [`mobile/README.md`](mobile/README.md).

## Build the APK

On Windows, from the repository root, after committing your changes (the script builds `HEAD`, not your working copy):

```powershell
powershell -ExecutionPolicy Bypass -File mobile\scripts\build-apk.ps1
```

The APK lands in `dist\UOMi-<version>.apk`. The first build takes up to about 45 minutes, and later ones are shorter. You need JDK 17 and the Android SDK. The toolchain setup, why the build runs from a short folder (`C:\u\m`), and signing notes are in [`mobile/README.md`](mobile/README.md#build-the-apk-windows).

## Test

```bash
pytest                         # backend, from the repository root: 127 tests on an in-memory database
cd mobile && npm test          # app: 334 tests in 20 suites
cd mobile && npx tsc --noEmit  # app type check
```

## Repository layout

```
app/          FastAPI backend: models, schemas, routers, services, utils
migrations/   Alembic migrations (0001 initial, 0002 spec alignment, payment reminders)
scripts/      seed_demo.py, the demo data for the phone app
tests/        backend tests
mobile/       the Expo / React Native app
  app/          screens and navigation (Expo Router)
  src/domain/   money, phone, splits, balances: pure TypeScript, fully unit-tested
  src/services/ one interface with demo and server implementations
  src/ui/       the stationery UI kit from DESIGN.md
prototype/    the approved HTML prototype, the visual reference
docs/         build design, plan and the backend reference
specs.md      product specification: every screen, rule and piece of copy
DESIGN.md     visual design system
PRODUCT.md    product brief
```

## Project status

**Done**
- The Android app: every screen in the specification, in light and dark, in demo mode. In server mode, sign-in, Home, Create Space, people search, the Space page and Notifications.
- The backend: accounts and sessions, forgot password by phone code, spaces, people search, notifications, balance rules, and payment reminders.
- A standalone debug-signed APK, built from a reproducible script.

**Still to build**
- **Backend endpoints for:** expenses, settlements, space management (rename, members, leave, delete), transactions, and profile and preferences. Until they exist the app shows "Not available on this server yet" in server mode.
- **Sign-up with phone verification** and **forgot password by username**. Create Account and Forgot password are disabled in server mode until then.
- **Before any public deployment:** rate limits, a real SMS provider with spend caps, refresh-token reuse detection, PostgreSQL testing of migration `0002`, and HTTPS.
- **App:** a real launcher icon, release signing and a Play Store build, testing on real devices, and iOS.

The detailed list, with file references, is in [`BACKEND-DEVIATIONS.md`](BACKEND-DEVIATIONS.md) and [`HANDOVER.md`](HANDOVER.md).

## Documentation

| Document | What it is |
|---|---|
| [`specs.md`](specs.md) | The product specification: screens, rules and copy. |
| [`DESIGN.md`](DESIGN.md) | The visual design system. |
| [`PRODUCT.md`](PRODUCT.md) | The product brief. |
| [`docs/backend-api.md`](docs/backend-api.md) | Backend endpoints, settings, error codes and decisions. |
| [`mobile/README.md`](mobile/README.md) | Running, testing and building the app. |
| [`docs/superpowers/specs/2026-11-06-uomi-mobile-app-design.md`](docs/superpowers/specs/2026-11-06-uomi-mobile-app-design.md) | How the app and its backend wiring were designed. |
| [`docs/superpowers/plans/2026-11-06-uomi-mobile-app.md`](docs/superpowers/plans/2026-11-06-uomi-mobile-app.md) | The build plan and API contract. |
| [`BACKEND-DEVIATIONS.md`](BACKEND-DEVIATIONS.md) | What changed in the backend and what is still open. |
| [`HANDOVER.md`](HANDOVER.md) | What was built, how to check it, and what is needed to ship. |
