POSTGRES_IMPORT_RETIRED = (
    "PostgreSQL import for business requirements and CAD capabilities is retired. "
    "Use data/pipelines/local_query_store/load_sqlite.py. "
    "Do not write these datasets to DATABASE_URL."
)


def refuse_postgres_import() -> None:
    raise SystemExit(POSTGRES_IMPORT_RETIRED)
