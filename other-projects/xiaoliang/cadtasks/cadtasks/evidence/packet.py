from __future__ import annotations

from dataclasses import dataclass
from typing import Iterable

from cadkernel.contracts import stable_id

from cadtasks.binding import ProjectFactBundle
from cadtasks.contracts import ID_LENGTH


@dataclass(frozen=True, slots=True)
class EvidencePacket:
    packet_id: str
    subject_ref: str
    evidence_refs: tuple[str, ...]
    source_snapshot_ids: tuple[str, ...]
    missing_refs: tuple[str, ...]

    @classmethod
    def create(
        cls,
        *,
        subject_ref: str,
        evidence_refs: Iterable[object],
        facts: ProjectFactBundle,
    ) -> "EvidencePacket":
        refs = tuple(sorted(set(str(item) for item in evidence_refs)))
        missing = tuple(ref for ref in refs if not facts.has_evidence(ref))
        snapshots = tuple(
            sorted(
                {
                    facts.occurrence_index[ref].snapshot_id
                    for ref in refs
                    if ref in facts.occurrence_index
                }
                | {
                    facts.semantic_evidence_index[ref].source_snapshot_id
                    for ref in refs
                    if ref in facts.semantic_evidence_index
                }
                | {
                    facts.detection_index[ref].instance.snapshot_id
                    for ref in refs
                    if ref in facts.detection_index
                }
                | {
                    bound.instance.snapshot_id
                    for ref in refs
                    for bound in facts.pattern_key_index.get(ref, ())
                }
                | {
                    facts.resolution_index[ref].representation.source_snapshot_id
                    for ref in refs
                    if ref in facts.resolution_index
                }
                | {
                    facts.face_index[ref].snapshot_id
                    for ref in refs
                    if ref in facts.face_index
                }
            )
        )
        digest = stable_id(
            "task-evidence-packet",
            subject_ref,
            refs,
            snapshots,
            missing,
            length=ID_LENGTH,
        )
        return cls(
            "evidence-packet:" + digest,
            str(subject_ref),
            refs,
            snapshots,
            missing,
        )
