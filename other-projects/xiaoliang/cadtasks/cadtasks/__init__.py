"""Evidence-grounded engineering task compilation and execution."""

from cadtasks.binding import ProjectBinding, ProjectFactBundle, ProjectSource
from cadtasks.contracts import (
    Artifact,
    AuditIssue,
    CapabilityGap,
    Claim,
    QuantityBasis,
    TaskResultBundle,
    TaskScope,
    TaskSpec,
    TaskStatus,
    TaskTarget,
    TaskType,
)
from cadtasks.runtime import TaskRuntime
from cadtasks.storage import TaskStore

__version__ = "0.1.0"

__all__ = [
    "Artifact",
    "AuditIssue",
    "CapabilityGap",
    "Claim",
    "ProjectBinding",
    "ProjectFactBundle",
    "ProjectSource",
    "QuantityBasis",
    "TaskResultBundle",
    "TaskRuntime",
    "TaskScope",
    "TaskSpec",
    "TaskStatus",
    "TaskStore",
    "TaskTarget",
    "TaskType",
]
