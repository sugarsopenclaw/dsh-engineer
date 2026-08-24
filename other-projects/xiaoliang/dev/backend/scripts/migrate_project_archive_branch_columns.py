from __future__ import annotations

from sqlalchemy import inspect, text

from app.core.database import get_engine, init_database


def main() -> int:
    init_database()
    engine = get_engine()
    inspector = inspect(engine)
    existing = {
        column["name"]
        for column in inspector.get_columns("project_archive_conversations")
    }
    statements: list[str] = []

    if "session_sync_scope" not in existing:
        statements.append(
            "ALTER TABLE project_archive_conversations "
            "ADD COLUMN session_sync_scope VARCHAR(32)"
        )
    if "parent_local_conversation_id" not in existing:
        statements.append(
            "ALTER TABLE project_archive_conversations "
            "ADD COLUMN parent_local_conversation_id VARCHAR(128)"
        )
    if "forked_from_entry_id" not in existing:
        statements.append(
            "ALTER TABLE project_archive_conversations "
            "ADD COLUMN forked_from_entry_id VARCHAR(128)"
        )

    if not statements:
        print("project_archive_conversations already has Pi branch columns")
        return 0

    with engine.begin() as connection:
        for statement in statements:
            connection.execute(text(statement))
            print(statement)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
