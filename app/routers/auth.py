"""Auth endpoints: Create Account, Sign In, session refresh, Forgot Password (phone code), Logout."""

from fastapi import APIRouter, BackgroundTasks, Depends, status
from sqlalchemy.orm import Session

from app.database import get_db
from app.dependencies import AuthContext, get_auth_context
from app.schemas.user import (
    ForgotRequest,
    ForgotResponse,
    LoginRequest,
    MessageOut,
    RefreshRequest,
    RegisterRequest,
    ResetRequest,
    TokenPair,
    VerifyOTPRequest,
    VerifyOTPResponse,
)
from app.services import auth_service, session_service
from app.utils.rate_limit import forgot_limit, login_limit, register_limit, verify_otp_limit

router = APIRouter(prefix="/auth", tags=["auth"])

# The limits are per client address and count every call, successful or not (utils/rate_limit.py).


@router.post(
    "/register",
    response_model=TokenPair,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(register_limit)],
)
def register(data: RegisterRequest, db: Session = Depends(get_db)) -> TokenPair:
    """Create Account -> Home Page. Signs the new user straight in."""
    return auth_service.register_user(db, data)


@router.post("/login", response_model=TokenPair, dependencies=[Depends(login_limit)])
def login(data: LoginRequest, db: Session = Depends(get_db)) -> TokenPair:
    """Sign In -> Home Page. Same error for a wrong username or password; 429 after too many tries."""
    return auth_service.login(db, data.username, data.password)


@router.post("/refresh", response_model=TokenPair)
def refresh(data: RefreshRequest, db: Session = Depends(get_db)) -> TokenPair:
    """Trade a refresh token for new tokens. Fails with `session_expired` if the user was idle too long."""
    return session_service.refresh_session(db, data.refresh_token)


@router.post(
    "/forgot",
    response_model=ForgotResponse,
    status_code=status.HTTP_202_ACCEPTED,
    dependencies=[Depends(forgot_limit)],
)
def forgot(
    data: ForgotRequest, background_tasks: BackgroundTasks, db: Session = Depends(get_db)
) -> ForgotResponse:
    """Forgot Password: text a code to the registered phone number (sent after the reply)."""
    return auth_service.request_password_reset(db, data.phone, background_tasks)


@router.post("/verify-otp", response_model=VerifyOTPResponse, dependencies=[Depends(verify_otp_limit)])
def verify_otp(data: VerifyOTPRequest, db: Session = Depends(get_db)) -> VerifyOTPResponse:
    """Enter the code: right code -> reset token for the Set new password screen."""
    return auth_service.verify_reset_otp(db, data.phone, data.code)


@router.post("/reset", response_model=MessageOut)
def reset(data: ResetRequest, db: Session = Depends(get_db)) -> MessageOut:
    """Set new password -> then sign in again (Login Page)."""
    auth_service.reset_password(db, data.reset_token, data.new_password)
    return MessageOut(message="Password updated. Please sign in.")


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
def logout(
    context: AuthContext = Depends(get_auth_context), db: Session = Depends(get_db)
) -> None:
    """Profile > Logout -> back to the Login Page. Ends this device's session."""
    auth_service.logout(db, context.session_id)
