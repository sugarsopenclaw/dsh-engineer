from __future__ import annotations

from typing import Any, Mapping

from cadtasks.contracts import TraceRecord


class TraceBuilder:
    """Deterministic ordinal trace; elapsed timings stay outside result identity."""

    def __init__(self, task_run_id: str) -> None:
        self.task_run_id = task_run_id
        self._records: list[TraceRecord] = []

    def add(
        self,
        *,
        phase: str,
        subject_ref: str,
        status: str,
        message: str,
        details: Mapping[str, Any] | tuple[tuple[str, Any], ...] = (),
    ) -> TraceRecord:
        record = TraceRecord.create(
            task_run_id=self.task_run_id,
            ordinal=len(self._records),
            phase=phase,
            subject_ref=subject_ref,
            status=status,
            message=message,
            details=details,
        )
        self._records.append(record)
        return record

    @property
    def records(self) -> tuple[TraceRecord, ...]:
        return tuple(self._records)
