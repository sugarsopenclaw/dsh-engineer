#!/usr/bin/env python3
"""检查最新对话中引用的图片路径是否在 project_archive_files 中 ready。"""
from __future__ import annotations

import re
from query_project_archives import load_dotenv_values, database_url_to_conninfo, _default_env_path, human_bytes
import psycopg
from psycopg.rows import dict_row

CID = "803460e2-874b-484d-8318-cc0de77c1404"

env = load_dotenv_values(_default_env_path())
c = database_url_to_conninfo(env["DATABASE_URL"])
with psycopg.connect(**c, row_factory=dict_row, connect_timeout=20) as conn:
    proj = conn.execute(
        "SELECT project_archive_id FROM project_archive_conversations WHERE id=%s",
        (CID,),
    ).fetchone()["project_archive_id"]

    msgs = conn.execute(
        """
        SELECT content, tool_result, parts_json, thinking
        FROM project_archive_messages
        WHERE conversation_id=%s AND is_deleted=false
        """,
        (CID,),
    ).fetchall()

    paths: set[str] = set()
    for m in msgs:
        blob = "\n".join(
            [m["content"] or "", m["tool_result"] or "", m["parts_json"] or "", m["thinking"] or ""]
        )
        for p in re.findall(
            r"\.xiaoliang/[^\s`\"']+\.(?:png|jpg|jpeg|webp|md|jsonl?)",
            blob,
            flags=re.I,
        ):
            paths.add(p.rstrip(".,;)").replace("\\", "/"))

    print(f"referenced_paths={len(paths)}")
    ready = 0
    missing = []
    for p in sorted(paths):
        row = conn.execute(
            """
            SELECT relative_path, upload_status, size_bytes, storage_key
            FROM project_archive_files
            WHERE project_archive_id=%s AND is_deleted=false
              AND (relative_path=%s OR normalized_path=%s)
            LIMIT 1
            """,
            (proj, p, p),
        ).fetchone()
        if row and row["upload_status"] == "ready":
            ready += 1
            print(f"  READY {human_bytes(row['size_bytes']):>10}  {p}")
        else:
            missing.append(p)
            print(f"  MISS  {p}  row={row}")

    print(f"summary ready={ready}/{len(paths)} missing={len(missing)}")

    # message attachments for this conv
    atts = conn.execute(
        """
        SELECT a.filename, a.media_type, a.upload_status, a.size_bytes, a.storage_key, a.sha256
        FROM project_archive_message_attachments a
        JOIN project_archive_messages m ON m.id=a.message_id
        WHERE m.conversation_id=%s AND a.is_deleted=false
        """,
        (CID,),
    ).fetchall()
    print(f"message_attachments={len(atts)}")
    for a in atts:
        print(
            f"  [{a['upload_status']}] {a['media_type']} {human_bytes(a['size_bytes'])} "
            f"key={a['storage_key']}"
        )
