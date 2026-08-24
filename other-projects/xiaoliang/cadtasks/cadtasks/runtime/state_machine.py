from __future__ import annotations

from dataclasses import dataclass

from cadtasks.contracts import TaskStatus


_ALLOWED = {
    TaskStatus.RECEIVED: {TaskStatus.SPECIFIED, TaskStatus.CANCELLED, TaskStatus.FAILED},
    TaskStatus.SPECIFIED: {
        TaskStatus.PREFLIGHTED,
        TaskStatus.BLOCKED,
        TaskStatus.UNSUPPORTED,
        TaskStatus.FAILED,
        TaskStatus.CANCELLED,
    },
    TaskStatus.PREFLIGHTED: {
        TaskStatus.PLANNED,
        TaskStatus.BLOCKED,
        TaskStatus.UNSUPPORTED,
        TaskStatus.FAILED,
        TaskStatus.CANCELLED,
    },
    TaskStatus.PLANNED: {
        TaskStatus.RUNNING,
        TaskStatus.BLOCKED,
        TaskStatus.FAILED,
        TaskStatus.CANCELLED,
    },
    TaskStatus.RUNNING: {
        TaskStatus.VALIDATING,
        TaskStatus.FAILED,
        TaskStatus.CANCELLED,
    },
    TaskStatus.VALIDATING: {
        TaskStatus.COMPLETED,
        TaskStatus.PARTIAL,
        TaskStatus.REVIEW_REQUIRED,
        TaskStatus.BLOCKED,
        TaskStatus.UNSUPPORTED,
        TaskStatus.FAILED,
        TaskStatus.CANCELLED,
    },
}


@dataclass(frozen=True, slots=True)
class StateTransition:
    ordinal: int
    previous: TaskStatus
    current: TaskStatus
    reason: str


class TaskStateMachine:
    def __init__(self) -> None:
        self._status = TaskStatus.RECEIVED
        self._transitions: list[StateTransition] = []

    @property
    def status(self) -> TaskStatus:
        return self._status

    @property
    def transitions(self) -> tuple[StateTransition, ...]:
        return tuple(self._transitions)

    def transition(self, status: TaskStatus, *, reason: str) -> StateTransition:
        allowed = _ALLOWED.get(self._status, set())
        if status not in allowed:
            raise RuntimeError(
                f"Invalid task transition: {self._status.value} -> {status.value}"
            )
        event = StateTransition(
            len(self._transitions),
            self._status,
            status,
            str(reason),
        )
        self._transitions.append(event)
        self._status = status
        return event

