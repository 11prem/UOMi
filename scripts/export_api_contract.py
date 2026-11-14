"""Write the record of the API: docs/openapi.json and docs/api-contract.md (task 1.9.5).

    python scripts/export_api_contract.py          rewrite both files from the app as it is now
    python scripts/export_api_contract.py --check  change nothing; exit 1 if either file is out of date

Run it (without --check) after adding or changing an endpoint, and commit both files. tests/test_api_contract.py runs
the same check, so a forgotten update fails the tests.
"""

import argparse
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))  # so `python scripts/export_api_contract.py` finds `app`
os.environ.setdefault("SECRET_KEY", "contract-export-only-secret-key-0123456789")  # the app refuses to import without one

from app.main import app  # noqa: E402
from app.utils.api_contract import contract_json, contract_markdown  # noqa: E402

FILES = {ROOT / "docs" / "openapi.json": contract_json, ROOT / "docs" / "api-contract.md": contract_markdown}


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--check", action="store_true", help="only check that the files are up to date")
    args = parser.parse_args(argv)

    schema = app.openapi()
    stale = []
    for path, render in FILES.items():
        wanted = render(schema)
        current = path.read_text(encoding="utf-8") if path.exists() else None
        if current == wanted:
            continue
        stale.append(path.name)
        if not args.check:
            path.write_text(wanted, encoding="utf-8", newline="\n")
    if args.check and stale:
        print("Out of date: " + ", ".join(stale) + "\nRun: python scripts/export_api_contract.py", file=sys.stderr)
        return 1
    print("Up to date." if not stale else "Wrote " + ", ".join(stale))
    return 0


if __name__ == "__main__":
    sys.exit(main())
