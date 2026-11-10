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
| **Server mode** | Sign in, Home, Create Space, people search, the Space page and Notifications run against the real backend. Everything the backend can't do yet shows "Not available on this server yet". |
| **Backend** (`app/`) | Round 1 is aligned with the plan: integer money, currency per space, the spec's balance rules, the notification contract, `GET /users/me`, PR #3's unread-count and mark-all-read, and the review fixes. `scripts/seed_demo.py` adds demo accounts. |
| **APK** | `dist/UOMi-0.1.0.apk` (about 70 MB). It is built by `mobile/scripts/build-apk.ps1` from the committed code. It is signed with the debug key, so you can sideload it but not upload it to the Play Store. |
| **Tests** | Backend `pytest`: 127 tests. App `jest`: 334 tests in 20 suites, and a clean `tsc`. |

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

### Backend team (details and file references in `BACKEND-DEVIATIONS.md` § 2–3)

1. Expense endpoints: create, edit, delete, accept and reject a share, plus their notifications.
2. Settlement endpoints: record, confirm, reject and cancel, plus their notifications.
3. Space management: rename, change icon or currency, add or remove people, leave, delete.
4. Transactions list, profile update and preferences.
5. Sign-up phone verification by OTP, and forgot-password by username with a masked phone. Until these exist, the app disables Create Account and Forgot password in server mode.
6. Before any public URL:
   - rate limits on register, search and forgot-password;
   - a real SMS provider with spend caps;
   - refresh-token reuse detection;
   - PostgreSQL testing of migration 0002;
   - HTTPS (the app allows plain HTTP only for this test build);
   - pinned dependencies.
7. ~~Decide whether the 10-minute idle sign-out is right~~ Decided: 30 minutes (`SESSION_IDLE_TIMEOUT_MINUTES`).

### App team

1. **Brand:** the launcher icon and adaptive icon are Expo placeholders. Replace them in `mobile/assets/images/` once the brand exists (`specs.md` § 16.2).
2. **Release signing:** create an upload keystore and a signed release config, raise `versionCode` per build, and build an AAB for the Play Store. Turn off cleartext HTTP for production.
3. **Real-device QA:** run the § 3 checklist on a low-end Android phone. In particular, check Fraunces legibility at 12–14 pt (`specs.md` § 3.8).
4. **iOS:** the code is cross-platform Expo, but it has never been built or tested on iOS.
5. **When the backend ships an endpoint:** replace the matching `notOnServer()` in `mobile/src/services/server/index.ts` with the real call. The screens already handle both modes.
6. **Known small items:**
   - The "Transactions" tab label may shrink on 320 dp phones.
   - Lists are not virtualised; fine for demo data, but needed for large real spaces.
   - A few kit components are duplicated between feature folders.
   - The reviewers' remaining minor findings are in the final report.

## 5. Decisions made on your behalf

The full list, each with what it costs if wrong, is under "Rulings I made" in the final report. The ones that matter most:

- Demo and server modes live in one APK, and demo is the default.
- PR #3 and PR #4 were adopted and adapted to the plan.
- The 3-letter people search was kept.
- The debug menu ships in this test APK.
- Plain-HTTP traffic is allowed in this test APK.
- The APK is built from `C:\u\m` with `CMAKE_OBJECT_PATH_MAX=240`, because Windows long paths are off.
