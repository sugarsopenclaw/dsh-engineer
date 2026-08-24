from __future__ import annotations

from cadtasks.blocks.registry import (
    BlockContext,
    TaskBlockRegistry,
    TaskBlockSpec,
    TaskWorkState,
)


def resolve_scope(context: BlockContext, state: TaskWorkState) -> TaskWorkState:
    return state.with_scope(context.scope_resolver.resolve(context.spec, context.facts))


def preserve_state(context: BlockContext, state: TaskWorkState) -> TaskWorkState:
    del context
    return state


def register_common_blocks(registry: TaskBlockRegistry) -> None:
    registry.register(
        TaskBlockSpec(
            "scope.resolve",
            "1.0.0",
            "resolve",
            "task_work_state",
            "task_work_state",
            (),
            "read",
            "memory",
            True,
        ),
        resolve_scope,
    )
    for block_id, stage in (
        ("result.decide", "decide"),
        ("artifact.read_only", "act"),
        ("result.validate", "validate"),
    ):
        registry.register(
            TaskBlockSpec(
                block_id,
                "1.0.0",
                stage,
                "task_work_state",
                "task_work_state",
                (),
                "read",
                "memory",
                True,
            ),
            preserve_state,
        )

