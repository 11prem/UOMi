#!/usr/bin/env python3
"""Build the standalone UOMi release APK (Windows).

Run from anywhere:   python build_app.py
Output:              <repo>\\dist\\UOMi-<version>.apk   (the path is printed at the end)

It runs mobile/scripts/build-apk.ps1, which builds the current files of mobile/ (no git needed).

Needs (see mobile/README.md): JDK 17 and the Android SDK in %LOCALAPPDATA%\\uomi-toolchain (or JAVA_HOME and
ANDROID_HOME set), and mobile/node_modules (run `npm ci` in mobile/ once). Python 3 standard library only.
"""

import argparse
import json
import os
import subprocess
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parent
SCRIPT = REPO / "mobile" / "scripts" / "build-apk.ps1"


def main() -> int:
    parser = argparse.ArgumentParser(description="Build the UOMi release APK.")
    parser.add_argument("--build-root", help=r"short folder to build in (default C:\u\m, keep it short)")
    parser.add_argument(
        "--api-url",
        help="backend address the app starts with, e.g. http://192.168.1.20:8000 (default: the EXPO_PUBLIC_API_URL environment variable)",
    )
    args = parser.parse_args()

    if sys.platform != "win32":
        return fail("This build script is for Windows (it wraps mobile/scripts/build-apk.ps1).")
    if not SCRIPT.is_file():
        return fail(f"Not found: {SCRIPT}")

    command = ["powershell", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", str(SCRIPT)]
    if args.build_root:
        command += ["-BuildRoot", args.build_root]
    env = os.environ.copy()
    if args.api_url:
        env["EXPO_PUBLIC_API_URL"] = args.api_url.strip().rstrip("/")
    api_url = env.get("EXPO_PUBLIC_API_URL")
    if api_url:
        print(f"The app will talk to the backend at {api_url}\n", flush=True)
    else:
        print(
            "No backend address given (--api-url or EXPO_PUBLIC_API_URL): the app starts with https://uomi-1.onrender.com.\n"
            "It can be changed on the phone: long-press the UOMi wordmark on the Welcome screen.\n",
            flush=True,
        )
    print("Building the APK. The first run takes several minutes.\n", flush=True)
    if subprocess.run(command, cwd=REPO, env=env).returncode != 0:
        return fail("The build failed. The message above says why.")

    version = json.loads((REPO / "mobile" / "app.json").read_text(encoding="utf-8"))["expo"]["version"]
    apk = REPO / "dist" / f"UOMi-{version}.apk"
    if not apk.is_file():
        return fail(f"The build reported success but {apk} does not exist.")
    print(f"\nAPK ready: {apk}  ({apk.stat().st_size / 1_048_576:.1f} MB)")
    print("Copy it to the phone and install it (allow installs from unknown sources). It needs the backend to be running.")
    return 0


def fail(message: str) -> int:
    print(f"\nBUILD STOPPED: {message}", file=sys.stderr)
    return 1


if __name__ == "__main__":
    sys.exit(main())
