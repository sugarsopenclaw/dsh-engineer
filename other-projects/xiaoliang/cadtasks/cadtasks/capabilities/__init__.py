from cadtasks.capabilities.kernel import register_kernel_capabilities
from cadtasks.capabilities.pattern import register_pattern_capabilities
from cadtasks.capabilities.registry import (
    CapabilityOutcome,
    CapabilityRegistry,
    CapabilitySpec,
    outcome_from_op_result,
)
from cadtasks.capabilities.semantic import register_semantic_capabilities


def create_builtin_capability_registry() -> CapabilityRegistry:
    registry = CapabilityRegistry()
    register_kernel_capabilities(registry)
    register_pattern_capabilities(registry)
    register_semantic_capabilities(registry)
    return registry


__all__ = [
    "CapabilityOutcome",
    "CapabilityRegistry",
    "CapabilitySpec",
    "create_builtin_capability_registry",
    "outcome_from_op_result",
    "register_kernel_capabilities",
    "register_pattern_capabilities",
    "register_semantic_capabilities",
]

