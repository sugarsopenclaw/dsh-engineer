from __future__ import annotations

from sqlalchemy import create_engine, inspect, text

from app.core.schema_migrations import migrate_agent_archive_schema


def test_agent_archive_migration_upgrades_existing_tables() -> None:
    engine = create_engine("sqlite+pysqlite:///:memory:", future=True)
    with engine.begin() as connection:
        for table_name in (
            "project_archive_conversations",
            "project_archive_messages",
            "agent_message_feedback",
            "subagent_trace_archives",
        ):
            connection.execute(text(f"CREATE TABLE {table_name} (id VARCHAR(36) PRIMARY KEY)"))

    first = migrate_agent_archive_schema(engine)
    second = migrate_agent_archive_schema(engine)
    inspector = inspect(engine)

    assert first
    assert second == []
    assert {
        "creation_source",
        "session_sync_scope",
        "parent_local_conversation_id",
        "forked_from_entry_id",
    }.issubset({item["name"] for item in inspector.get_columns("project_archive_conversations")})
    assert {"client_run_id", "pi_session_id", "pi_entry_id"}.issubset(
        {item["name"] for item in inspector.get_columns("project_archive_messages")}
    )
    assert {"pi_session_id", "pi_entry_id"}.issubset(
        {item["name"] for item in inspector.get_columns("agent_message_feedback")}
    )
    assert {"parent_pi_session_id", "parent_pi_entry_id"}.issubset(
        {item["name"] for item in inspector.get_columns("subagent_trace_archives")}
    )
    engine.dispose()


def test_additive_migration_snapshots_existing_billing_order_entitlements() -> None:
    engine = create_engine("sqlite+pysqlite:///:memory:", future=True)
    with engine.begin() as connection:
        connection.execute(text("""
            CREATE TABLE billing_orders (
              id VARCHAR(36) PRIMARY KEY,
              product_id VARCHAR(64) NOT NULL
            )
        """))
        connection.execute(text("""
            INSERT INTO billing_orders (id, product_id) VALUES
              ('starter', 'credits_starter'),
              ('standard', 'credits_standard'),
              ('professional', 'credits_professional')
        """))

    first = migrate_agent_archive_schema(engine)
    second = migrate_agent_archive_schema(engine)
    with engine.connect() as connection:
        rows_by_id = {
            row.id: (row.credits, row.duration_days)
            for row in connection.execute(text(
                "SELECT id, credits, duration_days FROM billing_orders"
            ))
        }

    assert any("billing_orders ADD COLUMN credits" in statement for statement in first)
    assert second == []
    assert rows_by_id == {
        "starter": (10_000, 365),
        "standard": (62_500, 365),
        "professional": (135_000, 365),
    }
    engine.dispose()
