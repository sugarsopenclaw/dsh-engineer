from __future__ import annotations

import hashlib
import hmac
import re
import secrets
from datetime import timedelta

from sqlalchemy.orm import Session

from app.core.config import Settings, get_settings
from app.core.errors import AppError
from app.core.security import (
    create_access_token,
    decode_access_token,
    generate_refresh_token,
    hash_password,
    hash_refresh_token,
    utcnow,
    verify_password,
)
from app.models.auth import (
    AuthSessionData,
    EmailOtpSendData,
    LoginRequest,
    LoginWithEmailCodeRequest,
    RefreshRequest,
    RegisterRequest,
    SendEmailCodeRequest,
)
from app.domain.billing.policies import FREE_PLAN_TIER
from app.models.user import CurrentUserData, OrganizationView, UserView
from app.repositories.audit_log_repository import AuditLogRepository
from app.repositories.email_otp_repository import EmailOtpRepository
from app.repositories.membership_repository import MembershipRepository
from app.repositories.organization_repository import OrganizationRepository
from app.repositories.refresh_token_repository import RefreshTokenRepository
from app.repositories.user_repository import UserRepository
from app.schemas.usage_credit_grant import GRANT_TYPE_SIGNUP
from app.services.billing.credit_ledger_service import CreditLedgerService
from app.services.tencent_email import send_login_otp_email


class AuthService:
    def __init__(self, session: Session, settings: Settings | None = None) -> None:
        self.session = session
        self.settings = settings or get_settings()
        self.audit_logs = AuditLogRepository(session)
        self.memberships = MembershipRepository(session)
        self.organizations = OrganizationRepository(session)
        self.refresh_tokens = RefreshTokenRepository(session)
        self.users = UserRepository(session)
        self.email_otps = EmailOtpRepository(session)

    def _grant_signup_credits(self, organization_id: str) -> None:
        """One-time trial credits. There is no daily refill, so this is all a
        free account ever gets until it buys a pack."""
        credits = int(self.settings.billing_signup_grant_credits or 0)
        if credits <= 0:
            return
        ledger = CreditLedgerService(self.session)
        if ledger.grants.get_signup_grant(organization_id) is not None:
            return
        ledger.grant_credits(
            organization_id=organization_id,
            plan_tier=FREE_PLAN_TIER,
            credits=credits,
            grant_type=GRANT_TYPE_SIGNUP,
            duration_days=int(self.settings.billing_grant_duration_days),
        )

    def register(self, payload: RegisterRequest) -> AuthSessionData:
        if self.users.get_by_email(payload.email):
            raise AppError(409, "该邮箱已被注册。", error_code="email_exists")

        organization = self.organizations.create(
            name=payload.organization_name.strip(),
            slug=self._build_unique_org_slug(payload.organization_name),
        )
        user = self.users.create(
            email=payload.email,
            password_hash=hash_password(payload.password),
            display_name=payload.display_name,
        )
        membership = self.memberships.create(
            organization_id=organization.id,
            user_id=user.id,
            role="owner",
        )
        self.audit_logs.create(
            organization_id=organization.id,
            actor_user_id=user.id,
            action="auth.register",
            resource_type="user",
            resource_id=user.id,
            details={"organization_id": organization.id},
        )
        self._grant_signup_credits(organization.id)
        self.session.commit()
        return self._issue_session(user_id=user.id, organization_id=organization.id, role=membership.role)

    def login(self, payload: LoginRequest) -> AuthSessionData:
        user = self.users.get_by_email(payload.email)
        if not user or not user.is_active or not verify_password(payload.password, user.password_hash):
            raise AppError(401, "邮箱或密码错误。", error_code="invalid_credentials")

        membership = self.memberships.get_primary_for_user(user.id)
        if not membership:
            raise AppError(403, "当前用户未加入任何机构。", error_code="membership_missing")

        return self._issue_session(
            user_id=user.id,
            organization_id=membership.organization_id,
            role=membership.role,
        )

    def send_email_login_code(self, payload: SendEmailCodeRequest) -> EmailOtpSendData:
        email = payload.email.strip().lower()
        user = self.users.get_by_email(email)
        if user and not user.is_active:
            raise AppError(403, "账号已停用。", error_code="account_disabled")

        now = utcnow()
        existing = self.email_otps.get_by_email(email)
        if existing:
            elapsed = (now - existing.sent_at).total_seconds()
            if elapsed < self.settings.email_otp_resend_seconds:
                remaining = max(1, int(self.settings.email_otp_resend_seconds - elapsed))
                raise AppError(
                    429,
                    f"发送过于频繁，请 {remaining} 秒后再试。",
                    error_code="otp_rate_limited",
                )

        code = f"{secrets.randbelow(900_000) + 100_000:06d}"
        code_hash = self._hash_email_otp(email, code)
        expires_at = now + timedelta(minutes=self.settings.email_otp_expires_minutes)

        self.email_otps.upsert(
            email=email,
            code_hash=code_hash,
            expires_at=expires_at,
            sent_at=now,
        )
        self.session.flush()

        try:
            send_login_otp_email(self.settings, to_email=email, code=code)
        except AppError:
            self.session.rollback()
            raise

        if user:
            membership = self.memberships.get_primary_for_user(user.id)
            self.audit_logs.create(
                organization_id=membership.organization_id if membership else None,
                actor_user_id=user.id,
                action="auth.email_otp.send",
                resource_type="user",
                resource_id=user.id,
                details={},
            )
        else:
            self.audit_logs.create(
                organization_id=None,
                actor_user_id=None,
                action="auth.email_otp.send",
                resource_type="email",
                resource_id=None,
                details={"email": email},
            )
        self.session.commit()
        return EmailOtpSendData(cooldown_seconds=self.settings.email_otp_resend_seconds)

    def login_with_email_code(self, payload: LoginWithEmailCodeRequest) -> AuthSessionData:
        email = payload.email.strip().lower()
        code = payload.code.strip()

        record = self.email_otps.get_by_email(email)
        now = utcnow()
        if not record or record.expires_at < now:
            raise AppError(401, "验证码已过期，请重新获取。", error_code="otp_expired")

        expect_hash = self._hash_email_otp(email, code)
        if not secrets.compare_digest(record.code_hash, expect_hash):
            raise AppError(401, "验证码错误。", error_code="invalid_otp")

        self.email_otps.delete(email)
        self.session.flush()

        user = self.users.get_by_email(email)
        if user:
            if not user.is_active:
                raise AppError(403, "账号已停用。", error_code="account_disabled")
            membership = self.memberships.get_primary_for_user(user.id)
            if not membership:
                raise AppError(403, "当前用户未加入任何机构。", error_code="membership_missing")
            return self._issue_session(
                user_id=user.id,
                organization_id=membership.organization_id,
                role=membership.role,
            )

        return self._provision_user_via_email_otp(email)

    def refresh(self, payload: RefreshRequest) -> AuthSessionData:
        record = self.refresh_tokens.get_active_by_hash(hash_refresh_token(payload.refresh_token))
        if not record:
            raise AppError(401, "刷新令牌无效或已失效。", error_code="invalid_refresh_token")

        membership = self.memberships.get_by_user_and_org(
            user_id=record.user_id,
            organization_id=record.organization_id,
        )
        if not membership:
            raise AppError(403, "当前刷新令牌缺少有效机构关系。", error_code="membership_missing")

        self.refresh_tokens.revoke(record)
        self.session.commit()
        return self._issue_session(
            user_id=record.user_id,
            organization_id=record.organization_id,
            role=membership.role,
        )

    def logout(self, refresh_token: str) -> None:
        record = self.refresh_tokens.get_active_by_hash(hash_refresh_token(refresh_token))
        if not record:
            raise AppError(401, "刷新令牌无效或已失效。", error_code="invalid_refresh_token")

        self.refresh_tokens.revoke(record)
        self.audit_logs.create(
            organization_id=record.organization_id,
            actor_user_id=record.user_id,
            action="auth.logout",
            resource_type="refresh_token",
            resource_id=record.id,
        )
        self.session.commit()

    def resolve_current_user(self, access_token: str) -> CurrentUserData:
        payload = decode_access_token(access_token, self.settings)
        user_id = str(payload.get("sub") or "").strip()
        organization_id = str(payload.get("organization_id") or "").strip()
        role = str(payload.get("role") or "member").strip() or "member"

        user = self.users.get_by_id(user_id)
        organization = self.organizations.get_by_id(organization_id)
        membership = self.memberships.get_by_user_and_org(
            user_id=user_id,
            organization_id=organization_id,
        )

        if not user or not user.is_active or not organization or not membership:
            raise AppError(401, "登录状态无效，请重新登录。", error_code="invalid_session")

        return CurrentUserData(
            user=UserView.model_validate(user),
            organization=OrganizationView.model_validate(organization),
            role=role,
        )

    def _issue_session(self, *, user_id: str, organization_id: str, role: str) -> AuthSessionData:
        user = self.users.get_by_id(user_id)
        organization = self.organizations.get_by_id(organization_id)
        if not user or not organization:
            raise AppError(500, "无法创建登录会话。", error_code="session_creation_failed")

        access_token = create_access_token(
            subject=user.id,
            organization_id=organization.id,
            role=role,
            settings=self.settings,
        )
        refresh_token = generate_refresh_token()
        refresh_token_hash = hash_refresh_token(refresh_token)
        expires_at = utcnow() + timedelta(days=self.settings.refresh_token_expires_days)
        self.refresh_tokens.create(
            user_id=user.id,
            organization_id=organization.id,
            token_hash=refresh_token_hash,
            expires_at=expires_at,
        )
        self.audit_logs.create(
            organization_id=organization.id,
            actor_user_id=user.id,
            action="auth.login",
            resource_type="user",
            resource_id=user.id,
            details={"role": role},
        )
        self.session.commit()
        return AuthSessionData(
            access_token=access_token,
            refresh_token=refresh_token,
            expires_in=self.settings.access_token_expires_minutes * 60,
            user=UserView.model_validate(user),
            organization=OrganizationView.model_validate(organization),
            role=role,
        )

    def _build_unique_org_slug(self, organization_name: str) -> str:
        base_slug = self._slugify(organization_name)
        slug = base_slug
        suffix = 1
        while self.organizations.get_by_slug(slug):
            suffix += 1
            slug = f"{base_slug}-{suffix}"
        return slug

    @staticmethod
    def _slugify(raw_name: str) -> str:
        ascii_only = raw_name.strip().lower()
        ascii_only = re.sub(r"[^a-z0-9]+", "-", ascii_only)
        ascii_only = ascii_only.strip("-")
        return ascii_only or f"org-{utcnow().strftime('%Y%m%d%H%M%S')}"

    def _hash_email_otp(self, email: str, code: str) -> str:
        key = self.settings.jwt_secret_key.encode("utf-8")
        msg = f"{email}\0{code}".encode("utf-8")
        return hmac.new(key, msg, hashlib.sha256).hexdigest()

    def _provision_user_via_email_otp(self, email: str) -> AuthSessionData:
        """验证码校验通过后，若邮箱尚无账号则自动注册默认机构（与产品「接码即登录」一致）。"""
        if self.users.get_by_email(email):
            raise AppError(409, "该邮箱已被注册。", error_code="email_exists")

        local = email.split("@")[0].strip() or "user"
        org_name = f"{local[:40]} 的工作区"
        organization = self.organizations.create(
            name=org_name,
            slug=self._build_unique_org_slug(org_name),
        )
        user = self.users.create(
            email=email,
            password_hash=hash_password(secrets.token_urlsafe(48)),
            display_name=None,
        )
        membership = self.memberships.create(
            organization_id=organization.id,
            user_id=user.id,
            role="owner",
        )
        self.audit_logs.create(
            organization_id=organization.id,
            actor_user_id=user.id,
            action="auth.register",
            resource_type="user",
            resource_id=user.id,
            details={"method": "email_otp"},
        )
        self._grant_signup_credits(organization.id)
        self.session.flush()
        return self._issue_session(
            user_id=user.id,
            organization_id=organization.id,
            role=membership.role,
        )