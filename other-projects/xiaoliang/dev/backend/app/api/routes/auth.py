from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, status

from app.api.dependencies import get_auth_service
from app.models.auth import (
    AuthSessionData,
    EmailOtpSendData,
    LoginRequest,
    LoginWithEmailCodeRequest,
    LogoutRequest,
    RefreshRequest,
    RegisterRequest,
    SendEmailCodeRequest,
)
from app.models.common import ApiResponse, OperationStatus
from app.services.auth_service import AuthService

router = APIRouter(prefix="/auth", tags=["auth"])


@router.post("/register", response_model=ApiResponse[AuthSessionData], status_code=status.HTTP_201_CREATED)
def register(
    payload: RegisterRequest,
    auth_service: Annotated[AuthService, Depends(get_auth_service)],
) -> ApiResponse[AuthSessionData]:
    return ApiResponse(data=auth_service.register(payload))


@router.post("/login", response_model=ApiResponse[AuthSessionData])
def login(
    payload: LoginRequest,
    auth_service: Annotated[AuthService, Depends(get_auth_service)],
) -> ApiResponse[AuthSessionData]:
    return ApiResponse(data=auth_service.login(payload))


@router.post("/email-otp/send", response_model=ApiResponse[EmailOtpSendData])
def send_email_otp(
    payload: SendEmailCodeRequest,
    auth_service: Annotated[AuthService, Depends(get_auth_service)],
) -> ApiResponse[EmailOtpSendData]:
    return ApiResponse(data=auth_service.send_email_login_code(payload))


@router.post("/email-otp/login", response_model=ApiResponse[AuthSessionData])
def login_with_email_otp(
    payload: LoginWithEmailCodeRequest,
    auth_service: Annotated[AuthService, Depends(get_auth_service)],
) -> ApiResponse[AuthSessionData]:
    return ApiResponse(data=auth_service.login_with_email_code(payload))


@router.post("/refresh", response_model=ApiResponse[AuthSessionData])
def refresh(
    payload: RefreshRequest,
    auth_service: Annotated[AuthService, Depends(get_auth_service)],
) -> ApiResponse[AuthSessionData]:
    return ApiResponse(data=auth_service.refresh(payload))


@router.post("/logout", response_model=ApiResponse[OperationStatus])
def logout(
    payload: LogoutRequest,
    auth_service: Annotated[AuthService, Depends(get_auth_service)],
) -> ApiResponse[OperationStatus]:
    auth_service.logout(payload.refresh_token)
    return ApiResponse(data=OperationStatus())