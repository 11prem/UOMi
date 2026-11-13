"""The record of the API (task 1.9.5) matches the code, and every endpoint is described.

If one of these fails, the API changed without the record: run `python scripts/export_api_contract.py` and commit
`docs/openapi.json` and `docs/api-contract.md`.
"""

import subprocess
import sys
from pathlib import Path

from app.main import app
from app.utils.api_contract import contract_json, contract_markdown, normalised, operations
from tests.test_integration_guards import all_routes

ROOT = Path(__file__).resolve().parent.parent
FIX = "The API changed. Run `python scripts/export_api_contract.py` and commit docs/openapi.json and docs/api-contract.md."


def test_the_openapi_file_matches_the_code():
    assert (ROOT / "docs" / "openapi.json").read_text(encoding="utf-8") == contract_json(app.openapi()), FIX


def test_the_endpoint_table_matches_the_code():
    assert (ROOT / "docs" / "api-contract.md").read_text(encoding="utf-8") == contract_markdown(app.openapi()), FIX


def test_every_route_is_in_the_table():
    routes = {(method, path) for method, path, _ in all_routes()}  # the walker that finds routers included in the app
    assert routes, "the route walker found nothing"
    listed = {(row["method"], row["path"]) for row in operations(normalised(app.openapi()))}

    assert routes == listed


def test_every_endpoint_says_what_it_does():
    """The first line of the endpoint's docstring is the table's description, so none may be missing."""
    missing = [f"{row['method']} {row['path']}" for row in operations(normalised(app.openapi())) if not row["summary"]]

    assert missing == [], f"Give these endpoints a docstring: {missing}"


def test_the_record_does_not_depend_on_the_developers_own_settings():
    schema = app.openapi()
    renamed = {**schema, "info": {**schema["info"], "title": "Something else entirely"}}

    assert contract_json(renamed) == contract_json(schema)


def test_the_export_script_runs_and_agrees():
    done = subprocess.run([sys.executable, "scripts/export_api_contract.py", "--check"], cwd=ROOT, capture_output=True, text=True)

    assert done.returncode == 0, done.stderr + done.stdout
