"""Create the versioned business ontology materialization tables.

Revision ID: 20260827_0001
Revises:
Create Date: 2026-08-27
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "20260827_0001"
down_revision: str | Sequence[str] | None = None
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

SCHEMA = "ontology"


def dataset_column() -> sa.Column[str]:
    return sa.Column("dataset_id", sa.Text(), nullable=False)


def dataset_fk(name: str) -> sa.ForeignKeyConstraint:
    return sa.ForeignKeyConstraint(
        ["dataset_id"],
        [f"{SCHEMA}.dataset_builds.dataset_id"],
        name=name,
        ondelete="CASCADE",
    )


def entity_fk(
    local_column: str,
    remote_table: str,
    remote_column: str,
    name: str,
    *,
    ondelete: str | None = "CASCADE",
) -> sa.ForeignKeyConstraint:
    return sa.ForeignKeyConstraint(
        ["dataset_id", local_column],
        [f"{SCHEMA}.{remote_table}.dataset_id", f"{SCHEMA}.{remote_table}.{remote_column}"],
        name=name,
        ondelete=ondelete,
        deferrable=True,
        initially="DEFERRED",
    )


def upgrade() -> None:
    op.execute(f"CREATE SCHEMA IF NOT EXISTS {SCHEMA}")

    op.create_table(
        "dataset_builds",
        sa.Column("dataset_id", sa.Text(), primary_key=True),
        sa.Column("schema_version", sa.Text(), nullable=False),
        sa.Column("build_status", sa.Text(), nullable=False),
        sa.Column("content_sha256", sa.String(length=64), nullable=False),
        sa.Column("source_directory", sa.Text(), nullable=False),
        sa.Column(
            "manifest",
            postgresql.JSONB(none_as_null=True),
            nullable=False,
        ),
        sa.Column(
            "imported_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        schema=SCHEMA,
    )

    op.create_table(
        "source_documents",
        dataset_column(),
        sa.Column("source_document_id", sa.Text(), nullable=False),
        sa.Column("name", sa.Text(), nullable=False),
        sa.Column("source_kind", sa.Text(), nullable=False),
        sa.Column("storage_ref", sa.Text(), nullable=False),
        sa.Column("sha256", sa.String(length=64), nullable=False),
        sa.Column("authority_rank", sa.Integer(), nullable=False),
        sa.Column("parent_source_document_id", sa.Text(), nullable=True),
        sa.PrimaryKeyConstraint("dataset_id", "source_document_id"),
        dataset_fk("fk_source_documents_dataset"),
        entity_fk(
            "parent_source_document_id",
            "source_documents",
            "source_document_id",
            "fk_source_documents_parent",
            ondelete=None,
        ),
        schema=SCHEMA,
    )

    op.create_table(
        "source_evidence",
        dataset_column(),
        sa.Column("source_evidence_id", sa.Text(), nullable=False),
        sa.Column("source_document_id", sa.Text(), nullable=False),
        sa.Column("evidence_kind", sa.Text(), nullable=False),
        sa.Column("locator", postgresql.JSONB(none_as_null=True), nullable=False),
        sa.Column("verbatim_text", sa.Text(), nullable=False),
        sa.PrimaryKeyConstraint("dataset_id", "source_evidence_id"),
        dataset_fk("fk_source_evidence_dataset"),
        entity_fk(
            "source_document_id",
            "source_documents",
            "source_document_id",
            "fk_source_evidence_document",
        ),
        schema=SCHEMA,
    )
    op.create_index(
        "ix_source_evidence_document",
        "source_evidence",
        ["dataset_id", "source_document_id"],
        schema=SCHEMA,
    )

    op.create_table(
        "requirement_nodes",
        dataset_column(),
        sa.Column("requirement_id", sa.Text(), nullable=False),
        sa.Column("name", sa.Text(), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("requirement_kind", sa.Text(), nullable=False),
        sa.Column("origin_kind", sa.Text(), nullable=False),
        sa.Column("atomic", sa.Boolean(), nullable=False),
        sa.Column("verification_method", sa.Text(), nullable=True),
        sa.Column("priority_order", sa.Integer(), nullable=True),
        sa.Column("source_emphasis", sa.Text(), nullable=True),
        sa.Column("customer_visible", sa.Boolean(), nullable=False),
        sa.Column("needs_confirmation", sa.Boolean(), nullable=False),
        sa.Column("lifecycle_status", sa.Text(), nullable=False),
        sa.Column("derived_min_depth", sa.Integer(), nullable=True),
        sa.PrimaryKeyConstraint("dataset_id", "requirement_id"),
        dataset_fk("fk_requirement_nodes_dataset"),
        schema=SCHEMA,
    )
    op.create_index(
        "ix_requirement_nodes_kind",
        "requirement_nodes",
        ["dataset_id", "requirement_kind"],
        schema=SCHEMA,
    )
    op.create_index(
        "ix_requirement_nodes_name",
        "requirement_nodes",
        ["dataset_id", "name"],
        schema=SCHEMA,
    )

    op.create_table(
        "requirement_relations",
        dataset_column(),
        sa.Column("requirement_relation_id", sa.Text(), nullable=False),
        sa.Column("parent_requirement_id", sa.Text(), nullable=False),
        sa.Column("child_requirement_id", sa.Text(), nullable=False),
        sa.Column("relation_kind", sa.Text(), nullable=False),
        sa.Column("display_order", sa.Integer(), nullable=False),
        sa.Column("rationale", sa.Text(), nullable=True),
        sa.Column("origin_kind", sa.Text(), nullable=False),
        sa.PrimaryKeyConstraint("dataset_id", "requirement_relation_id"),
        dataset_fk("fk_requirement_relations_dataset"),
        entity_fk(
            "parent_requirement_id",
            "requirement_nodes",
            "requirement_id",
            "fk_requirement_relations_parent",
        ),
        entity_fk(
            "child_requirement_id",
            "requirement_nodes",
            "requirement_id",
            "fk_requirement_relations_child",
        ),
        sa.CheckConstraint(
            "parent_requirement_id <> child_requirement_id",
            name="ck_requirement_relations_not_self",
        ),
        schema=SCHEMA,
    )
    op.create_index(
        "ix_requirement_relations_parent",
        "requirement_relations",
        ["dataset_id", "parent_requirement_id", "relation_kind"],
        schema=SCHEMA,
    )
    op.create_index(
        "ix_requirement_relations_child",
        "requirement_relations",
        ["dataset_id", "child_requirement_id", "relation_kind"],
        schema=SCHEMA,
    )

    op.create_table(
        "requirement_source_links",
        dataset_column(),
        sa.Column("requirement_source_link_id", sa.Text(), nullable=False),
        sa.Column("requirement_id", sa.Text(), nullable=False),
        sa.Column("source_evidence_id", sa.Text(), nullable=False),
        sa.Column("link_kind", sa.Text(), nullable=False),
        sa.PrimaryKeyConstraint("dataset_id", "requirement_source_link_id"),
        dataset_fk("fk_requirement_source_links_dataset"),
        entity_fk(
            "requirement_id",
            "requirement_nodes",
            "requirement_id",
            "fk_requirement_source_links_requirement",
        ),
        entity_fk(
            "source_evidence_id",
            "source_evidence",
            "source_evidence_id",
            "fk_requirement_source_links_evidence",
        ),
        schema=SCHEMA,
    )
    op.create_index(
        "ix_requirement_source_links_requirement",
        "requirement_source_links",
        ["dataset_id", "requirement_id"],
        schema=SCHEMA,
    )

    op.create_table(
        "requirement_aliases",
        dataset_column(),
        sa.Column("requirement_alias_id", sa.Text(), nullable=False),
        sa.Column("requirement_id", sa.Text(), nullable=False),
        sa.Column("alternate_name", sa.Text(), nullable=False),
        sa.Column("alias_kind", sa.Text(), nullable=False),
        sa.Column("note", sa.Text(), nullable=True),
        sa.PrimaryKeyConstraint("dataset_id", "requirement_alias_id"),
        dataset_fk("fk_requirement_aliases_dataset"),
        entity_fk(
            "requirement_id",
            "requirement_nodes",
            "requirement_id",
            "fk_requirement_aliases_requirement",
        ),
        schema=SCHEMA,
    )

    op.create_table(
        "dedup_decisions",
        dataset_column(),
        sa.Column("dedup_decision_id", sa.Text(), nullable=False),
        sa.Column("decision", sa.Text(), nullable=False),
        sa.Column("rationale", sa.Text(), nullable=False),
        sa.PrimaryKeyConstraint("dataset_id", "dedup_decision_id"),
        dataset_fk("fk_dedup_decisions_dataset"),
        schema=SCHEMA,
    )

    op.create_table(
        "dedup_decision_requirement_links",
        dataset_column(),
        sa.Column("dedup_decision_requirement_link_id", sa.Text(), nullable=False),
        sa.Column("dedup_decision_id", sa.Text(), nullable=False),
        sa.Column("requirement_id", sa.Text(), nullable=False),
        sa.Column("candidate_order", sa.Integer(), nullable=False),
        sa.PrimaryKeyConstraint("dataset_id", "dedup_decision_requirement_link_id"),
        dataset_fk("fk_dedup_requirement_links_dataset"),
        entity_fk(
            "dedup_decision_id",
            "dedup_decisions",
            "dedup_decision_id",
            "fk_dedup_requirement_links_decision",
        ),
        entity_fk(
            "requirement_id",
            "requirement_nodes",
            "requirement_id",
            "fk_dedup_requirement_links_requirement",
        ),
        schema=SCHEMA,
    )

    op.create_table(
        "scope_dimensions",
        dataset_column(),
        sa.Column("scope_dimension_id", sa.Text(), nullable=False),
        sa.Column("name", sa.Text(), nullable=False),
        sa.Column("value_semantics", sa.Text(), nullable=False),
        sa.PrimaryKeyConstraint("dataset_id", "scope_dimension_id"),
        dataset_fk("fk_scope_dimensions_dataset"),
        schema=SCHEMA,
    )

    op.create_table(
        "scope_values",
        dataset_column(),
        sa.Column("scope_value_id", sa.Text(), nullable=False),
        sa.Column("scope_dimension_id", sa.Text(), nullable=False),
        sa.Column("name", sa.Text(), nullable=False),
        sa.Column("status", sa.Text(), nullable=False),
        sa.PrimaryKeyConstraint("dataset_id", "scope_value_id"),
        sa.UniqueConstraint(
            "dataset_id",
            "scope_dimension_id",
            "scope_value_id",
            name="uq_scope_values_dimension_value",
        ),
        dataset_fk("fk_scope_values_dataset"),
        entity_fk(
            "scope_dimension_id",
            "scope_dimensions",
            "scope_dimension_id",
            "fk_scope_values_dimension",
        ),
        schema=SCHEMA,
    )

    op.create_table(
        "requirement_scope_links",
        dataset_column(),
        sa.Column("requirement_scope_link_id", sa.Text(), nullable=False),
        sa.Column("requirement_id", sa.Text(), nullable=False),
        sa.Column("scope_value_id", sa.Text(), nullable=False),
        sa.Column("applicability", sa.Text(), nullable=False),
        sa.Column("inherit_to_descendants", sa.Boolean(), nullable=False),
        sa.PrimaryKeyConstraint("dataset_id", "requirement_scope_link_id"),
        dataset_fk("fk_requirement_scope_links_dataset"),
        entity_fk(
            "requirement_id",
            "requirement_nodes",
            "requirement_id",
            "fk_requirement_scope_links_requirement",
        ),
        entity_fk(
            "scope_value_id",
            "scope_values",
            "scope_value_id",
            "fk_requirement_scope_links_value",
        ),
        schema=SCHEMA,
    )
    op.create_index(
        "ix_requirement_scope_links_requirement",
        "requirement_scope_links",
        ["dataset_id", "requirement_id"],
        schema=SCHEMA,
    )

    op.create_table(
        "acceptance_criteria",
        dataset_column(),
        sa.Column("acceptance_criterion_id", sa.Text(), nullable=False),
        sa.Column("requirement_id", sa.Text(), nullable=False),
        sa.Column("criterion_statement", sa.Text(), nullable=False),
        sa.Column("criterion_status", sa.Text(), nullable=False),
        sa.Column("threshold", postgresql.JSONB(none_as_null=True), nullable=True),
        sa.Column("measurement_method", sa.Text(), nullable=False),
        sa.Column("origin_kind", sa.Text(), nullable=False),
        sa.PrimaryKeyConstraint("dataset_id", "acceptance_criterion_id"),
        dataset_fk("fk_acceptance_criteria_dataset"),
        entity_fk(
            "requirement_id",
            "requirement_nodes",
            "requirement_id",
            "fk_acceptance_criteria_requirement",
        ),
        schema=SCHEMA,
    )

    op.create_table(
        "open_questions",
        dataset_column(),
        sa.Column("open_question_id", sa.Text(), nullable=False),
        sa.Column("question", sa.Text(), nullable=False),
        sa.Column("blocking_kind", sa.Text(), nullable=False),
        sa.Column("status", sa.Text(), nullable=False),
        sa.PrimaryKeyConstraint("dataset_id", "open_question_id"),
        dataset_fk("fk_open_questions_dataset"),
        schema=SCHEMA,
    )

    op.create_table(
        "open_question_requirement_links",
        dataset_column(),
        sa.Column("open_question_requirement_link_id", sa.Text(), nullable=False),
        sa.Column("open_question_id", sa.Text(), nullable=False),
        sa.Column("requirement_id", sa.Text(), nullable=False),
        sa.PrimaryKeyConstraint("dataset_id", "open_question_requirement_link_id"),
        dataset_fk("fk_open_question_requirement_links_dataset"),
        entity_fk(
            "open_question_id",
            "open_questions",
            "open_question_id",
            "fk_open_question_requirement_links_question",
        ),
        entity_fk(
            "requirement_id",
            "requirement_nodes",
            "requirement_id",
            "fk_open_question_requirement_links_requirement",
        ),
        schema=SCHEMA,
    )

    op.create_table(
        "graph_views",
        dataset_column(),
        sa.Column("graph_view_id", sa.Text(), nullable=False),
        sa.Column("name", sa.Text(), nullable=False),
        sa.Column("description", sa.Text(), nullable=False),
        sa.Column("layout_algorithm", sa.Text(), nullable=True),
        sa.Column("layout_version", sa.Text(), nullable=False),
        sa.PrimaryKeyConstraint("dataset_id", "graph_view_id"),
        dataset_fk("fk_graph_views_dataset"),
        schema=SCHEMA,
    )

    op.create_table(
        "graph_view_filters",
        dataset_column(),
        sa.Column("graph_view_filter_id", sa.Text(), nullable=False),
        sa.Column("graph_view_id", sa.Text(), nullable=False),
        sa.Column("scope_dimension_id", sa.Text(), nullable=False),
        sa.Column("scope_value_id", sa.Text(), nullable=False),
        sa.Column("operator", sa.Text(), nullable=False),
        sa.PrimaryKeyConstraint("dataset_id", "graph_view_filter_id"),
        dataset_fk("fk_graph_view_filters_dataset"),
        entity_fk(
            "graph_view_id",
            "graph_views",
            "graph_view_id",
            "fk_graph_view_filters_view",
        ),
        sa.ForeignKeyConstraint(
            ["dataset_id", "scope_dimension_id", "scope_value_id"],
            [
                f"{SCHEMA}.scope_values.dataset_id",
                f"{SCHEMA}.scope_values.scope_dimension_id",
                f"{SCHEMA}.scope_values.scope_value_id",
            ],
            name="fk_graph_view_filters_scope_value",
            ondelete="CASCADE",
            deferrable=True,
            initially="DEFERRED",
        ),
        schema=SCHEMA,
    )

    op.create_table(
        "graph_layout_positions",
        dataset_column(),
        sa.Column("graph_layout_position_id", sa.Text(), nullable=False),
        sa.Column("graph_view_id", sa.Text(), nullable=False),
        sa.Column("node_kind", sa.Text(), nullable=False),
        sa.Column("node_id", sa.Text(), nullable=False),
        sa.Column("x", sa.Float(), nullable=True),
        sa.Column("y", sa.Float(), nullable=True),
        sa.Column("z", sa.Float(), nullable=True),
        sa.Column("position_source", sa.Text(), nullable=False),
        sa.Column("locked", sa.Boolean(), nullable=False),
        sa.PrimaryKeyConstraint("dataset_id", "graph_layout_position_id"),
        dataset_fk("fk_graph_layout_positions_dataset"),
        entity_fk(
            "graph_view_id",
            "graph_views",
            "graph_view_id",
            "fk_graph_layout_positions_view",
        ),
        entity_fk(
            "node_id",
            "requirement_nodes",
            "requirement_id",
            "fk_graph_layout_positions_requirement",
        ),
        schema=SCHEMA,
    )
    op.create_index(
        "ix_graph_layout_positions_view",
        "graph_layout_positions",
        ["dataset_id", "graph_view_id", "node_kind"],
        schema=SCHEMA,
    )


def downgrade() -> None:
    tables = (
        "graph_layout_positions",
        "graph_view_filters",
        "graph_views",
        "open_question_requirement_links",
        "open_questions",
        "acceptance_criteria",
        "requirement_scope_links",
        "scope_values",
        "scope_dimensions",
        "dedup_decision_requirement_links",
        "dedup_decisions",
        "requirement_aliases",
        "requirement_source_links",
        "requirement_relations",
        "requirement_nodes",
        "source_evidence",
        "source_documents",
        "dataset_builds",
    )
    for table in tables:
        op.drop_table(table, schema=SCHEMA)
    op.execute(f"DROP SCHEMA IF EXISTS {SCHEMA}")
