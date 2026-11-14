# UOMi mobile app

The UOMi phone app, built with React Native and Expo (SDK 58, React Native 0.88, TypeScript, Expo Router). It ships as a standalone Android APK: install the APK file and it works, with no Expo Go, dev server or computer needed.

- **What the app must do:** `../specs.md` (screens, rules, copy) and `../DESIGN.md` (visual system).
- **Build design and plan:** `../docs/superpowers/specs/2026-11-06-uomi-mobile-app-design.md` and `../docs/superpowers/plans/2026-11-06-uomi-mobile-app.md`.
- **Visual reference:** `../prototype/`, the approved HTML prototype.

## Two data modes

| Mode | What it uses | When |
|---|---|---|
| **Demo** (default) | Built-in sample data stored on the phone, ported from the prototype. Every screen works, including expenses, settle up and the "Act as…" switch. | Out of the box. Nothing else is needed. |
| **Server** | The FastAPI backend in `../app`. | Long-press the **UOMi** wordmark on Welcome (or in the Profile debug menu), choose **Server**, enter the URL, then **Test connection** and **Save**. |

Rules that only apply in server mode:

- **Endpoints that exist work:** sign in and out, Home, Create Space, people search, the Space page and Notifications use the real backend.
- **Endpoints that don't exist yet show a panel:** Create Account, Forgot password, expenses, settle up, transactions, profile editing and space settings show **"Not available on this server yet"**. See `../BACKEND-DEVIATIONS.md`.
- **Idle sign-out:** the app returns to Sign In after about 29.5 idle minutes: the server's limit (30 minutes) minus a 30-second margin. It follows whatever the server says (`idle_timeout_seconds`). Demo mode stays signed in.
- **Switching modes signs you out** and clears cached data, so the two modes never mix.

### Demo accounts

These are for demo mode and for the backend seed.

- Users: `kabir.r`, `swetha.i`, `arun.n`, `meera.s`, `rohan.d` and `priya.m`. The password is always `demo1234`.
- One-time code in demo mode: `123456`.
- To act as someone else in demo mode, long-press the wordmark on **Profile** → **Act as…**. That menu also has **Reset demo data**.

### Connecting a phone to the backend

1. Start the backend on your laptop, from the repo root:
   1. `alembic upgrade head`
   2. `python scripts/seed_demo.py`
   3. `uvicorn app.main:app --host 0.0.0.0 --port 8000`
2. Set the app's server URL in one of two ways:
   - **Same Wi-Fi:** use `http://<laptop Wi-Fi IP>:8000`. Find the IP with `ipconfig`. Windows Firewall may ask you to allow Python.
   - **USB:** if your company network blocks phone-to-laptop traffic, plug the phone in, run `adb reverse tcp:8000 tcp:8000`, and use `http://127.0.0.1:8000`.
3. Sign in as `kabir.r` / `demo1234`. The balances match demo mode exactly.

## Develop

```bash
cd mobile
npm install
npm run web          # browser preview at http://localhost:8081 (use a 390x844 phone viewport)
npx jest             # unit + screen tests
npx tsc --noEmit     # type check
```

The browser preview can also talk to the backend: `CORS_ORIGINS` already allows `http://localhost:8081`.

## Build the APK (Windows)

From the repo root, after committing your changes (the script builds `HEAD`, not your working copy):

```powershell
powershell -ExecutionPolicy Bypass -File mobile\scripts\build-apk.ps1
```

The script does five things:

1. Exports `HEAD:mobile` to `C:\u\m`. An older folder there is renamed to `C:\u\m-old-<timestamp>`, so delete old copies yourself.
2. Copies `node_modules` into it.
3. Runs `expo prebuild`.
4. Runs `gradlew assembleRelease --no-daemon`.
5. Copies the APK to `dist\UOMi-<version>.apk`.

The first build takes about 45 minutes; later ones take about 10.

**Why the short folder:** Windows' 260-character path limit (`LongPathsEnabled` is off on company machines). Gesture Handler and Worklets' native build folders don't fit under `C:\Users\…\work\UOMi\mobile`.

**The config plugin:** `plugins/withAndroidReleaseBuild.js` makes prebuild:

- add `-DCMAKE_OBJECT_PATH_MAX=240`, so CMake hashes long object paths;
- pin the architectures to `armeabi-v7a,arm64-v8a,x86_64`: all real phones, plus the emulator.

**Toolchain:** the script defaults to `%LOCALAPPDATA%\uomi-toolchain`. To set it up on a new machine you need:

- Microsoft OpenJDK 17, unzipped to `jdk17\`;
- Android command-line tools, unzipped to `android-sdk\cmdline-tools\latest\`.

Then accept the licenses and install the SDK packages:

```bash
android-sdk\cmdline-tools\latest\bin\android.exe --sdk=<sdk> sdk install platforms/android-37.0 platforms/android-36 build-tools/37.0.0 ndk/27.1.12297006 cmake/3.22.1
```

Command-line tools 23+ replace `sdkmanager` with `android sdk`. Set `JAVA_HOME` / `ANDROID_HOME` yourself to use other locations.

**Signing:** the APK is signed with the template's debug keystore. That is fine for sideloading and testing, but not for the Play Store (see `../HANDOVER.md`).

**Optional emulator check:** this needs Windows Hypervisor Platform. Install `emulator` and `system-images/android-36/google_apis/x86_64`, create an AVD, then `adb install -r dist\UOMi-0.1.0.apk`.

## Code map

| Path | What it holds |
|---|---|
| `app/` | Expo Router routes: `(auth)/` sign-in flows, `(tabs)/` Home, Notifications, Transactions and Profile, plus `space/`, `expense/`, `payment/` and `profile-edit`. |
| `src/domain/` | Pure TypeScript: money (integer minor units, Indian grouping), phone (libphonenumber, mobile numbers only), the four split types with the rounding rule, pairwise balances, and the balance wording. Fully unit-tested. |
| `src/services/` | One `Services` interface (`types.ts`), with `demo/` (on-device data in AsyncStorage) and `server/` (HTTP client: single-flight token refresh, idle check, error-code mapping). |
| `src/state/` | Session store: mode, server URL, user, idle timer, services registry. |
| `src/ui/` | The stationery UI kit from `DESIGN.md`: sheets, ledger rows, member plates, stamps, carbon copies, OTP input, sheets, toasts and confirm dialogs. |
| `src/features/` | Screen-specific pieces, one folder per area. |
| `src/theme/` | Colour tokens (light and dark, from `../prototype/css/tokens.css`), the type scale and the five static Fraunces fonts. |
| `plugins/` | Expo config plugin for the Android release build. |
| `scripts/build-apk.ps1` | One-command APK build. |
