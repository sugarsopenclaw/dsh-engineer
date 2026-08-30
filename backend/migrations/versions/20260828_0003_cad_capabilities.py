"""Create CAD capability inventory and atom materialization tables.

Revision ID: 20260828_0003
Revises: 20260827_0002
Create Date: 2026-08-28
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "20260828_0003"
down_revision: str | Sequence[str] | None = "20260827_0002"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

SCHEMA = "ontology"


def upgrade() -> None:
    op.create_table(
        "capability_inventories",
        sa.Column("dataset_id", sa.Text(), nullable=False),
        sa.Column("inventory_id", sa.Text(), nullable=False),
        sa.Column("schema_version", sa.Text(), nullable=False),
        sa.Column("surface", sa.Text(), nullable=False),
        sa.Column("observed_host_id", sa.Text(), nullable=False),
        sa.Column("captured_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("extractor", postgresql.JSONB(none_as_null=True), nullable=False),
        sa.Column("source_artifacts", postgresql.JSONB(none_as_null=True), nullable=False),
        sa.Column("atoms_sha256", sa.String(length=64), nullable=False),
        sa.Column("counts", postgresql.JSONB(none_as_null=True), nullable=False),
        sa.Column(
            "classification_counts",
            postgresql.JSONB(none_as_null=True),
            nullable=False,
        ),
        sa.PrimaryKeyConstraint("dataset_id", "inventory_id"),
        sa.ForeignKeyConstraint(
            ["dataset_id"],
            [f"{SCHEMA}.dataset_builds.dataset_id"],
            name="fk_capability_inventories_dataset",
            ondelete="CASCADE",
        ),
        schema=SCHEMA,
    )
    op.create_index(
        "ix_capability_inventories_surface_host",
        "capability_inventories",
        ["dataset_id", "surface", "observed_host_id"],
        schema=SCHEMA,
    )

    op.create_table(
        "capability_atoms",
        sa.Column("dataset_id", sa.Text(), nullable=False),
        sa.Column("atom_id", sa.Text(), nullable=False),
        sa.Column("inventory_id", sa.Text(), nullable=False),
        sa.Column("schema_version", sa.Text(), nullable=False),
        sa.Column("canonical_key", sa.Text(), nullable=False),
        sa.Column("surface", sa.Text(), nullable=False),
        sa.Column("atom_kind", sa.Text(), nullable=False),
        sa.Column(
            "observed_host_ids",
            postgresql.ARRAY(sa.Text()),
            nullable=False,
        ),
        sa.Column("source_artifact", postgresql.JSONB(none_as_null=True), nullable=False),
        sa.Column("declaring_symbol", postgresql.JSONB(none_as_null=True), nullable=True),
        sa.Column("declaring_symbol_full_name", sa.Text(), nullable=True),
        sa.Column("member", postgresql.JSONB(none_as_null=True), nullable=False),
        sa.Column("member_name", sa.Text(), nullable=False),
        sa.Column("member_signature", sa.Text(), nullable=False),
        sa.Column("return_type", sa.Text(), nullable=True),
        sa.Column("is_static", sa.Boolean(), nullable=False),
        sa.Column("provenance", postgresql.JSONB(none_as_null=True), nullable=False),
        sa.Column("surface_metadata", postgresql.JSONB(none_as_null=True), nullable=False),
        sa.Column("classification_status", sa.Text(), nullable=False),
        sa.Column("operation_kinds", postgresql.ARRAY(sa.Text()), nullable=False),
        sa.Column("domain_tags", postgresql.ARRAY(sa.Text()), nullable=False),
        sa.Column("summary", sa.Text(), nullable=True),
        sa.Column("classification_confidence", sa.Float(), nullable=True),
        sa.Column(
            "semantic_candidates",
            postgresql.JSONB(none_as_null=True),
            nullable=False,
        ),
        sa.Column("evidence", postgresql.JSONB(none_as_null=True), nullable=False),
        sa.Column("processor", postgresql.JSONB(none_as_null=True), nullable=True),
        sa.Column("processed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.PrimaryKeyConstraint("dataset_id", "atom_id"),
        sa.ForeignKeyConstraint(
            ["dataset_id", "inventory_id"],
            [
                f"{SCHEMA}.capability_inventories.dataset_id",
                f"{SCHEMA}.capability_inventories.inventory_id",
            ],
            name="fk_capability_atoms_inventory",
            ondelete="CASCADE",
            deferrable=True,
            initially="DEFERRED",
        ),
        sa.CheckConstraint(
            "classification_status IN ('classified', 'deferred', 'failed', 'pending')",
            name="ck_capability_atoms_classification_status",
        ),
        schema=SCHEMA,
    )
    op.create_index(
        "ix_capability_atoms_surface",
        "capability_atoms",
        ["dataset_id", "surface", "atom_id"],
        schema=SCHEMA,
    )
    op.create_index(
        "ix_capability_atoms_kind",
        "capability_atoms",
        ["dataset_id", "atom_kind", "atom_id"],
        schema=SCHEMA,
    )
    op.create_index(
        "ix_capability_atoms_status",
        "capability_atoms",
        ["dataset_id", "classification_status", "atom_id"],
        schema=SCHEMA,
    )
    op.create_index(
        "ix_capability_atoms_member_name",
        "capability_atoms",
        ["dataset_id", "member_name"],
        schema=SCHEMA,
    )
    op.create_index(
        "ix_capability_atoms_observed_hosts",
        "capability_atoms",
        ["observed_host_ids"],
        schema=SCHEMA,
        postgresql_using="gin",
    )
    op.create_index(
        "ix_capability_atoms_operation_kinds",
        "capability_atoms",
        ["operation_kinds"],
        schema=SCHEMA,
        postgresql_using="gin",
    )
    op.create_index(
        "ix_capability_atoms_domain_tags",
        "capability_atoms",
        ["domain_tags"],
        schema=SCHEMA,
        postgresql_using="gin",
    )


def downgrade() -> None:
    op.drop_table("capability_atoms", schema=SCHEMA)
    op.drop_table("capability_inventories", schema=SCHEMA)
