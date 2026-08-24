from __future__ import annotations

from pydantic import BaseModel, ConfigDict, EmailStr, Field

from app.models.user import OrganizationView, UserView


class RegisterRequest(BaseModel):
    organization_name: str = Field(..., min_length=2, max_length=120)
    email: EmailStr
    password: str = Field(..., min_length=8, max_length=128)
    display_name: str | None = Field(None, max_length=120)


class LoginRequest(BaseModel):
    email: EmailStr
    password: str = Field(..., min_length=8, max_length=128)


class RefreshRequest(BaseModel):
    refresh_token: str = Field(..., min_length=16)


class LogoutRequest(BaseModel):
    refresh_token: str = Field(..., min_length=16)


class SendEmailCodeRequest(BaseModel):
    email: EmailStr


class LoginWithEmailCodeRequest(BaseModel):
    email: EmailStr
    code: str = Field(..., min_length=4, max_length=32)


class EmailOtpSendData(BaseModel):
    cooldown_seconds: int = 60


class AuthSessionData(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    access_token: str
    refresh_token: str
    token_type: str = "bearer"
    expires_in: int
    user: UserView
    organization: OrganizationView
    role: str