from __future__ import annotations

from sqlalchemy import inspect, text

from app.core.database import get_engine, init_database


def main() -> int:
    init_database()
    engine = get_engine()
    inspector = inspect(engine)
    existing = {column["name"] for column in inspector.get_columns("skill_releases")}
    dialect = engine.dialect.name
    statements: list[str] = []

    if "pack_format_version" not in existing:
        statements.append("ALTER TABLE skill_releases ADD COLUMN pack_format_version INTEGER NOT NULL DEFAULT 1")
    if "pack_storage_key" not in existing:
        statements.append("ALTER TABLE skill_releases ADD COLUMN pack_storage_key VARCHAR(512)")
    if "pack_manifest" not in existing:
        json_type = "JSONB" if dialect == "postgresql" else "JSON"
        statements.append(f"ALTER TABLE skill_releases ADD COLUMN pack_manifest {json_type}")
    if "skill_count" not in existing:
        statements.append("ALTER TABLE skill_releases ADD COLUMN skill_count INTEGER NOT NULL DEFAULT 0")

    if not statements:
        print("skill_releases already has pack columns")
        return 0

    with engine.begin() as connection:
        for statement in statements:
            connection.execute(text(statement))
            print(statement)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
