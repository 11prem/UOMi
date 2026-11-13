"""Auth endpoints: Create Account (with phone verification), Sign In, session refresh, Forgot Password, Logout."""

from typing import Annotated

from fastapi import APIRouter, BackgroundTasks, Depends, Query, status
from sqlalchemy.orm import Session

from app.database import get_db
from app.dependencies import AuthContext, get_auth_context
from app.schemas.user import (
    AvailabilityOut,
    ForgotRequest,
    ForgotResponse,
    LoginRequest,
    RefreshRequest,
    RegisterRequest,
    ResendOut,
    ResendRequest,
    ResetOut,
    ResetRequest,
    SignupStarted,
    TokenPair,
    VerifyOTPRequest,
    VerifyOTPResponse,
    VerifySignupRequest,
)
from app.services import auth_service, session_service
from app.utils.errors import field_error
from app.utils.rate_limit import (
    forgot_limit,
    login_limit,
    phone_check_limit,
    register_limit,
    resend_limit,
    username_check_limit,
    verify_otp_limit,
)
from app.utils.validators import normalize_phone, validate_new_username

router = APIRouter(prefix="/auth", tags=["auth"])

# The limits are per client address and count every call, successful or not (utils/rate_limit.py).


@router.post(
    "/register",
    response_model=SignupStarted,
    status_code=status.HTTP_202_ACCEPTED,
    dependencies=[Depends(register_limit)],
)
def register(
    data: RegisterRequest, background_tasks: BackgroundTasks, db: Session = Depends(get_db)
) -> SignupStarted:
    """Create Account -> Verify phone. Texts a code; the account does NOT exist until `/auth/register/verify`."""
    return auth_service.start_signup(db, data, background_tasks)


@router.post(
    "/register/verify",
    response_model=TokenPair,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(verify_otp_limit)],
)
def register_verify(data: VerifySignupRequest, db: Session = Depends(get_db)) -> TokenPair:
    """Verify phone -> Home Page. The right code creates the account and signs the new user straight in."""
    return auth_service.verify_signup(db, data.pending_id, data.code)


@router.post("/otp/resend", response_model=ResendOut, dependencies=[Depends(resend_limit)])
def otp_resend(
    data: ResendRequest, background_tasks: BackgroundTasks, db: Session = Depends(get_db)
) -> ResendOut:
    """"Resend code" on either code screen: send `pending_id` (sign-up) or `reset_id` (forgot password)."""
    return auth_service.resend_code(db, data.id, background_tasks)


@router.get("/check-username", response_model=AvailabilityOut, dependencies=[Depends(username_check_limit)])
def check_username(username: Annotated[str, Query(max_length=50)], db: Session = Depends(get_db)) -> AvailabilityOut:
    """The live "✓ available / ✗ taken" under the username field on Create Account."""
    try:
        clean = validate_new_username(username)
    except ValueError as problem:
        raise field_error("username", str(problem)) from None
    return AvailabilityOut(available=auth_service.username_available(db, clean))


@router.get("/check-phone", response_model=AvailabilityOut, dependencies=[Depends(phone_check_limit)])
def check_phone(phone: Annotated[str, Query(max_length=30)], db: Session = Depends(get_db)) -> AvailabilityOut:
    """Is this phone number free? Tells anyone whether a number has an account, so it has a tight limit per address."""
    try:
        clean = normalize_phone(phone)
    except ValueError as problem:
        raise field_error("phone", str(problem)) from None
    return AvailabilityOut(available=auth_service.phone_available(db, clean))


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
    """Forgot Password: a username -> a code is texted to its phone, and the masked number comes back.

    The reply has the same shape for a username that does not exist.
    """
    return auth_service.request_password_reset(db, data.username, background_tasks)


@router.post("/verify-otp", response_model=VerifyOTPResponse, dependencies=[Depends(verify_otp_limit)])
def verify_otp(data: VerifyOTPRequest, db: Session = Depends(get_db)) -> VerifyOTPResponse:
    """Enter the code: right code -> reset token for the Set new password screen."""
    return auth_service.verify_reset_otp(db, data.reset_id, data.code)


@router.post("/reset", response_model=ResetOut)
def reset(data: ResetRequest, db: Session = Depends(get_db)) -> ResetOut:
    """Set new password -> then sign in again (Login Page, with `username` filled in)."""
    username = auth_service.reset_password(db, data.reset_token, data.new_password)
    return ResetOut(message="Password updated. Please sign in.", username=username)


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
def logout(
    context: AuthContext = Depends(get_auth_context), db: Session = Depends(get_db)
) -> None:
    """Profile > Logout -> back to the Login Page. Ends this device's session."""
    auth_service.logout(db, context.session_id)
