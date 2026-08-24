from __future__ import annotations

from typing import Annotated

from fastapi import Depends
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.database import get_db_session, session_scope
from app.core.errors import AppError
from app.models.user import CurrentUserData
from app.services.agent_gateway_service import AgentGatewayService
from app.services.agent_feedback_service import AgentFeedbackService
from app.services.agent_usage_service import AgentUsageService
from app.services.auth_service import AuthService
from app.services.billing.billing_service import BillingService
from app.services.billing.credit_ledger_service import CreditLedgerService
from app.services.bocha_search_service import BochaSearchService
from app.services.desktop_update_service import DesktopUpdateService
from app.services.conversation_title_service import ConversationTitleService
from app.services.project_archive_service import ProjectArchiveService
from app.services.prompt_template_service import PromptTemplateService
from app.services.subagent_trace_service import SubagentTraceService
from app.services.skill_service import SkillService
from app.services.speech_service import QwenAsrService
from app.services.user_skill_archive_service import UserSkillArchiveService
from app.services.web_search_service import WebSearchService

bearer_scheme = HTTPBearer(auto_error=False)
DbSession = Annotated[Session, Depends(get_db_session)]


def get_auth_service(session: DbSession) -> AuthService:
    return AuthService(session)


def get_skill_service(session: DbSession) -> SkillService:
    return SkillService(session)


def get_qwen_asr_service() -> QwenAsrService:
    return QwenAsrService(get_settings())


def get_desktop_update_service(session: DbSession) -> DesktopUpdateService:
    return DesktopUpdateService(session)


def get_project_archive_service(session: DbSession) -> ProjectArchiveService:
    return ProjectArchiveService(get_settings(), session)


def get_prompt_template_service(session: DbSession) -> PromptTemplateService:
    return PromptTemplateService(get_settings(), session)


def get_subagent_trace_service(session: DbSession) -> SubagentTraceService:
    return SubagentTraceService(get_settings(), session)


def get_user_skill_archive_service(session: DbSession) -> UserSkillArchiveService:
    return UserSkillArchiveService(get_settings(), session)


def get_web_search_service() -> WebSearchService:
    return WebSearchService(get_settings())


def get_bocha_search_service() -> BochaSearchService:
    return BochaSearchService(get_settings())


def get_billing_service(session: DbSession) -> BillingService:
    return BillingService(session)


def get_credit_ledger_service(session: DbSession) -> CreditLedgerService:
    return CreditLedgerService(session)


def get_agent_usage_service(session: DbSession) -> AgentUsageService:
    return AgentUsageService(session)


def get_agent_feedback_service(session: DbSession) -> AgentFeedbackService:
    return AgentFeedbackService(session)


def get_agent_gateway_service() -> AgentGatewayService:
    return AgentGatewayService(get_settings())


def get_conversation_title_service() -> ConversationTitleService:
    return ConversationTitleService(get_settings())


def get_current_user(
    credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(bearer_scheme)],
    auth_service: Annotated[AuthService, Depends(get_auth_service)],
) -> CurrentUserData:
    if credentials is None or credentials.scheme.lower() != "bearer":
        raise AppError(401, "缺少访问令牌。", error_code="missing_token")
    return auth_service.resolve_current_user(credentials.credentials)


def get_current_user_detached(
    credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(bearer_scheme)],
) -> CurrentUserData:
    if credentials is None or credentials.scheme.lower() != "bearer":
        raise AppError(401, "缺少访问令牌。", error_code="missing_token")
    with session_scope() as session:
        return AuthService(session).resolve_current_user(credentials.credentials)
