#!/usr/bin/env python3
"""导出最新一组项目归档对话到 markdown，并评估消息/图片完整度。"""

from __future__ import annotations

import json
import re
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from query_project_archives import (
    _default_env_path,
    database_url_to_conninfo,
    fmt_dt,
    human_bytes,
    load_dotenv_values,
)


def _truncate(text: str, limit: int = 12_000) -> str:
    text = text or ""
    if len(text) <= limit:
        return text
    return text[:limit] + f"\n\n… [截断，原文 {len(text)} 字符] …"


def _fence(text: str, lang: str = "") -> str:
    body = (text or "").replace("```", "``\\`")
    return f"```{lang}\n{body}\n```"


def _try_json_loads(value: str | None) -> Any | None:
    if not value:
        return None
    try:
        return json.loads(value)
    except Exception:
        return None


def _parts_summary(parts_json: str | None) -> dict[str, Any]:
    parts = _try_json_loads(parts_json)
    if parts is None:
        return {"present": bool(parts_json), "count": 0, "types": {}, "has_image_like": False}
    if not isinstance(parts, list):
        return {"present": True, "count": 0, "types": {"non_list": 1}, "has_image_like": False}
    types: Counter[str] = Counter()
    has_image_like = False
    for part in parts:
        if not isinstance(part, dict):
            types["non_dict"] += 1
            continue
        ptype = str(part.get("type") or part.get("kind") or "unknown")
        types[ptype] += 1
        blob = json.dumps(part, ensure_ascii=False).lower()
        if any(k in blob for k in ("image", "png", "jpg", "jpeg", "webp", "screenshot", "preview", "base64")):
            has_image_like = True
    return {
        "present": True,
        "count": len(parts),
        "types": dict(types),
        "has_image_like": has_image_like,
    }


def _looks_like_image_ref(text: str) -> bool:
    if not text:
        return False
    lower = text.lower()
    return bool(
        re.search(r"\.(png|jpe?g|webp|gif|bmp)\b", lower)
        or "data:image" in lower
        or "image_url" in lower
        or "/previews/" in lower
        or "screenshot" in lower
    )


def export_latest(out_path: Path, conversation_id: str | None = None) -> Path:
    import psycopg
    from psycopg.rows import dict_row

    env = load_dotenv_values(_default_env_path())
    conninfo = database_url_to_conninfo(env["DATABASE_URL"])

    with psycopg.connect(**conninfo, row_factory=dict_row, connect_timeout=20) as conn:
        # Global stats
        overview = conn.execute(
            """
            SELECT
              (SELECT COUNT(*) FROM project_archive_conversations WHERE is_deleted=false) AS conv_active,
              (SELECT COUNT(*) FROM project_archive_messages WHERE is_deleted=false) AS msg_active,
              (SELECT COUNT(*) FROM project_archive_message_attachments WHERE is_deleted=false) AS att_active,
              (SELECT COUNT(*) FROM project_archive_message_attachments
                 WHERE is_deleted=false AND upload_status='ready') AS att_ready,
              (SELECT COUNT(*) FROM project_archive_message_attachments
                 WHERE is_deleted=false AND media_type ILIKE 'image%%') AS att_image,
              (SELECT COUNT(*) FROM project_archive_message_attachments
                 WHERE is_deleted=false AND media_type ILIKE 'image%%' AND upload_status='ready') AS att_image_ready,
              (SELECT COUNT(*) FROM project_archive_message_attachments
                 WHERE is_deleted=false AND upload_status='metadata_only') AS att_meta_only,
              (SELECT COUNT(*) FROM project_archive_message_attachments
                 WHERE is_deleted=false AND upload_status='pending') AS att_pending,
              (SELECT COUNT(*) FROM project_archive_message_attachments
                 WHERE is_deleted=false AND upload_status='failed') AS att_failed
            """
        ).fetchone()

        role_stats = conn.execute(
            """
            SELECT role,
                   COUNT(*) AS c,
                   COUNT(*) FILTER (WHERE content <> '') AS with_content,
                   COUNT(*) FILTER (WHERE thinking <> '') AS with_thinking,
                   COUNT(*) FILTER (WHERE tool_name <> '') AS with_tool_name,
                   COUNT(*) FILTER (WHERE tool_args <> '') AS with_tool_args,
                   COUNT(*) FILTER (WHERE tool_result <> '') AS with_tool_result,
                   COUNT(*) FILTER (
                     WHERE parts_json IS NOT NULL AND parts_json <> '' AND parts_json <> 'null'
                   ) AS with_parts,
                   AVG(LENGTH(content))::int AS avg_content_len,
                   AVG(LENGTH(COALESCE(thinking,'')))::int AS avg_thinking_len,
                   AVG(LENGTH(COALESCE(tool_result,'')))::int AS avg_tool_result_len,
                   AVG(LENGTH(COALESCE(parts_json,'')))::int AS avg_parts_len
            FROM project_archive_messages
            WHERE is_deleted=false
            GROUP BY role
            ORDER BY c DESC
            """
        ).fetchall()

        media_stats = conn.execute(
            """
            SELECT media_type, upload_status, COUNT(*) AS c,
                   COALESCE(SUM(size_bytes),0) AS total_bytes
            FROM project_archive_message_attachments
            WHERE is_deleted=false
            GROUP BY media_type, upload_status
            ORDER BY c DESC
            """
        ).fetchall()

        # Project-file images (agent runtime previews under .xiaoliang/)
        project_image_stats = conn.execute(
            """
            SELECT
              COUNT(*) FILTER (WHERE is_deleted=false AND (
                extension IN ('.png','.jpg','.jpeg','.webp','.gif','.bmp')
                OR media_type ILIKE 'image%%'
              )) AS project_images,
              COUNT(*) FILTER (WHERE is_deleted=false AND (
                extension IN ('.png','.jpg','.jpeg','.webp','.gif','.bmp')
                OR media_type ILIKE 'image%%'
              ) AND upload_status='ready') AS project_images_ready,
              COUNT(*) FILTER (WHERE is_deleted=false AND normalized_path LIKE '%%.xiaoliang/cad/previews/%%') AS cad_preview_files,
              COUNT(*) FILTER (WHERE is_deleted=false AND normalized_path LIKE '%%.xiaoliang/cad/previews/%%' AND upload_status='ready') AS cad_preview_ready,
              COUNT(*) FILTER (WHERE is_deleted=false AND normalized_path LIKE '%%.xiaoliang/cad/evidence/%%') AS cad_evidence_files,
              COUNT(*) FILTER (WHERE is_deleted=false AND normalized_path LIKE '%%.xiaoliang/%%' AND (
                extension IN ('.png','.jpg','.jpeg','.webp') OR media_type ILIKE 'image%%'
              )) AS xiaoliang_images
            FROM project_archive_files
            """
        ).fetchone()

        if conversation_id:
            conv = conn.execute(
                """
                SELECT c.*, u.email AS user_email, u.display_name AS user_name,
                       p.name AS project_name, p.local_project_id, p.id AS project_archive_id
                FROM project_archive_conversations c
                LEFT JOIN users u ON u.id = c.source_user_id
                JOIN project_archives p ON p.id = c.project_archive_id
                WHERE c.id = %s
                """,
                (conversation_id,),
            ).fetchone()
            if not conv:
                raise SystemExit(f"conversation not found: {conversation_id}")
        else:
            # Prefer latest with most messages among recent syncs
            conv = conn.execute(
                """
                SELECT c.*, u.email AS user_email, u.display_name AS user_name,
                       p.name AS project_name, p.local_project_id, p.id AS project_archive_id,
                       (SELECT COUNT(*) FROM project_archive_messages m
                          WHERE m.conversation_id=c.id AND m.is_deleted=false) AS msg_count
                FROM project_archive_conversations c
                LEFT JOIN users u ON u.id = c.source_user_id
                JOIN project_archives p ON p.id = c.project_archive_id
                WHERE c.is_deleted=false
                ORDER BY c.last_synced_at DESC NULLS LAST,
                         (SELECT COUNT(*) FROM project_archive_messages m
                            WHERE m.conversation_id=c.id AND m.is_deleted=false) DESC
                LIMIT 1
                """
            ).fetchone()

        messages = conn.execute(
            """
            SELECT *
            FROM project_archive_messages
            WHERE conversation_id = %s AND is_deleted = false
            ORDER BY ordinal ASC, created_at ASC, id ASC
            """,
            (conv["id"],),
        ).fetchall()

        attachments = conn.execute(
            """
            SELECT a.*, m.ordinal AS message_ordinal, m.role AS message_role, m.source_key
            FROM project_archive_message_attachments a
            JOIN project_archive_messages m ON m.id = a.message_id
            WHERE m.conversation_id = %s AND a.is_deleted = false AND m.is_deleted = false
            ORDER BY m.ordinal ASC, a.created_at ASC
            """,
            (conv["id"],),
        ).fetchall()

        # Related project images recently seen
        related_images = conn.execute(
            """
            SELECT relative_path, filename, extension, media_type, size_bytes,
                   upload_status, storage_key, created_at, uploaded_at
            FROM project_archive_files
            WHERE project_archive_id = %s
              AND is_deleted = false
              AND (
                extension IN ('.png','.jpg','.jpeg','.webp','.gif','.bmp')
                OR media_type ILIKE 'image%%'
                OR normalized_path LIKE '%%.xiaoliang/cad/previews/%%'
              )
            ORDER BY COALESCE(uploaded_at, created_at) DESC
            LIMIT 40
            """,
            (conv["project_archive_id"],),
        ).fetchall()

    # Per-conversation integrity
    role_counter: Counter[str] = Counter()
    field_fill = Counter()
    parts_image_msgs = 0
    content_image_refs = 0
    empty_user = 0
    empty_assistant = 0
    tool_without_result = 0
    ordinals = []

    for m in messages:
        role = m["role"] or "?"
        role_counter[role] += 1
        ordinals.append(m["ordinal"])
        if m["content"]:
            field_fill["content"] += 1
        if m["thinking"]:
            field_fill["thinking"] += 1
        if m["tool_name"]:
            field_fill["tool_name"] += 1
        if m["tool_args"]:
            field_fill["tool_args"] += 1
        if m["tool_result"]:
            field_fill["tool_result"] += 1
        if m["parts_json"]:
            field_fill["parts_json"] += 1
            ps = _parts_summary(m["parts_json"])
            if ps["has_image_like"]:
                parts_image_msgs += 1
        if role == "user" and not (m["content"] or "").strip() and not m["parts_json"]:
            empty_user += 1
        if role == "assistant" and not (m["content"] or "").strip() and not m["thinking"] and not m["parts_json"]:
            empty_assistant += 1
        if role == "tool" and m["tool_name"] and not (m["tool_result"] or "").strip():
            tool_without_result += 1
        blob = "\n".join(
            [
                m["content"] or "",
                m["tool_args"] or "",
                m["tool_result"] or "",
                m["thinking"] or "",
                m["parts_json"] or "",
            ]
        )
        if _looks_like_image_ref(blob):
            content_image_refs += 1

    att_by_status = Counter(a["upload_status"] for a in attachments)
    att_by_media = Counter(a["media_type"] for a in attachments)
    ready_images = [
        a
        for a in attachments
        if (a["media_type"] or "").startswith("image/") and a["upload_status"] == "ready"
    ]

    # ordinal gaps
    ordinal_gaps = []
    if ordinals:
        s = sorted(ordinals)
        for prev, cur in zip(s, s[1:]):
            if cur > prev + 1:
                ordinal_gaps.append((prev, cur))

    lines: list[str] = []
    lines.append("# 最新对话导出 · 项目归档消息完整性抽查")
    lines.append("")
    lines.append(f"- 导出时间: {datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M:%S UTC')}")
    lines.append(f"- 数据库: `{conninfo['host']}:{conninfo['port']}/{conninfo['dbname']}`")
    lines.append("")
    lines.append("## 1. 全库对话/消息/附件概况")
    lines.append("")
    lines.append("| 指标 | 数值 |")
    lines.append("|------|------|")
    lines.append(f"| 活跃对话 | {overview['conv_active']} |")
    lines.append(f"| 活跃消息 | {overview['msg_active']} |")
    lines.append(f"| 消息附件 | {overview['att_active']} |")
    lines.append(f"| 附件 ready | {overview['att_ready']} |")
    lines.append(f"| 图片附件 | {overview['att_image']} (ready={overview['att_image_ready']}) |")
    lines.append(f"| 附件 metadata_only | {overview['att_meta_only']} |")
    lines.append(f"| 附件 pending | {overview['att_pending']} |")
    lines.append(f"| 附件 failed | {overview['att_failed']} |")
    lines.append(
        f"| 项目文件中的图片 | {project_image_stats['project_images']} "
        f"(ready={project_image_stats['project_images_ready']}) |"
    )
    lines.append(
        f"| `.xiaoliang/cad/previews/*` | {project_image_stats['cad_preview_files']} "
        f"(ready={project_image_stats['cad_preview_ready']}) |"
    )
    lines.append(f"| `.xiaoliang/cad/evidence/*` | {project_image_stats['cad_evidence_files']} |")
    lines.append(f"| `.xiaoliang/` 下图片 | {project_image_stats['xiaoliang_images']} |")
    lines.append("")
    lines.append("### 消息角色字段填充（全库）")
    lines.append("")
    lines.append(
        "| role | count | content | thinking | tool_name | tool_args | tool_result | parts | avg_content | avg_thinking | avg_tool_result | avg_parts |"
    )
    lines.append("|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|")
    for r in role_stats:
        lines.append(
            f"| {r['role']} | {r['c']} | {r['with_content']} | {r['with_thinking']} | "
            f"{r['with_tool_name']} | {r['with_tool_args']} | {r['with_tool_result']} | "
            f"{r['with_parts']} | {r['avg_content_len']} | {r['avg_thinking_len']} | "
            f"{r['avg_tool_result_len']} | {r['avg_parts_len']} |"
        )
    lines.append("")
    lines.append("### 消息附件 media_type × status（全库）")
    lines.append("")
    lines.append("| media_type | status | count | size |")
    lines.append("|---|---|---:|---:|")
    for r in media_stats:
        lines.append(
            f"| {r['media_type']} | {r['upload_status']} | {r['c']} | {human_bytes(r['total_bytes'])} |"
        )
    lines.append("")

    lines.append("## 2. 本对话元数据")
    lines.append("")
    lines.append(f"- **conversation_id**: `{conv['id']}`")
    lines.append(f"- **local_conversation_id**: `{conv['local_conversation_id']}`")
    lines.append(f"- **title**: {conv['title']}")
    lines.append(f"- **user**: {conv.get('user_email') or conv.get('source_user_id')}")
    lines.append(f"- **project**: {conv.get('project_name')} (`{conv.get('local_project_id')}`)")
    lines.append(f"- **mode**: {conv.get('conversation_mode')}")
    lines.append(f"- **drawing**: {conv.get('drawing_name') or '-'} / id={conv.get('drawing_id') or '-'}")
    lines.append(f"- **preferred_model**: {conv.get('preferred_model_id') or '-'}")
    lines.append(f"- **thinking_mode**: {conv.get('preferred_thinking_mode') or '-'}")
    lines.append(f"- **last_synced_at**: {fmt_dt(conv.get('last_synced_at'))}")
    lines.append(f"- **source_updated_at**: {conv.get('source_updated_at') or '-'}")
    lines.append(f"- **message_count**: {len(messages)}")
    lines.append(f"- **attachment_count**: {len(attachments)}")
    lines.append("")

    lines.append("## 3. 本对话完整度评估")
    lines.append("")
    lines.append(f"- 角色分布: {dict(role_counter)}")
    lines.append(f"- 字段非空: {dict(field_fill)}")
    lines.append(f"- 空 user 消息: {empty_user}")
    lines.append(f"- 空 assistant 消息: {empty_assistant}")
    lines.append(f"- tool 无 result: {tool_without_result}")
    lines.append(f"- ordinal 断号: {ordinal_gaps[:20] if ordinal_gaps else '无'}")
    lines.append(f"- parts 中疑似含图片结构的消息数: {parts_image_msgs}")
    lines.append(f"- 文本字段中含图片路径/引用的消息数: {content_image_refs}")
    lines.append(f"- 消息附件 status: {dict(att_by_status)}")
    lines.append(f"- 消息附件 media_type: {dict(att_by_media)}")
    lines.append(f"- ready 图片附件数: {len(ready_images)}")
    lines.append("")

    # Heuristic completeness score
    user_n = role_counter.get("user", 0)
    asst_n = role_counter.get("assistant", 0)
    tool_n = role_counter.get("tool", 0)
    notes = []
    if user_n == 0:
        notes.append("没有 user 消息")
    if asst_n == 0:
        notes.append("没有 assistant 消息")
    if tool_n > 0 and field_fill["tool_result"] < tool_n * 0.5:
        notes.append("大量 tool 消息缺 tool_result")
    if field_fill["parts_json"] == 0 and asst_n > 0:
        notes.append("assistant 无 parts_json（可能只有扁平 content/tool 字段）")
    if attachments and att_by_status.get("ready", 0) < len(attachments):
        notes.append(
            f"消息附件未全部 ready（ready={att_by_status.get('ready', 0)}/{len(attachments)}）"
        )
    if not attachments and content_image_refs:
        notes.append("文本里提到图片，但消息附件表为空（图片可能只在项目文件归档里）")
    if not notes:
        notes.append("user/assistant/tool 主字段大体齐全；详见下方原文")

    lines.append("**结论摘要**")
    for n in notes:
        lines.append(f"- {n}")
    lines.append("")

    lines.append("## 4. 消息附件明细（本对话）")
    lines.append("")
    if not attachments:
        lines.append("_本对话无 message_attachments 记录_")
    else:
        lines.append("| # | ord | role | filename | media | status | size | storage_key | sha256 |")
        lines.append("|---:|---:|---|---|---|---|---:|---|---|")
        for i, a in enumerate(attachments, 1):
            lines.append(
                f"| {i} | {a['message_ordinal']} | {a['message_role']} | "
                f"{a.get('filename') or a['local_attachment_id']} | {a['media_type']} | "
                f"{a['upload_status']} | {human_bytes(a['size_bytes'])} | "
                f"`{(a.get('storage_key') or '-')[:80]}` | `{(a.get('sha256') or '-')[:12]}` |"
            )
    lines.append("")

    lines.append("## 5. 同项目最近图片/预览文件（project_archive_files，最多 40）")
    lines.append("")
    lines.append(
        "> 这些不是 message_attachments，而是项目包同步上来的文件。"
        "Agent 运行过程中的 CAD 预览图通常落在 `.xiaoliang/cad/previews/`。"
    )
    lines.append("")
    if not related_images:
        lines.append("_本项目暂无图片类归档文件_")
    else:
        lines.append("| path | status | size | uploaded |")
        lines.append("|---|---|---:|---|")
        for f in related_images:
            lines.append(
                f"| `{f['relative_path']}` | {f['upload_status']} | "
                f"{human_bytes(f['size_bytes'])} | {fmt_dt(f.get('uploaded_at') or f.get('created_at'))} |"
            )
    lines.append("")

    lines.append("## 6. 对话正文（按 ordinal）")
    lines.append("")
    for m in messages:
        role = m["role"]
        ord_ = m["ordinal"]
        lines.append(f"### [{ord_}] {role.upper()}")
        lines.append("")
        lines.append(f"- message_id: `{m['id']}`")
        lines.append(f"- local_message_id: `{m.get('local_message_id') or '-'}`")
        lines.append(f"- source_key: `{m['source_key']}`")
        lines.append(f"- source_created_at: {m.get('source_created_at') or '-'}")
        lines.append(f"- last_synced_at: {fmt_dt(m.get('last_synced_at'))}")
        if m.get("tool_name"):
            lines.append(f"- tool_name: `{m['tool_name']}`")
        lines.append("")

        if m.get("thinking"):
            lines.append("#### thinking")
            lines.append("")
            lines.append(_fence(_truncate(m["thinking"]), "text"))
            lines.append("")

        if m.get("content"):
            lines.append("#### content")
            lines.append("")
            lines.append(_fence(_truncate(m["content"]), "markdown"))
            lines.append("")
        else:
            lines.append("_content 为空_")
            lines.append("")

        if m.get("tool_args"):
            lines.append("#### tool_args")
            lines.append("")
            lines.append(_fence(_truncate(m["tool_args"], 8_000), "json"))
            lines.append("")

        if m.get("tool_result"):
            lines.append("#### tool_result")
            lines.append("")
            lines.append(_fence(_truncate(m["tool_result"], 8_000), "text"))
            lines.append("")

        if m.get("parts_json"):
            ps = _parts_summary(m["parts_json"])
            lines.append(
                f"#### parts_json (count={ps['count']}, types={ps['types']}, "
                f"image_like={ps['has_image_like']})"
            )
            lines.append("")
            lines.append(_fence(_truncate(m["parts_json"], 10_000), "json"))
            lines.append("")

        msg_atts = [a for a in attachments if a["message_id"] == m["id"]]
        if msg_atts:
            lines.append("#### attachments")
            lines.append("")
            for a in msg_atts:
                lines.append(
                    f"- `{a.get('filename') or a['local_attachment_id']}` "
                    f"({a['media_type']}, {a['upload_status']}, {human_bytes(a['size_bytes'])})"
                    f" key=`{a.get('storage_key') or '-'}`"
                )
            lines.append("")

        lines.append("---")
        lines.append("")

    lines.append("## 7. 对微调可用性的初步判断（机器侧）")
    lines.append("")
    lines.append(
        "见脚本控制台输出与本文件第 3 节；人工结论由导出后的审阅者补充。"
    )
    lines.append("")

    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text("\n".join(lines), encoding="utf-8")

    # Console summary
    print("exported:", out_path)
    print("conversation:", conv["id"], conv["title"])
    print("user:", conv.get("user_email"))
    print("project:", conv.get("project_name"))
    print("messages:", len(messages), "roles:", dict(role_counter))
    print("attachments:", len(attachments), dict(att_by_status), dict(att_by_media))
    print("ready_images:", len(ready_images))
    print("project_images_ready:", project_image_stats["project_images_ready"])
    print("cad_preview_ready:", project_image_stats["cad_preview_ready"])
    print("notes:")
    for n in notes:
        print(" -", n)
    return out_path


def main() -> None:
    out = (
        Path(__file__).resolve().parents[1]
        / "scripts"
        / "exports"
        / f"latest_conversation_{datetime.now().strftime('%Y%m%d_%H%M%S')}.md"
    )
    export_latest(out)


if __name__ == "__main__":
    main()
