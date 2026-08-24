from cadtasks.blocks.audit import register_audit_blocks
from cadtasks.blocks.common import register_common_blocks
from cadtasks.blocks.count import register_count_blocks
from cadtasks.blocks.query import register_query_blocks
from cadtasks.blocks.registry import (
    BlockContext,
    TaskBlockRegistry,
    TaskBlockSpec,
    TaskWorkState,
)


def create_builtin_block_registry() -> TaskBlockRegistry:
    registry = TaskBlockRegistry()
    register_common_blocks(registry)
    register_query_blocks(registry)
    register_count_blocks(registry)
    register_audit_blocks(registry)
    return registry


__all__ = [
    "BlockContext",
    "TaskBlockRegistry",
    "TaskBlockSpec",
    "TaskWorkState",
    "create_builtin_block_registry",
    "register_audit_blocks",
    "register_common_blocks",
    "register_count_blocks",
    "register_query_blocks",
]

