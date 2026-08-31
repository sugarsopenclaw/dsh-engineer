"""Create topology semantic pattern, observation and description tables.

Revision ID: 20260831_0005
Revises: 20260829_0004
Create Date: 2026-08-31
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "20260831_0005"
down_revision: str | Sequence[str] | None = "20260829_0004"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

SCHEMA = "ontology"


def upgrade() -> None:
    op.create_table(
        "topology_patterns",
        sa.Column("pattern_id", sa.Text(), nullable=False),
        sa.Column("knowledge_scope", sa.Text(), nullable=False),
        sa.Column("fingerprint_schema_version", sa.Text(), nullable=False),
        sa.Column("scope_kind", sa.Text(), nullable=False),
        sa.Column("graph_hash", sa.String(length=64), nullable=False),
        sa.Column("shape_hash", sa.String(length=64), nullable=False),
        sa.Column("metric_hash", sa.String(length=64), nullable=False),
        sa.Column("invariances", postgresql.ARRAY(sa.Text()), nullable=False),
        sa.Column("feature_summary", postgresql.JSONB(none_as_null=True), nullable=False),
        sa.Column("canonical_payload", postgresql.JSONB(none_as_null=True), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.PrimaryKeyConstraint("pattern_id"),
        sa.UniqueConstraint(
            "knowledge_scope",
            "fingerprint_schema_version",
            "scope_kind",
            "graph_hash",
            "shape_hash",
            "metric_hash",
            name="uq_topology_patterns_fingerprint",
        ),
        schema=SCHEMA,
    )
    op.create_index(
        "ix_topology_patterns_shape_hash",
        "topology_patterns",
        ["knowledge_scope", "fingerprint_schema_version", "scope_kind", "shape_hash"],
        schema=SCHEMA,
    )
    op.create_index(
        "ix_topology_patterns_graph_hash",
        "topology_patterns",
        ["knowledge_scope", "fingerprint_schema_version", "scope_kind", "graph_hash"],
        schema=SCHEMA,
    )
    op.create_index(
        "ix_topology_patterns_metric_hash",
        "topology_patterns",
        ["knowledge_scope", "fingerprint_schema_version", "scope_kind", "metric_hash"],
        schema=SCHEMA,
    )

    op.create_table(
        "topology_observations",
        sa.Column("observation_id", sa.Text(), nullable=False),
        sa.Column("pattern_id", sa.Text(), nullable=False),
        sa.Column("knowledge_scope", sa.Text(), nullable=False),
        sa.Column("ingestion_key", sa.Text(), nullable=False),
        sa.Column("workflow_kind", sa.Text(), nullable=False),
        sa.Column("review_run_id", sa.Text(), nullable=False),
        sa.Column("group_id", sa.Text(), nullable=False),
        sa.Column("drawing", postgresql.JSONB(none_as_null=True), nullable=False),
        sa.Column("selection", postgresql.JSONB(none_as_null=True), nullable=False),
        sa.Column("plots", postgresql.JSONB(none_as_null=True), nullable=False),
        sa.Column("bom_context", postgresql.JSONB(none_as_null=True), nullable=False),
        sa.Column("capability_evidence", postgresql.JSONB(none_as_null=True), nullable=False),
        sa.Column("artifact_refs", postgresql.ARRAY(sa.Text()), nullable=False),
        sa.Column("provenance", postgresql.JSONB(none_as_null=True), nullable=False),
        sa.Column("payload_sha256", sa.String(length=64), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.PrimaryKeyConstraint("observation_id"),
        sa.ForeignKeyConstraint(
            ["pattern_id"],
            [f"{SCHEMA}.topology_patterns.pattern_id"],
            name="fk_topology_observations_pattern",
            ondelete="RESTRICT",
        ),
        sa.UniqueConstraint(
            "knowledge_scope",
            "ingestion_key",
            name="uq_topology_observations_ingestion_key",
        ),
        schema=SCHEMA,
    )
    op.create_index(
        "ix_topology_observations_pattern",
        "topology_observations",
        ["pattern_id", "created_at"],
        schema=SCHEMA,
    )
    op.create_index(
        "ix_topology_observations_review_run",
        "topology_observations",
        ["knowledge_scope", "review_run_id", "group_id"],
        schema=SCHEMA,
    )
    op.create_index(
        "ix_topology_observations_drawing",
        "topology_observations",
        ["drawing"],
        schema=SCHEMA,
        postgresql_using="gin",
    )

    op.create_table(
        "semantic_descriptions",
        sa.Column("description_id", sa.Text(), nullable=False),
        sa.Column("knowledge_scope", sa.Text(), nullable=False),
        sa.Column("description_key", sa.Text(), nullable=False),
        sa.Column("description_kind", sa.Text(), nullable=False),
        sa.Column("content_md", sa.Text(), nullable=False),
        sa.Column("structured_content", postgresql.JSONB(none_as_null=True), nullable=False),
        sa.Column("source_kind", sa.Text(), nullable=False),
        sa.Column("model_provenance", postgresql.JSONB(none_as_null=True), nullable=True),
        sa.Column("evidence_refs", postgresql.ARRAY(sa.Text()), nullable=False),
        sa.Column("supersedes_description_id", sa.Text(), nullable=True),
        sa.Column("content_sha256", sa.String(length=64), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.PrimaryKeyConstraint("description_id"),
        sa.ForeignKeyConstraint(
            ["supersedes_description_id"],
            [f"{SCHEMA}.semantic_descriptions.description_id"],
            name="fk_semantic_descriptions_supersedes",
            ondelete="SET NULL",
        ),
        sa.UniqueConstraint(
            "knowledge_scope",
            "description_key",
            name="uq_semantic_descriptions_key",
        ),
        schema=SCHEMA,
    )
    op.create_index(
        "ix_semantic_descriptions_kind",
        "semantic_descriptions",
        ["knowledge_scope", "description_kind", "created_at"],
        schema=SCHEMA,
    )
    op.create_index(
        "ix_semantic_descriptions_structured",
        "semantic_descriptions",
        ["structured_content"],
        schema=SCHEMA,
        postgresql_using="gin",
    )

    op.create_table(
        "topology_semantic_links",
        sa.Column("link_id", sa.Text(), nullable=False),
        sa.Column("pattern_id", sa.Text(), nullable=False),
        sa.Column("observation_id", sa.Text(), nullable=False),
        sa.Column("description_id", sa.Text(), nullable=False),
        sa.Column("relation_kind", sa.Text(), nullable=False),
        sa.Column("link_context", postgresql.JSONB(none_as_null=True), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.PrimaryKeyConstraint("link_id"),
        sa.ForeignKeyConstraint(
            ["pattern_id"],
            [f"{SCHEMA}.topology_patterns.pattern_id"],
            name="fk_topology_semantic_links_pattern",
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["observation_id"],
            [f"{SCHEMA}.topology_observations.observation_id"],
            name="fk_topology_semantic_links_observation",
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["description_id"],
            [f"{SCHEMA}.semantic_descriptions.description_id"],
            name="fk_topology_semantic_links_description",
            ondelete="CASCADE",
        ),
        sa.UniqueConstraint(
            "pattern_id",
            "observation_id",
            "description_id",
            "relation_kind",
            name="uq_topology_semantic_links_relation",
        ),
        schema=SCHEMA,
    )
    op.create_index(
        "ix_topology_semantic_links_description",
        "topology_semantic_links",
        ["description_id", "pattern_id"],
        schema=SCHEMA,
    )


def downgrade() -> None:
    op.drop_table("topology_semantic_links", schema=SCHEMA)
    op.drop_table("semantic_descriptions", schema=SCHEMA)
    op.drop_table("topology_observations", schema=SCHEMA)
    op.drop_table("topology_patterns", schema=SCHEMA)
