from __future__ import annotations

from sqlalchemy import inspect, text
from sqlalchemy.engine import Engine


_ARCHIVE_COLUMNS: dict[str, dict[str, str]] = {
    "billing_orders": {
        "credits": "INTEGER",
        "duration_days": "INTEGER",
    },
    "project_archive_conversations": {
        "creation_source": "VARCHAR(64) NOT NULL DEFAULT 'legacy_unknown'",
        "session_sync_scope": "VARCHAR(32)",
        "parent_local_conversation_id": "VARCHAR(128)",
        "forked_from_entry_id": "VARCHAR(128)",
    },
    "project_archive_messages": {
        "client_run_id": "VARCHAR(128)",
        "pi_session_id": "VARCHAR(128)",
        "pi_entry_id": "VARCHAR(128)",
    },
    "agent_message_feedback": {
        "pi_session_id": "VARCHAR(128)",
        "pi_entry_id": "VARCHAR(128)",
    },
    "subagent_trace_archives": {
        "parent_pi_session_id": "VARCHAR(128)",
        "parent_pi_entry_id": "VARCHAR(128)",
    },
}

_ARCHIVE_INDEXES = (
    "CREATE INDEX IF NOT EXISTS ix_project_archive_messages_client_run_id "
    "ON project_archive_messages (client_run_id)",
    "CREATE INDEX IF NOT EXISTS ix_project_archive_messages_pi_session_id "
    "ON project_archive_messages (pi_session_id)",
    "CREATE INDEX IF NOT EXISTS ix_project_archive_messages_pi_entry_id "
    "ON project_archive_messages (pi_entry_id)",
    "CREATE INDEX IF NOT EXISTS ix_agent_message_feedback_pi_session_id "
    "ON agent_message_feedback (pi_session_id)",
    "CREATE INDEX IF NOT EXISTS ix_agent_message_feedback_pi_entry_id "
    "ON agent_message_feedback (pi_entry_id)",
    "CREATE INDEX IF NOT EXISTS ix_subagent_trace_archives_parent_pi_session_id "
    "ON subagent_trace_archives (parent_pi_session_id)",
    "CREATE INDEX IF NOT EXISTS ix_subagent_trace_archives_parent_pi_entry_id "
    "ON subagent_trace_archives (parent_pi_entry_id)",
)


def migrate_agent_archive_schema(engine: Engine) -> list[str]:
    """Apply small additive migrations needed by existing auto-created databases."""

    inspector = inspect(engine)
    tables = set(inspector.get_table_names())
    statements: list[str] = []
    for table_name, expected_columns in _ARCHIVE_COLUMNS.items():
        if table_name not in tables:
            continue
        existing = {column["name"] for column in inspector.get_columns(table_name)}
        for column_name, definition in expected_columns.items():
            if column_name not in existing:
                statements.append(
                    f"ALTER TABLE {table_name} ADD COLUMN {column_name} {definition}"
                )

    with engine.begin() as connection:
        for statement in statements:
            connection.execute(text(statement))
        for statement in _ARCHIVE_INDEXES:
            table_name = statement.split(" ON ", maxsplit=1)[1].split(" ", maxsplit=1)[0]
            if table_name in tables:
                connection.execute(text(statement))
        if "billing_orders" in tables:
            # Rows present before the August 15 catalog deploy were created
            # with the old entitlements. Preserve those promises for pending
            # payments instead of looking up today's product at grant time.
            connection.execute(text("""
                UPDATE billing_orders
                   SET credits = CASE product_id
                       WHEN 'credits_starter' THEN 10000
                       WHEN 'credits_standard' THEN 62500
                       WHEN 'credits_professional' THEN 135000
                       ELSE credits
                   END,
                       duration_days = CASE
                         WHEN product_id IN (
                           'credits_starter',
                           'credits_standard',
                           'credits_professional'
                         ) THEN 365
                         ELSE duration_days
                       END
                 WHERE credits IS NULL OR duration_days IS NULL
            """))
    return statements
