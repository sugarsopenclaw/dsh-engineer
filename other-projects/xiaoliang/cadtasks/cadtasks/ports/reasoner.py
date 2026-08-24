from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Protocol


@dataclass(frozen=True, slots=True)
class ReasoningResult:
    assertions: tuple[Any, ...]
    abstention_reason: str | None


class EvidenceReasonerPort(Protocol):
    reasoner_version: str

    def reason(self, packet: Any) -> ReasoningResult: ...


class AbstainingEvidenceReasoner:
    reasoner_version = "abstaining-evidence-reasoner:1.0.0"

    def reason(self, packet: Any) -> ReasoningResult:
        del packet
        return ReasoningResult(
            (),
            "The deterministic default reasoner does not add inferred claims.",
        )

