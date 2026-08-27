"""Ensure one position per graph view and node.

Revision ID: 20260827_0002
Revises: 20260827_0001
Create Date: 2026-08-27
"""

from collections.abc import Sequence

from alembic import op

revision: str = "20260827_0002"
down_revision: str | Sequence[str] | None = "20260827_0001"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_unique_constraint(
        "uq_graph_layout_positions_view_node",
        "graph_layout_positions",
        ["dataset_id", "graph_view_id", "node_kind", "node_id"],
        schema="ontology",
    )


def downgrade() -> None:
    op.drop_constraint(
        "uq_graph_layout_positions_view_node",
        "graph_layout_positions",
        schema="ontology",
        type_="unique",
    )
