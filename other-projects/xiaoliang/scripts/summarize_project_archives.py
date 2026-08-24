#!/usr/bin/env python3
"""精简汇总：按用户×项目 + 最近文件样本。

比 query_project_archives.py 更偏巡检视角：
  - 用户 × 项目 表
  - 最近 3 天扩展名分布
  - 最近 24h 文件样本

用法:
  python scripts/summarize_project_archives.py
"""

from __future__ import annotations

from query_project_archives import (
    _default_env_path,
    database_url_to_conninfo,
    fmt_dt,
    human_bytes,
    load_dotenv_values,
)


def main() -> None:
    import psycopg
    from psycopg.rows import dict_row

    env = load_dotenv_values(_default_env_path())
    conninfo = database_url_to_conninfo(env["DATABASE_URL"])

    with psycopg.connect(**conninfo, row_factory=dict_row, connect_timeout=15) as conn:
        rows = conn.execute(
            """
            SELECT
              COALESCE(ou.email, '(no owner)') AS owner_email,
              pa.name AS project_name,
              pa.local_project_id,
              pa.sync_status,
              pa.file_count,
              pa.total_bytes,
              pa.last_synced_at,
              COUNT(f.id) FILTER (WHERE f.is_deleted = false) AS active_files,
              COUNT(f.id) FILTER (WHERE f.is_deleted = false AND f.upload_status = 'ready') AS ready_files,
              COALESCE(SUM(f.size_bytes) FILTER (WHERE f.is_deleted = false), 0) AS active_bytes,
              MAX(f.created_at) AS latest_file_at,
              MAX(f.uploaded_at) AS latest_upload_at
            FROM project_archives pa
            LEFT JOIN users ou ON ou.id = pa.owner_user_id
            LEFT JOIN project_archive_files f ON f.project_archive_id = pa.id
            GROUP BY ou.email, pa.id, pa.name, pa.local_project_id,
                     pa.sync_status, pa.file_count, pa.total_bytes, pa.last_synced_at
            ORDER BY ou.email NULLS LAST, pa.last_synced_at DESC NULLS LAST
            """
        ).fetchall()

        print("=== 按用户 × 项目 ===")
        cur = None
        for r in rows:
            if r["owner_email"] != cur:
                cur = r["owner_email"]
                print()
                print(f"用户: {cur}")
            print(f"  - {r['project_name']}")
            print(
                f"      sync={r['sync_status']}  files={r['active_files']} "
                f"ready={r['ready_files']}  size={human_bytes(r['active_bytes'])}"
            )
            print(
                f"      last_synced={fmt_dt(r['last_synced_at'])}  "
                f"latest_file={fmt_dt(r['latest_file_at'])}"
            )

        print()
        print("=== 最近 3 天：按用户 × 扩展名 ===")
        ext_rows = conn.execute(
            """
            SELECT
              COALESCE(u.email, ou.email, '(unknown)') AS user_email,
              COALESCE(NULLIF(f.extension, ''), '(noext)') AS ext,
              COUNT(*) AS cnt,
              COALESCE(SUM(f.size_bytes), 0) AS total_bytes,
              MAX(f.created_at) AS latest
            FROM project_archive_files f
            JOIN project_archives pa ON pa.id = f.project_archive_id
            LEFT JOIN users u ON u.id = f.archived_by_user_id
            LEFT JOIN users ou ON ou.id = pa.owner_user_id
            WHERE f.is_deleted = false
              AND (
                f.created_at >= NOW() - INTERVAL '3 days'
                OR f.uploaded_at >= NOW() - INTERVAL '3 days'
              )
            GROUP BY 1, 2
            ORDER BY 1, cnt DESC
            """
        ).fetchall()
        cur = None
        for r in ext_rows:
            if r["user_email"] != cur:
                cur = r["user_email"]
                print()
                print(f"用户: {cur}")
            print(
                f"  {r['ext']:>12}  count={r['cnt']:>5}  "
                f"size={human_bytes(r['total_bytes']):>10}  latest={fmt_dt(r['latest'])}"
            )

        print()
        print("=== 最近 24 小时文件样本（每用户最多 20 条）===")
        sample = conn.execute(
            """
            WITH ranked AS (
              SELECT
                COALESCE(u.email, ou.email, '(unknown)') AS user_email,
                pa.name AS project_name,
                f.relative_path,
                f.filename,
                f.size_bytes,
                f.upload_status,
                f.created_at,
                f.uploaded_at,
                ROW_NUMBER() OVER (
                  PARTITION BY COALESCE(u.email, ou.email, '(unknown)')
                  ORDER BY COALESCE(f.uploaded_at, f.created_at) DESC
                ) AS rn
              FROM project_archive_files f
              JOIN project_archives pa ON pa.id = f.project_archive_id
              LEFT JOIN users u ON u.id = f.archived_by_user_id
              LEFT JOIN users ou ON ou.id = pa.owner_user_id
              WHERE f.is_deleted = false
                AND (
                  f.created_at >= NOW() - INTERVAL '1 day'
                  OR f.uploaded_at >= NOW() - INTERVAL '1 day'
                )
            )
            SELECT * FROM ranked WHERE rn <= 20 ORDER BY user_email, rn
            """
        ).fetchall()
        cur = None
        for r in sample:
            if r["user_email"] != cur:
                cur = r["user_email"]
                print()
                print(f"用户: {cur}")
            print(
                f"  [{r['upload_status']}] {r['project_name']} :: {r['relative_path']}  "
                f"({human_bytes(r['size_bytes'])})  {fmt_dt(r['created_at'])}"
            )

        print()
        print("=== 最近窗口计数 ===")
        for label, interval in [("24h", "1 day"), ("3d", "3 days"), ("7d", "7 days")]:
            c = conn.execute(
                f"""
                SELECT COUNT(*) AS c
                FROM project_archive_files
                WHERE is_deleted = false
                  AND (
                    created_at >= NOW() - INTERVAL '{interval}'
                    OR uploaded_at >= NOW() - INTERVAL '{interval}'
                  )
                """
            ).fetchone()
            print(f"  最近 {label} 文件数: {c['c']}")


if __name__ == "__main__":
    main()
