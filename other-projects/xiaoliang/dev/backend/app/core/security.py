from __future__ import annotations

import hashlib
import secrets
from datetime import datetime, timedelta, timezone
from typing import Any
from uuid import uuid4

import jwt
from argon2 import PasswordHasher
from argon2.exceptions import VerifyMismatchError

from app.core.config import Settings, get_settings
from app.core.errors import AppError

_password_hasher = PasswordHasher()


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


def hash_password(password: str) -> str:
    return _password_hasher.hash(password)


def verify_password(password: str, password_hash: str) -> bool:
    try:
        return _password_hasher.verify(password_hash, password)
    except VerifyMismatchError:
        return False


def create_access_token(
    *,
    subject: str,
    organization_id: str,
    role: str,
    settings: Settings | None = None,
) -> str:
    app_settings = settings or get_settings()
    expires_at = utcnow() + timedelta(minutes=app_settings.access_token_expires_minutes)
    payload: dict[str, Any] = {
        "type": "access",
        "sub": subject,
        "organization_id": organization_id,
        "role": role,
        "jti": str(uuid4()),
        "iat": int(utcnow().timestamp()),
        "exp": int(expires_at.timestamp()),
    }
    return jwt.encode(payload, app_settings.jwt_secret_key, algorithm=app_settings.jwt_algorithm)


def decode_access_token(token: str, settings: Settings | None = None) -> dict[str, Any]:
    app_settings = settings or get_settings()
    try:
        payload = jwt.decode(
            token,
            app_settings.jwt_secret_key,
            algorithms=[app_settings.jwt_algorithm],
        )
    except jwt.ExpiredSignatureError as exc:
        raise AppError(401, "登录状态已过期，请重新登录。", error_code="token_expired") from exc
    except jwt.InvalidTokenError as exc:
        raise AppError(401, "无效的访问令牌。", error_code="invalid_token") from exc

    if payload.get("type") != "access":
        raise AppError(401, "访问令牌类型错误。", error_code="invalid_token_type")
    return payload


def generate_refresh_token() -> str:
    return secrets.token_urlsafe(48)


def hash_refresh_token(refresh_token: str) -> str:
    return hashlib.sha256(refresh_token.encode("utf-8")).hexdigest()