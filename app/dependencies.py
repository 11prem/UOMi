"""FastAPI dependencies that identify the caller.

The rule behind every protected endpoint: the username comes from the token, never from the
request, and every query starts from it.

401 codes the app can switch on:
  not_authenticated  no Authorization header           -> show the Login page
  invalid_token      the access token is not valid     -> show the Login page
  token_expired      the access token ran out (15 min) -> call /auth/refresh, then retry
  session_expired    idle too long, logged out, or the session hit its absolute limit
                                                       -> show the Login page
"""

from dataclasses import dataclass

from fastapi import Depends
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.orm import Session

from app.database import get_db
from app.models.user import User
from app.services import session_service
from app.utils import security
from app.utils.errors import BEARER_HEADERS, api_error

bearer_scheme = HTTPBearer(auto_error=False)


@dataclass
class AuthContext:
    user: User
    session_id: str


def get_auth_context(
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
    db: Session = Depends(get_db),
) -> AuthContext:
    """Check the access token, then run the inactivity timer for its session."""
    if credentials is None:
        raise api_error(401, "not_authenticated", "Sign in to continue.", headers=BEARER_HEADERS)
    try:
        username, session_id = security.decode_access_token(credentials.credentials)
    except security.TokenExpired:
        raise api_error(
            401, "token_expired", "Access token expired. Refresh it.", headers=BEARER_HEADERS
        ) from None
    except security.TokenError:
        raise api_error(401, "invalid_token", "Invalid access token.", headers=BEARER_HEADERS) from None

    session_service.touch_session(db, session_id, username)  # raises session_expired when idle

    user = db.get(User, username)
    if user is None or user.deleted_at is not None:
        raise api_error(401, "invalid_token", "Invalid access token.", headers=BEARER_HEADERS)
    return AuthContext(user=user, session_id=session_id)


def get_current_user(context: AuthContext = Depends(get_auth_context)) -> User:
    return context.user
