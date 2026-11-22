"""Guards for people adding code. Each fails with an instruction when a new piece has not been wired in.

They exist because the usual integration mistakes are silent: a router file nobody registered, a model nobody
imported (so Alembic never sees the table), two migrations that both claim to be the newest, a public endpoint
nobody rate limited. docs/adding-to-the-backend.md says what to do in each case.
"""

import importlib
import os
import re
import subprocess
import sys
from collections.abc import Iterator
from pathlib import Path

from alembic.config import Config
from alembic.script import ScriptDirectory
from fastapi.routing import APIRoute

from app.config import Settings
from app.dependencies import get_auth_context, get_current_user
from app.main import app as fastapi_app
from app.utils.rate_limit import is_rate_limit_dependency

ROOT = Path(__file__).resolve().parents[1]

# Routes that need no sign-in and are deliberately NOT rate limited, with the reason. Adding a route here is a
# decision: say why nothing can be learned or abused through it.
PUBLIC_WITHOUT_LIMIT = {
    ("GET", "/health"): "liveness probe: no data and no cost",
    ("POST", "/auth/refresh"): "needs a 256-bit random token, so there is nothing to guess",
    ("POST", "/auth/reset"): "needs a 256-bit random single-use token, so there is nothing to guess",
}


def dependency_calls(dependant) -> Iterator:
    for sub in dependant.dependencies:
        yield sub.call
        yield from dependency_calls(sub)


def walk(routes, prefix: str = "", inherited: tuple = ()) -> Iterator[tuple[str, str, list]]:
    """Yield (method, path, dependency callables) for every API route, wherever FastAPI keeps it.

    Newer FastAPI versions do not copy a router's routes into the app on include_router: they store a wrapper
    (with the include-time prefix and dependencies) around the original router. Older ones copy the routes.
    Both are handled, and test_the_route_walker_sees_every_documented_operation fails if a FastAPI upgrade
    changes this again, so the guards below can never silently check nothing.
    """
    for route in routes:
        if isinstance(route, APIRoute):
            calls = [*inherited, *dependency_calls(route.dependant)]
            for method in sorted(route.methods - {"HEAD", "OPTIONS"}):
                yield method, prefix + route.path, calls
        elif hasattr(route, "original_router"):  # an include_router wrapper
            context = route.include_context
            at_include = tuple(depends.dependency for depends in context.dependencies)
            yield from walk(route.original_router.routes, prefix + context.prefix, (*inherited, *at_include))


def all_routes() -> list[tuple[str, str, list]]:
    return list(walk(fastapi_app.routes))


# --- Routes ------------------------------------------------------------------


def test_the_route_walker_sees_every_documented_operation():
    seen = {(method, path) for method, path, _ in all_routes()}
    documented = {
        (method.upper(), path)
        for path, item in fastapi_app.openapi()["paths"].items()
        for method in item
        if method in ("get", "post", "put", "patch", "delete")
    }
    assert documented, "the OpenAPI document lists no operations"
    assert documented <= seen, (
        f"The route guards in this file cannot see {sorted(documented - seen)}: FastAPI probably changed how it "
        "stores included routers. Update walk() before trusting the other guards."
    )


def test_every_public_route_is_rate_limited_or_knowingly_exempt():
    unprotected: list[tuple[str, str]] = []
    seen: set[tuple[str, str]] = set()
    for method, path, calls in all_routes():
        seen.add((method, path))
        needs_sign_in = any(call in (get_current_user, get_auth_context) for call in calls)
        limited = any(is_rate_limit_dependency(call) for call in calls)
        if not needs_sign_in and not limited and (method, path) not in PUBLIC_WITHOUT_LIMIT:
            unprotected.append((method, path))

    assert not unprotected, (
        f"{unprotected} need no sign-in and have no rate limit, so anyone can call them without limit. "
        "Add dependencies=[Depends(limit_by_ip(...))] (app/utils/rate_limit.py), or add the route to "
        "PUBLIC_WITHOUT_LIMIT in this file with the reason it is safe."
    )
    stale = set(PUBLIC_WITHOUT_LIMIT) - seen
    assert not stale, f"PUBLIC_WITHOUT_LIMIT names routes that no longer exist: {sorted(stale)}"


def test_every_router_file_is_included_in_the_app():
    in_app = {(method, path) for method, path, _ in all_routes()}
    problems: list[str] = []
    for path in sorted((ROOT / "app" / "routers").glob("*.py")):
        if path.name == "__init__.py":
            continue
        router = getattr(importlib.import_module(f"app.routers.{path.stem}"), "router", None)
        if router is None:
            problems.append(f"app/routers/{path.name} has no `router`")
            continue
        for method, route_path, _ in walk(router.routes):
            if (method, route_path) not in in_app:
                problems.append(f"{method} {route_path} (app/routers/{path.name})")
    assert not problems, (
        f"These routes exist in a router file but are not served: {problems}. "
        "Add the router module to the tuple in create_app() in app/main.py."
    )


# --- Database ----------------------------------------------------------------


def test_every_model_file_is_imported_by_app_models():
    """A table whose model is not imported in app/models/__init__.py is invisible to Alembic and create_all.

    Checked in a fresh process: in this one, some other test may already have imported the file by itself.
    """
    declared: dict[str, str] = {}
    for path in sorted((ROOT / "app" / "models").glob("*.py")):
        if path.name != "__init__.py":
            for table in re.findall(r"""__tablename__\s*=\s*["'](\w+)["']""", path.read_text(encoding="utf-8")):
                declared[table] = path.name

    code = "import app.models; from app.database import Base; print(' '.join(Base.metadata.tables))"
    result = subprocess.run([sys.executable, "-c", code], cwd=ROOT, env=os.environ, capture_output=True, text=True)
    assert result.returncode == 0, result.stderr
    registered = set(result.stdout.split())

    assert declared, "no models were found: this guard is looking in the wrong place"
    missing = {table: file for table, file in declared.items() if table not in registered}
    assert not missing, (
        f"These models are not imported by app/models/__init__.py, so Alembic will not see their tables: {missing}"
    )


def test_there_is_a_single_migration_head():
    config = Config(str(ROOT / "alembic.ini"))
    config.set_main_option("script_location", str(ROOT / "migrations"))
    heads = ScriptDirectory.from_config(config).get_heads()
    assert len(heads) == 1, (
        f"Two migrations both claim to be the newest ({heads}), so `alembic upgrade head` will refuse to run. "
        "Point the newer migration's down_revision at the other one, or run `alembic merge heads`."
    )


# --- Settings ----------------------------------------------------------------


def test_env_example_only_names_real_settings():
    text = (ROOT / ".env.example").read_text(encoding="utf-8")
    names = {
        line.split("=", 1)[0].strip()
        for line in text.splitlines()
        if "=" in line and not line.lstrip().startswith("#")
    }
    assert names, ".env.example sets nothing: this guard is looking in the wrong place"
    unknown = names - set(Settings.model_fields)
    assert not unknown, (
        f".env.example sets names that Settings does not have (a typo, or a removed setting): {sorted(unknown)}"
    )
