# UOMi mobile app

The UOMi phone app, built with React Native and Expo (SDK 58, React Native 0.88, TypeScript, Expo Router). It ships as a standalone Android APK: install the APK file and it works, with no Expo Go, dev server or computer needed.

- **What the app must do:** `../specs.md` (screens, rules, copy) and `../DESIGN.md` (visual system).
- **Build design and plan:** `../docs/superpowers/specs/2026-11-06-uomi-mobile-app-design.md` and `../docs/superpowers/plans/2026-11-06-uomi-mobile-app.md`.
- **Visual reference:** `../prototype/`, the approved HTML prototype.

## The backend

The app always talks to the FastAPI backend in `../app`. There is no demo mode and no sample data on the phone.

- **Where the backend is:** the deployed server, `https://uomi-1.onrender.com`, unless `EXPO_PUBLIC_API_URL` was set when the app was built or started. To point the app somewhere else, long-press the **UOMi** wordmark on Welcome, enter the address, **Test connection** and **Save**. The address is kept on the phone, and changing it signs you out. A change made with `EXPO_PUBLIC_API_URL` only applies to a phone that has not saved an address yet.
- **Hosted server asleep:** on Render's free plan the server sleeps when idle, and the first request can take up to a minute. The app waits up to 60 seconds before giving up.
- **Endpoints that exist work:** sign in and out, Create Account, Forgot password, Home, Create Space, people search, the Space page, expenses, settle up, transactions and Notifications use the real backend.
- **Endpoints that don't exist show a panel:** a feature the server has no endpoint for shows **"Not available on this server yet"**. See `../BACKEND-DEVIATIONS.md`.
- **Email, not phone numbers:** sign-up and forgot password use an email address and a one-time code (`OTP_FIXED_CODE` in the backend's `.env`, if set). People are found by username only.
- **Idle sign-out:** the app returns to Sign In after about 29.5 idle minutes: the server's limit (30 minutes) minus a 30-second margin. It follows whatever the server says (`idle_timeout_seconds`).
- **On the phone only:** the theme, the default currency and the Notifications switch. The server keeps no preferences, and no profile photos.

### Connecting a phone to the backend

1. Start the backend on your laptop, from the repo root: `uvicorn app.main:app --host 0.0.0.0 --port 8000`. It creates its own tables, and there is nothing to seed.
2. Give the app the address (long-press the wordmark on Welcome, or build or start it with `EXPO_PUBLIC_API_URL`):
   - **Same Wi-Fi:** use `http://<laptop Wi-Fi IP>:8000`. Find the IP with `ipconfig`. Windows Firewall may ask you to allow Python.
   - **USB:** if your company network blocks phone-to-laptop traffic, plug the phone in, run `adb reverse tcp:8000 tcp:8000`, and use `http://127.0.0.1:8000`.
3. Or start the app with that address (`EXPO_PUBLIC_API_URL=http://192.168.1.20:8000 npm start`), or build the APK with it (`python build_app.py --api-url http://192.168.1.20:8000`).
4. Tap **Create account** and sign up.
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
$env:EXPO_PUBLIC_API_URL = 'http://192.168.1.20:8000'   # the backend the app starts with; it can be changed on the phone
powershell -ExecutionPolicy Bypass -File mobile\scripts\build-apk.ps1
```

Or run `python build_app.py --api-url http://192.168.1.20:8000` from the repo root, which does the same.

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
| `src/domain/` | Pure TypeScript: money (integer minor units, Indian grouping), email (validation and masking), the four split types with the rounding rule, pairwise balances, and the balance wording. Fully unit-tested. |
| `src/services/` | One `Services` interface (`types.ts`) and its `server/` implementation (HTTP client: single-flight token refresh, idle check, error-code mapping). |
| `src/state/` | Session store: server URL, user, idle timer, services registry. |
| `src/ui/` | The stationery UI kit from `DESIGN.md`: sheets, ledger rows, member plates, stamps, carbon copies, OTP input, sheets, toasts and confirm dialogs. |
| `src/features/` | Screen-specific pieces, one folder per area. |
| `src/theme/` | Colour tokens (light and dark, from `../prototype/css/tokens.css`), the type scale and the five static Fraunces fonts. |
| `test-support/` | Test-only: an in-memory fake backend (`fake/`) the screen tests sign in to. `jest.setup.js` swaps it in when the session's `serverUrl` is `FAKE_SERVER_URL`. It is never bundled into the app. |
| `plugins/` | Expo config plugin for the Android release build. |
| `scripts/build-apk.ps1` | One-command APK build. |
