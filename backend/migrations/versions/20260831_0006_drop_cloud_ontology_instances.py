"""Drop business-requirement and CAD capability instance tables.

Revision ID: 20260831_0006
Revises: 20260831_0005
Create Date: 2026-08-31

These datasets now live in local SQLite. Topology tables stay in the
ontology schema. Do not downgrade to 20260827_0001; that revision drops
the entire schema including topology.
"""

from collections.abc import Sequence

from alembic import op

revision: str = "20260831_0006"
down_revision: str | Sequence[str] | None = "20260831_0005"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

SCHEMA = "ontology"

INSTANCE_TABLES = (
    "capability_graph_snapshots",
    "capability_atoms",
    "capability_inventories",
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


def upgrade() -> None:
    op.execute(
        f"""
        DO $$
        DECLARE
            item record;
        BEGIN
            FOR item IN
                SELECT tablename
                FROM pg_tables
                WHERE schemaname = '{SCHEMA}'
                  AND tablename LIKE 'cad_capability_atoms_import_%'
            LOOP
                EXECUTE format('DROP TABLE IF EXISTS {SCHEMA}.%I CASCADE', item.tablename);
            END LOOP;
        END
        $$;
        """
    )
    for table in INSTANCE_TABLES:
        op.drop_table(table, schema=SCHEMA)


def downgrade() -> None:
    raise RuntimeError(
        "Cannot recreate dropped business/CAD instance tables. "
        "Do not downgrade past 20260831_0006, and never downgrade to 20260827_0001 "
        "(that drops the entire ontology schema including topology)."
    )
