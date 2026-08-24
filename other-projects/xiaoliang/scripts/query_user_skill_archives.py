#!/usr/bin/env python3
"""查询线上 backend 数据库中已收集的用户自制 skills。

默认读取 dev/backend/.env 的 DATABASE_URL，汇总：
  - user_skill_archives
  - user_skill_archive_entries
  - user_skill_archive_files

用法:
  python scripts/query_user_skill_archives.py
  python scripts/query_user_skill_archives.py --days 7 --list-skills --list-files
  python scripts/query_user_skill_archives.py --status ready
  python scripts/query_user_skill_archives.py --json
"""

from __future__ import annotations

import argparse
import json
import sys
from collections import defaultdict
from typing import Any

from query_project_archives import (
    _default_env_path,
    database_url_to_conninfo,
    human_bytes,
    load_dotenv_values,
)


def main() -> int:
    parser = argparse.ArgumentParser(description="查询已归档的用户自制 skills")
    parser.add_argument("--env", default=str(_default_env_path()), help="backend .env 路径")
    parser.add_argument("--days", type=int, default=0, help="只看最近 N 天同步过的归档，0 表示不限")
    parser.add_argument("--status", default="", help="只看该 upload_status 的文件，例如 ready")
    parser.add_argument("--include-deleted", action="store_true")
    parser.add_argument("--list-skills", action="store_true")
    parser.add_argument("--list-files", action="store_true")
    parser.add_argument("--files-per-user", type=int, default=20)
    parser.add_argument("--json", action="store_true", dest="as_json")
    args = parser.parse_args()

    values = load_dotenv_values(args.env)
    database_url = (values.get("DATABASE_URL") or "").strip()
    if not database_url:
        print("DATABASE_URL 未配置。", file=sys.stderr)
        return 2

    import psycopg
    from psycopg.rows import dict_row

    with psycopg.connect(
        **database_url_to_conninfo(database_url),
        row_factory=dict_row,
        connect_timeout=15,
    ) as conn:
        archive_filter = ""
        archive_params: list[Any] = []
        if args.days > 0:
            archive_filter = " AND a.last_synced_at >= NOW() - make_interval(days => %s)"
            archive_params.append(args.days)

        summary = conn.execute(
            """
            SELECT
              (SELECT COUNT(*) FROM user_skill_archives) AS archive_count,
              (SELECT COUNT(*) FROM user_skill_archive_entries WHERE is_deleted = false) AS skill_count,
              (SELECT COUNT(*) FROM user_skill_archive_files WHERE is_deleted = false) AS file_count,
              (SELECT COUNT(*) FROM user_skill_archive_files WHERE is_deleted = false AND upload_status = 'ready') AS ready_file_count,
              (SELECT COALESCE(SUM(size_bytes), 0) FROM user_skill_archive_files WHERE is_deleted = false) AS active_total_bytes,
              (SELECT MAX(last_synced_at) FROM user_skill_archives) AS latest_synced_at
            """
        ).fetchone()

        archives = conn.execute(
            f"""
            SELECT
              a.id,
              a.sync_status,
              a.file_count,
              a.skill_count,
              a.total_bytes,
              a.last_synced_at,
              u.email,
              u.display_name,
              o.name AS organization_name
            FROM user_skill_archives a
            JOIN users u ON u.id = a.owner_user_id
            JOIN organizations o ON o.id = a.organization_id
            WHERE 1=1 {archive_filter}
            ORDER BY a.last_synced_at DESC NULLS LAST, u.email
            """,
            archive_params,
        ).fetchall()

        skills_by_archive: dict[str, list[dict[str, Any]]] = defaultdict(list)
        if args.list_skills or args.as_json:
            deleted_clause = "" if args.include_deleted else " AND e.is_deleted = false"
            for row in conn.execute(
                f"""
                SELECT e.archive_id, e.slug, e.name, e.enabled, e.validation_status,
                       e.file_count, e.is_deleted, e.updated_at_client
                FROM user_skill_archive_entries e
                JOIN user_skill_archives a ON a.id = e.archive_id
                WHERE 1=1 {deleted_clause} {archive_filter}
                ORDER BY e.updated_at_client DESC NULLS LAST, e.slug
                """,
                archive_params,
            ):
                skills_by_archive[row["archive_id"]].append(dict(row))

        files_by_archive: dict[str, list[dict[str, Any]]] = defaultdict(list)
        if args.list_files or args.as_json:
            file_filter = "" if args.include_deleted else " AND f.is_deleted = false"
            status_clause = " AND f.upload_status = %s" if args.status else ""
            file_params = list(archive_params)
            if args.status:
                file_params.append(args.status)
            for row in conn.execute(
                f"""
                SELECT f.archive_id, f.skill_slug, f.relative_path, f.size_bytes,
                       f.upload_status, f.sha256, f.storage_key, f.is_deleted
                FROM user_skill_archive_files f
                JOIN user_skill_archives a ON a.id = f.archive_id
                WHERE 1=1 {file_filter} {status_clause} {archive_filter}
                ORDER BY f.relative_path
                """,
                file_params,
            ):
                files_by_archive[row["archive_id"]].append(dict(row))

    payload = {
        "summary": dict(summary) if summary else {},
        "archives": [dict(row) for row in archives],
        "skills": skills_by_archive,
        "files": files_by_archive,
    }
    if args.as_json:
        print(json.dumps(payload, ensure_ascii=False, default=str, indent=2))
        return 0

    summary_row = payload["summary"]
    print("自制 skill 归档汇总")
    print(f"  用户归档: {summary_row.get('archive_count', 0)}")
    print(f"  有效 skill: {summary_row.get('skill_count', 0)}")
    print(f"  有效文件: {summary_row.get('file_count', 0)}（ready {summary_row.get('ready_file_count', 0)}）")
    print(f"  体积: {human_bytes(int(summary_row.get('active_total_bytes') or 0))}")
    print(f"  最近同步: {summary_row.get('latest_synced_at') or '-'}")
    print()
    for archive in payload["archives"]:
        print(
            f"{archive['email']} / {archive['display_name']}  "
            f"status={archive['sync_status']}  "
            f"skills={archive['skill_count']}  "
            f"files={archive['file_count']}  "
            f"size={human_bytes(int(archive['total_bytes'] or 0))}  "
            f"synced={archive['last_synced_at'] or '-'}"
        )
        if args.list_skills:
            for skill in skills_by_archive.get(archive["id"], []):
                print(
                    f"    - {skill['slug']}  {skill['name']}  "
                    f"{'on' if skill['enabled'] else 'off'}  "
                    f"{skill['validation_status']}"
                )
        if args.list_files:
            files = files_by_archive.get(archive["id"], [])
            for item in files[: args.files_per_user]:
                print(
                    f"    {item['upload_status']:8}  {human_bytes(int(item['size_bytes'] or 0)):>10}  "
                    f"{item['relative_path']}"
                )
            extra = len(files) - args.files_per_user
            if extra > 0:
                print(f"    … 另有 {extra} 个文件")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
