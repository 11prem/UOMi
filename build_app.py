#!/usr/bin/env python3
"""Build the standalone UOMi release APK (Windows).

Run from anywhere:   python build_app.py
Output:              <repo>\\dist\\UOMi-<version>.apk   (the path is printed at the end)

It runs mobile/scripts/build-apk.ps1, which builds the COMMITTED state of mobile/ (git archive HEAD:mobile),
not your working tree. So this script stops first if mobile/ has uncommitted changes, instead of quietly
building an older app than the one you are looking at. Use --allow-dirty to build the committed state anyway.

Needs (see mobile/README.md): JDK 17 and the Android SDK in %LOCALAPPDATA%\\uomi-toolchain (or JAVA_HOME and
ANDROID_HOME set), and mobile/node_modules (run `npm ci` in mobile/ once). Python 3 standard library only.
"""

import argparse
import json
import subprocess
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parent
SCRIPT = REPO / "mobile" / "scripts" / "build-apk.ps1"


def main() -> int:
    parser = argparse.ArgumentParser(description="Build the UOMi release APK.")
    parser.add_argument("--allow-dirty", action="store_true", help="build HEAD even if mobile/ has uncommitted changes")
    parser.add_argument("--build-root", help=r"short folder to build in (default C:\u\m, keep it short)")
    args = parser.parse_args()

    if sys.platform != "win32":
        return fail("This build script is for Windows (it wraps mobile/scripts/build-apk.ps1).")
    if not SCRIPT.is_file():
        return fail(f"Not found: {SCRIPT}")

    dirty = run(["git", "-C", str(REPO), "status", "--porcelain", "--", "mobile"], capture=True).strip()
    if dirty and not args.allow_dirty:
        return fail(
            "mobile/ has uncommitted changes, and the build only uses the committed state:\n"
            f"{dirty}\n\nCommit them first (git add mobile && git commit), or re-run with --allow-dirty."
        )

    command = ["powershell", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", str(SCRIPT)]
    if args.build_root:
        command += ["-BuildRoot", args.build_root]
    print("Building the APK. The first run takes several minutes.\n", flush=True)
    if subprocess.run(command, cwd=REPO).returncode != 0:
        return fail("The build failed. The message above says why.")

    version = json.loads((REPO / "mobile" / "app.json").read_text(encoding="utf-8"))["expo"]["version"]
    apk = REPO / "dist" / f"UOMi-{version}.apk"
    if not apk.is_file():
        return fail(f"The build reported success but {apk} does not exist.")
    print(f"\nAPK ready: {apk}  ({apk.stat().st_size / 1_048_576:.1f} MB)")
    print("Copy it to the phone and install it (allow installs from unknown sources). It opens in demo mode.")
    return 0


def run(command: list[str], capture: bool = False) -> str:
    result = subprocess.run(command, capture_output=capture, text=True, cwd=REPO)
    if result.returncode != 0:
        raise SystemExit(f"{' '.join(command)} failed: {result.stderr or result.returncode}")
    return result.stdout if capture else ""


def fail(message: str) -> int:
    print(f"\nBUILD STOPPED: {message}", file=sys.stderr)
    return 1


if __name__ == "__main__":
    sys.exit(main())
