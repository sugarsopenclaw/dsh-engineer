from __future__ import annotations

from typing import Any

from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.errors import AppError
from app.core.security import utcnow
from app.domain.billing.policies import ensure_utc
from app.models.agent_usage import (
    AgentUsageBreakdownView,
    AgentUsageCallView,
    AgentUsageRunFinishRequest,
    AgentUsageRunDetailView,
    AgentUsageRunStartRequest,
    AgentUsageRunView,
    AgentUsageTokenTotals,
)
from app.models.user import CurrentUserData
from app.repositories.agent_usage_call_repository import AgentUsageCallRepository
from app.repositories.agent_usage_run_repository import AgentUsageRunRepository
from app.schemas.agent_usage_call import AgentUsageCall
from app.schemas.agent_usage_run import AgentUsageRun
from app.services.billing.credit_ledger_service import CreditLedgerService


def run_to_view(run: AgentUsageRun) -> AgentUsageRunView:
    return AgentUsageRunView(
        id=run.id,
        organization_id=run.organization_id,
        user_id=run.user_id,
        client_run_id=run.client_run_id,
        source=run.source,
        status=run.status,
        local_conversation_id=run.local_conversation_id,
        task_preview=run.task_preview,
        original_question=run.original_question,
        final_answer=run.final_answer,
        started_at=run.started_at,
        ended_at=run.ended_at,
        duration_ms=run.duration_ms,
        error_message=run.error_message,
    )


def call_to_view(call: AgentUsageCall) -> AgentUsageCallView:
    return AgentUsageCallView(
        id=call.id,
        child_run_id=call.child_run_id,
        call_purpose=call.call_purpose,
        model_alias=call.model_alias,
        provider_model=call.provider_model,
        status=call.status,  # type: ignore[arg-type]
        started_at=call.started_at,
        ended_at=call.ended_at,
        duration_ms=call.duration_ms,
        input_tokens=call.input_tokens,
        output_tokens=call.output_tokens,
        cache_read_tokens=call.cache_read_tokens,
        cache_write_tokens=call.cache_write_tokens,
        reasoning_tokens=call.reasoning_tokens,
        total_tokens=call.total_tokens,
        image_count=call.image_count,
        error_code=call.error_code,
    )


def _safe_counter(value: Any) -> int:
    if isinstance(value, bool):
        return 0
    try:
        return max(0, int(value or 0))
    except (TypeError, ValueError, OverflowError):
        return 0


def normalize_gateway_usage(payload: Any) -> AgentUsageTokenTotals:
    usage = payload if isinstance(payload, dict) else {}
    prompt_details = usage.get("prompt_tokens_details")
    completion_details = usage.get("completion_tokens_details")
    prompt_details = prompt_details if isinstance(prompt_details, dict) else {}
    completion_details = completion_details if isinstance(completion_details, dict) else {}
    input_tokens = _safe_counter(
        usage.get("prompt_tokens", usage.get("input_tokens", usage.get("input", 0)))
    )
    output_tokens = _safe_counter(
        usage.get("completion_tokens", usage.get("output_tokens", usage.get("output", 0)))
    )
    cache_read_tokens = _safe_counter(
        prompt_details.get(
            "cached_tokens",
            usage.get("cache_read_tokens", usage.get("cache_read", 0)),
        )
    )
    cache_write_tokens = _safe_counter(
        prompt_details.get(
            "cache_write_tokens",
            usage.get("cache_write_tokens", usage.get("cache_write", 0)),
        )
    )
    reasoning_tokens = _safe_counter(
        completion_details.get("reasoning_tokens", usage.get("reasoning_tokens", 0))
    )
    total_tokens = _safe_counter(usage.get("total_tokens", usage.get("total", 0)))
    if total_tokens == 0:
        total_tokens = input_tokens + output_tokens
    return AgentUsageTokenTotals(
        input_tokens=input_tokens,
        output_tokens=output_tokens,
        cache_read_tokens=cache_read_tokens,
        cache_write_tokens=cache_write_tokens,
        reasoning_tokens=reasoning_tokens,
        total_tokens=total_tokens,
        image_count=0,
    )


class AgentUsageService:
    def __init__(self, session: Session) -> None:
        self.session = session
        self.runs = AgentUsageRunRepository(session)
        self.calls = AgentUsageCallRepository(session)
        self.ledger = CreditLedgerService(session)

    def start_run(
        self,
        current_user: CurrentUserData,
        payload: AgentUsageRunStartRequest,
    ) -> AgentUsageRunView:
        organization_id = current_user.organization.id
        existing = self.runs.get_by_client_run_id(organization_id, payload.client_run_id)
        if existing is not None:
            if existing.original_question is None and payload.original_question is not None:
                existing.original_question = payload.original_question
                self.session.commit()
                self.session.refresh(existing)
            return run_to_view(existing)

        now = ensure_utc(payload.started_at or utcnow())
        # Starting a run is free; credits are charged per model call from the
        # provider's reported token usage.
        self.ledger.assert_can_spend(organization_id, now)
        run = AgentUsageRun(
            organization_id=organization_id,
            user_id=current_user.user.id,
            client_run_id=payload.client_run_id,
            source=payload.source,
            status="started",
            local_conversation_id=payload.local_conversation_id,
            task_preview=payload.task_preview,
            original_question=payload.original_question,
            started_at=now,
        )
        try:
            self.runs.add(run)
            self.session.commit()
        except IntegrityError:
            self.session.rollback()
            existing = self.runs.get_by_client_run_id(organization_id, payload.client_run_id)
            if existing is None:
                raise
            return run_to_view(existing)

        self.session.refresh(run)
        return run_to_view(run)

    def finish_run(
        self,
        current_user: CurrentUserData,
        client_run_id: str,
        payload: AgentUsageRunFinishRequest,
    ) -> AgentUsageRunView:
        run = self.runs.get_by_client_run_id(current_user.organization.id, client_run_id.strip())
        if run is None or run.user_id != current_user.user.id:
            raise AppError(404, "Agent run 不存在。", error_code="agent_run_not_found")

        if run.status != "started":
            return run_to_view(run)

        ended_at = ensure_utc(payload.ended_at or utcnow())
        started_at = ensure_utc(run.started_at)
        duration_ms = max(0, int((ended_at - started_at).total_seconds() * 1000))
        run.status = payload.status
        run.ended_at = ended_at
        run.duration_ms = duration_ms
        run.error_message = payload.error_message
        if payload.status == "completed":
            run.final_answer = payload.final_answer
        self.session.commit()
        self.session.refresh(run)
        return run_to_view(run)

    def get_started_run(self, organization_id: str, client_run_id: str) -> AgentUsageRun | None:
        run = self.runs.get_by_client_run_id(organization_id, client_run_id)
        if run is None or run.status != "started":
            return None
        return run

    def assert_active_run(self, organization_id: str, client_run_id: str) -> AgentUsageRun:
        run = self.get_started_run(organization_id, (client_run_id or "").strip())
        if run is None:
            raise AppError(
                403,
                "模型网关要求有效的 agent run 绑定，请从客户端正常发送消息。",
                error_code="agent_run_required",
            )
        return run

    def start_gateway_call(
        self,
        run: AgentUsageRun,
        *,
        child_run_id: str | None,
        call_purpose: str,
        model_alias: str,
        provider_model: str,
        image_count: int,
    ) -> AgentUsageCall:
        call = AgentUsageCall(
            agent_run_id=run.id,
            organization_id=run.organization_id,
            user_id=run.user_id,
            client_run_id=run.client_run_id,
            child_run_id=child_run_id,
            call_purpose=call_purpose,
            model_alias=model_alias[:128],
            provider_model=provider_model[:128],
            status="started",
            started_at=utcnow(),
            image_count=max(0, image_count),
        )
        self.calls.add(call)
        self.session.commit()
        self.session.refresh(call)
        return call

    def finish_gateway_call(
        self,
        call_id: str,
        *,
        status: str,
        usage: Any = None,
        error_code: str | None = None,
    ) -> AgentUsageCall | None:
        call = self.calls.get_by_id(call_id)
        if call is None:
            return None
        if call.status != "started":
            return call
        ended_at = utcnow()
        started_at = ensure_utc(call.started_at)
        counters = normalize_gateway_usage(usage)
        call.status = status if status in {"completed", "stopped", "failed"} else "failed"
        call.ended_at = ended_at
        call.duration_ms = max(0, int((ended_at - started_at).total_seconds() * 1000))
        call.input_tokens = counters.input_tokens
        call.output_tokens = counters.output_tokens
        call.cache_read_tokens = counters.cache_read_tokens
        call.cache_write_tokens = counters.cache_write_tokens
        call.reasoning_tokens = counters.reasoning_tokens
        call.total_tokens = counters.total_tokens
        call.error_code = (error_code or "").strip()[:128] or None
        self.session.flush()

        # Charge whatever the provider actually billed us for. A call that
        # reported no usage (hard failure, or a stream that died before the
        # final usage chunk) is free.
        self.ledger.spend_usage(
            organization_id=call.organization_id,
            actor_user_id=call.user_id,
            entrypoint=f"gateway.{call.call_purpose}",
            idempotency_key=f"gateway_call:{call.id}",
            input_tokens=counters.input_tokens,
            output_tokens=counters.output_tokens,
            cache_read_tokens=counters.cache_read_tokens,
            cache_write_tokens=counters.cache_write_tokens,
            provider_model=call.provider_model,
            agent_usage_call_id=call.id,
            now=ended_at,
        )
        self.session.commit()
        self.session.refresh(call)
        return call

    def get_run_detail(
        self,
        current_user: CurrentUserData,
        client_run_id: str,
        *,
        limit: int = 200,
    ) -> AgentUsageRunDetailView:
        run = self.runs.get_by_client_run_id(current_user.organization.id, client_run_id.strip())
        if run is None or run.user_id != current_user.user.id:
            raise AppError(404, "Agent run 不存在。", error_code="agent_run_not_found")
        bounded_limit = max(1, min(500, int(limit)))
        calls = self.calls.list_for_run(run.id, bounded_limit)
        call_count = self.calls.count_for_run(run.id)
        totals_row = self.calls.totals_for_run(run.id)
        totals = AgentUsageTokenTotals(
            input_tokens=totals_row[0],
            output_tokens=totals_row[1],
            cache_read_tokens=totals_row[2],
            cache_write_tokens=totals_row[3],
            reasoning_tokens=totals_row[4],
            total_tokens=totals_row[5],
            image_count=totals_row[6],
        )
        breakdown = [
            AgentUsageBreakdownView(
                call_purpose=row[0],
                child_run_id=row[1],
                call_count=row[2],
                input_tokens=row[3],
                output_tokens=row[4],
                cache_read_tokens=row[5],
                cache_write_tokens=row[6],
                reasoning_tokens=row[7],
                total_tokens=row[8],
                image_count=row[9],
            )
            for row in self.calls.breakdown_for_run(run.id)
        ]
        return AgentUsageRunDetailView(
            run=run_to_view(run),
            call_count=call_count,
            totals=totals,
            credits_charged=self.ledger.charges.credits_for_agent_run(run.id),
            breakdown=breakdown,
            calls=[call_to_view(call) for call in calls],
            truncated=call_count > len(calls),
        )
