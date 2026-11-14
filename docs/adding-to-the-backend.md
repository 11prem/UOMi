# Adding to the backend

How to add code so that it joins up with the rest without surprises. Most mistakes here are silent (a router nobody
registered, a table Alembic never sees), so `tests/test_integration_guards.py` checks the wiring and fails with an
instruction. Run the tests before you push:

```bash
pytest                 # all of it, about 20 seconds
alembic upgrade head   # on a scratch database, to be sure the migrations still run
alembic heads          # must print exactly one line
```

## If you add... do this

| You add | Do this | What fails if you forget |
|---|---|---|
| An endpoint in an existing router | Write it in `app/routers/<area>.py`; put the logic in `app/services/`. | nothing to wire |
| A new router file | Add its module to the tuple in `create_app()` in `app/main.py`. | `test_every_router_file_is_included_in_the_app` |
| An endpoint, or a change to what one takes or returns | Give it a docstring (its first line is the description in the API record), then run `python scripts/export_api_contract.py` and commit `docs/openapi.json` and `docs/api-contract.md`. | `test_the_openapi_file_matches_the_code`, `test_the_endpoint_table_matches_the_code`, `test_every_endpoint_says_what_it_does` |
| An endpoint that needs no sign-in | Give it a rate limit (below), or add it to `PUBLIC_WITHOUT_LIMIT` in the guards file with the reason it is safe. | `test_every_public_route_is_rate_limited_or_knowingly_exempt` |
| A table | Model in `app/models/`, imported in `app/models/__init__.py`; then `alembic revision --autogenerate -m "..."`. | `test_every_model_file_is_imported_by_app_models`, `test_upgrade_head_matches_models` |
| A migration | It must revise the current head (`alembic heads`). If a teammate's migration landed first, change your `down_revision` to theirs, or run `alembic merge heads`. | `test_there_is_a_single_migration_head` |
| A setting | Add it to `Settings` in `app/config.py` with a default, and to `.env.example` under the same name. | `test_env_example_only_names_real_settings` |
| A secret needed in production | Also add a check to `Settings.production_problems()` and a case to `tests/test_phase2_security.py`, so production refuses to start without it. | nothing: this is only remembered by you |
| A dependency | Pin it with `==` in `requirements.txt` (and its own dependencies). | `test_every_requirement_is_pinned_to_an_exact_version` |
| A query-string parameter that carries something private | Add its name to `SENSITIVE_QUERY_PARAMS` in `app/utils/log_redaction.py`. | nothing: the value would be written to the access log |

## Conventions the code relies on

- **Errors:** `raise api_error(status, "stable_code", "A sentence for a person.")` (`app/utils/errors.py`). Add the code to the
  table in `docs/backend-api.md`. The app maps backend codes in `mobile/src/services/server/http.ts`: a code it does not
  know is shown as a generic error, and `too_many_requests` is not mapped yet.
- **Who is calling:** take the user from the token with `Depends(get_current_user)`, never from the request body or path,
  and start every query from `user.username`.
- **Money** is an integer in minor units (`amount_minor`). **Times** use `UTCDateTime` and `utcnow()` from
  `app/database.py`, never `datetime.now()`.
- **A user is identified by `username`** (it is the primary key). Foreign keys to users hold the username.
- **Several statements that must go together** belong in one transaction in the service, with one `db.commit()` at the end.
  Where two requests could race (use a token once, take a turn, claim a row), claim it with one conditional
  `UPDATE ... WHERE <still free>` and check `rowcount`, as `reset_password` and `refresh_session` do. Do not read, decide
  in Python, then write.

## Rate limits

`app/utils/rate_limit.py` has the limiter and two ways to use it:

```python
# per address, as a dependency on the route
@router.post("/thing", dependencies=[Depends(limit_by_ip("thing", lambda: settings.THING_MAX_PER_IP_PER_HOUR, HOUR))])

# per user (or anything else), inside the route
enforce(f"thing:user:{current_user.username}", settings.THING_MAX_PER_USER_PER_HOUR, HOUR)
```

Put the numbers in `Settings` (with `Field(ge=1)`) and `.env.example`, so a limit is a one-line change. A refused request
answers `429 too_many_requests` with `Retry-After`, and a refused request is not counted.

Things to know before you rely on it:

- **The counters are in memory, per process.** With more than one worker each one counts alone, and a restart forgets
  everything. Move `SlidingWindowLimiter.hit` to PostgreSQL or Redis before running several workers.
- **Behind a load balancer** set `TRUSTED_PROXY_COUNT` to the number of proxies in front of the API. Otherwise every
  request looks as if it came from the balancer and everyone shares one budget. Over a Unix socket the address is unknown
  and everyone shares one budget in the same way.
- **Shared addresses.** Many people on a mobile network can share one public address. The per-address limits (sign-up,
  sign-in, code requests) are sized for a demo or a small launch; raise them, or count per device, before a large one.

## Migrations and PostgreSQL

- `render_as_batch` is on for SQLite in `migrations/env.py`, so write migrations with `op.batch_alter_table`.
- Migration `0002` has a SQLite-only constraint name and has never run on PostgreSQL (`BACKEND-DEVIATIONS.md` section 3).
  The tests run on SQLite only, so a PostgreSQL problem will not show up in `pytest`: run `alembic upgrade head` there.
- A test that races threads needs a real SQLite file, because the in-memory test database shares one connection.
  `tests/test_phase2_security.py` has a `file_engine` fixture and a `run_in_parallel` helper for this.

## Tests

- `ENVIRONMENT=test` is set in `tests/conftest.py` (it is the only environment allowed fewer than 12 bcrypt rounds).
- The rate limiter's counters are reset before every test by an automatic fixture. If you replace the limiter, update it.
- Use `tests/helpers.py` (`register`, `auth`, `create_space`, `error_code`, ...) so tests read the same way.
