# UOMi: handover (2026-11-07)

What was built overnight, how to check it, and what is still needed before UOMi can ship. Read this first. Details live in:

- `mobile/README.md`: running and building the app.
- `BACKEND-DEVIATIONS.md`: backend status for the backend team.
- `docs/superpowers/specs/2026-11-06-uomi-mobile-app-design.md`: the agreed design and decisions.
- `docs/superpowers/plans/2026-11-06-uomi-mobile-app.md`: the build plan and API contract.

## 1. What is done

| Area | State |
|---|---|
| **Android app** (`mobile/`) | Every screen in `specs.md` §§ 4–13 is built from the approved prototype and `DESIGN.md`. Light and dark themes. Five static Fraunces fonts. |
| **Demo mode** | The app works with nothing else installed, on built-in sample data. The whole money loop works on one phone: add expense → accept or reject a share → settle up → confirm, switching people with **Act as…**. |
| **Server mode** | Sign up (with the emailed code), forgot password, sign in, Home, Create Space, people search, the Space page and Notifications run against the real backend. Everything the backend can't do yet shows "Not available on this server yet". |
| **Backend** (`app/`) | Round 1 is aligned with the plan: integer money, currency per space, the spec's balance rules, the notification contract, `GET /users/me`, PR #3's unread-count and mark-all-read, and the review fixes. `scripts/seed_demo.py` adds demo accounts. |
| **APK** | `dist/UOMi-0.1.0.apk` (about 70 MB). It is built by `mobile/scripts/build-apk.ps1` from the committed code. It is signed with the debug key, so you can sideload it but not upload it to the Play Store. |
| **Tests** | Backend `pytest`: 861 tests. App `jest`: 413 tests in 21 suites, and a clean `tsc`. |

How it was checked:

- Every task got its own code review, and the whole change got a final four-part review.
- A browser walk at 390×844 and 320×640, in light and dark mode.
- On an Android 36 emulator, the installed APK was tested in both modes:
  - **Demo mode:** launch, sign in, Home with the correct numbers, the Profile debug menu.
  - **Server mode:** the server URL `http://10.0.2.2:8000`, Test connection, sign in, and Home read from the real API.
- Balances match the plan's seed table exactly, in both modes.

## 2. Git state

- **Branch `mobile-app-round1`:** one commit per reviewed task, authored "Prem B", with no co-author lines. It is pushed to `origin`. `main` was at `8622126`, Pavan's PR #3, when the branch was cut.
- **PR #4** (Abhigidd, reminders and a scheduler) was written against the old backend. It is **merged into `mobile-app-round1` and ported** to the new models (merge commit `ba63a53`).
  - Merge `mobile-app-round1` into `main` with a merge commit or a fast-forward, not a squash, so PR #4's commits stay in history and GitHub marks it as merged.
  - If someone squash-merges PR #4 on GitHub first, you will get conflicts in `app/main.py` and `requirements.txt`. Keep this branch's version, which already contains PR #4.
- **Not committed on purpose:** `.claude/`, `.impeccable/` and `.superpowers/` are local tool folders and are git-ignored.

## 3. How to try it

1. **On a phone:** copy `dist/UOMi-0.1.0.apk` to the phone and install it (allow "install unknown apps"). Sign in as `kabir.r` / `demo1234`. The other demo users are `swetha.i`, `arun.n`, `meera.s`, `rohan.d` and `priya.m`. The demo one-time code is `123456`.
2. **Against the backend:** follow "Connecting a phone to the backend" in `mobile/README.md`, using Wi-Fi with the laptop's IP, or USB with `adb reverse`.
3. **What to check on the phone (not yet tested on real hardware):**
   - Fonts and the stamp look right.
   - The keyboard doesn't cover the save buttons.
   - The Android Back button asks "Discard changes?" on forms.
   - The camera and gallery for the profile photo.
   - The largest system font size.
   - Wi-Fi access to the laptop: Windows Firewall may block it, and USB is the fallback.

## 4. What is still needed to really ship

*Updated 2026-11-17.* The backend now has the features the first handover listed as missing (expenses, settlements, space management, transactions, profile, account deletion and export, push queue). Sign-up with the emailed code and forgot password by username and email are done on the server **and** in the app. What is left is mostly wiring the app to those endpoints, and the things that need a real service (email, Firebase, PostgreSQL).

### App team (server mode)

1. **Expenses:** the six `expenses.*` calls are still the stub `no` in `mobile/src/services/server/index.ts`, and the expense screens (`app/expense/[id]/index.tsx`, `app/expense/[id]/edit.tsx`, `app/space/[id]/expense-new.tsx`) still show "Not available on this server yet". Write the calls, remove the gating, run the tests (task 6.1).
2. **Settle up and members:** the `settlements.*` and `spaces.*` calls are real already, but `app/payment/[id].tsx`, `app/space/[id]/settle.tsx` and `app/space/[id]/members.tsx` are still gated. Remove the gating and test them.
3. **Profile:** `profile.update` and `profile.setPreferences` still use the local fallback in server mode, and `app/profile-edit.tsx` is gated. The server has `PATCH /users/me` (name, default currency, notifications switch).
4. **Add people by phone:** the search box says "Search by username." The server also finds a person by a complete phone number, and the app already forwards what is typed. Change the wording, and decide whether demo mode should match phones too.
5. **Push notifications in the app** (task 6.4): register the device token with `PUT /users/me/devices`. Needs the Firebase project first.
6. **Delete account and export data screens** (task 6.13). The server endpoints exist.
7. **Try sign-up and forgot password on a real screen.** They are covered by jest and by a live check of the services against a running backend, but nobody has tapped through them on a phone or emulator. Also run the § 3 checklist on a real low-end phone, in particular Fraunces legibility at 12–14 pt (`specs.md` § 3.8).
8. **Release:** replace the Expo placeholder launcher icon (`mobile/assets/images/`, `specs.md` § 16.2), create the release keystore and a signed release build (tasks 0.8 and 6.9), raise `versionCode` per build, and turn off cleartext HTTP for production. `PRODUCTION-READINESS.md` plans a direct-APK release, so no Play Store build and no iOS for launch (the code is cross-platform Expo but has never been built for iOS).
9. **Optional:** generate a typed client from `docs/openapi.json` (for example `npx openapi-typescript`) instead of the hand-written `server/index.ts`.
10. **Known small items:** the "Transactions" tab label may shrink on 320 dp phones; lists are not virtualised (fine for demo data, needed for large real spaces); a few kit components are duplicated between feature folders.

### Backend team

1. **Real email.** Codes are only printed in the server log (`EMAIL_BACKEND=console`). Set `EMAIL_BACKEND=smtp` with a real provider, and set a daily sending ceiling and alerts there (task 7.5). Real delivery has never been tried.
2. **Real push.** Create the Firebase project (task 0.6), `pip install google-auth requests`, and run `fcm_sender.py` against the real service: it is tested only against a fake. Run the push worker as its own single process (task 4.4.2).
3. **PostgreSQL.** Migrations `0001` to `0010` and all 861 tests have only run on SQLite.
4. **Add or change a phone or an email on an existing account.** There is no endpoint. Accounts made before migration `0009` have no phone and a placeholder email, so they cannot receive a reset email. The new value must be verified (a code to the new email) before it is saved.
5. **Profile photo** (task 1.6.2): needs object storage (Phase 3).
6. **Transfer a space to another owner.** Today an owner cannot leave, and cannot delete their account while they own a space with other people in it.
7. **Update `specs.md`.** It still describes phone-only sign-up. The decisions are in `BACKEND-DEVIATIONS.md` rows 1, 2 and 10.
8. **Before any public URL:** HTTPS (the app allows plain HTTP only for this test build), and the infrastructure in `PRODUCTION-READINESS.md` (Dockerfile, CI, staging, monitoring).
9. **Known and accepted, so nobody is surprised:**
   - the live username and email availability checks say whether a name is taken, because the spec asks for it (they are rate limited);
   - the forgot-password limit (3 an hour per username) can be used up by anyone, which blocks that username for the hour;
   - the sign-in lockout counts per username, so someone with many addresses can still lock out a username they know.

## 5. Decisions made on your behalf

The full list, each with what it costs if wrong, is under "Rulings I made" in the final report. The ones that matter most:

- Demo and server modes live in one APK, and demo is the default.
- PR #3 and PR #4 were adopted and adapted to the plan.
- The 3-letter people search was kept.
- The debug menu ships in this test APK.
- Plain-HTTP traffic is allowed in this test APK.
- The APK is built from `C:\u\m` with `CMAKE_OBJECT_PATH_MAX=240`, because Windows long paths are off.
