"""Add compressed CAD capability graph projections.

Revision ID: 20260829_0004
Revises: 20260828_0003
Create Date: 2026-08-29
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20260829_0004"
down_revision: str | Sequence[str] | None = "20260828_0003"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

SCHEMA = "ontology"


def upgrade() -> None:
    op.create_table(
        "capability_graph_snapshots",
        sa.Column("dataset_id", sa.Text(), nullable=False),
        sa.Column("scope_key", sa.Text(), nullable=False),
        sa.Column("surface", sa.Text(), nullable=True),
        sa.Column("observed_host_id", sa.Text(), nullable=True),
        sa.Column("content_sha256", sa.String(length=64), nullable=False),
        sa.Column("atom_count", sa.BigInteger(), nullable=False),
        sa.Column("payload_gzip", sa.LargeBinary(), nullable=False),
        sa.Column(
            "generated_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.PrimaryKeyConstraint("dataset_id", "scope_key"),
        sa.ForeignKeyConstraint(
            ["dataset_id"],
            [f"{SCHEMA}.dataset_builds.dataset_id"],
            name="fk_capability_graph_snapshots_dataset",
            ondelete="CASCADE",
        ),
        sa.CheckConstraint(
            "atom_count >= 0",
            name="ck_capability_graph_snapshots_atom_count",
        ),
        schema=SCHEMA,
    )
    op.create_index(
        "ix_capability_graph_snapshots_scope",
        "capability_graph_snapshots",
        ["dataset_id", "surface", "observed_host_id"],
        schema=SCHEMA,
    )


def downgrade() -> None:
    op.drop_table("capability_graph_snapshots", schema=SCHEMA)
