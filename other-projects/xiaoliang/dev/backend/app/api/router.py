from __future__ import annotations

from fastapi import APIRouter

from app.api.routes.agent_gateway import router as agent_gateway_router
from app.api.routes.agent_feedback import router as agent_feedback_router
from app.api.routes.agent_usage import router as agent_usage_router
from app.api.routes.auth import router as auth_router
from app.api.routes.billing import router as billing_router
from app.api.routes.client_releases import router as client_releases_router
from app.api.routes.conversation_title import router as conversation_title_router
from app.api.routes.desktop_updates import router as desktop_updates_router
from app.api.routes.health import router as health_router
from app.api.routes.project_archive import router as project_archive_router
from app.api.routes.prompt_templates import router as prompt_templates_router
from app.api.routes.runtime_assets import router as runtime_assets_router
from app.api.routes.subagent_trace import router as subagent_trace_router
from app.api.routes.skills import router as skills_router
from app.api.routes.speech import router as speech_router
from app.api.routes.user_skill_archive import router as user_skill_archive_router
from app.api.routes.users import router as users_router
from app.api.routes.web import router as web_router

api_router = APIRouter()
api_router.include_router(health_router)
api_router.include_router(auth_router)
api_router.include_router(users_router)
api_router.include_router(agent_usage_router)
api_router.include_router(agent_feedback_router)
api_router.include_router(billing_router)
api_router.include_router(agent_gateway_router)
api_router.include_router(conversation_title_router)
api_router.include_router(client_releases_router)
api_router.include_router(desktop_updates_router)
api_router.include_router(runtime_assets_router)
api_router.include_router(skills_router)
api_router.include_router(speech_router)
api_router.include_router(project_archive_router)
api_router.include_router(user_skill_archive_router)
api_router.include_router(prompt_templates_router)
api_router.include_router(subagent_trace_router)
api_router.include_router(web_router)
