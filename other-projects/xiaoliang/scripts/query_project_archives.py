#!/usr/bin/env python3
"""查询线上 backend 数据库中已收集的用户项目文件。

默认读取 dev/backend/.env 的 DATABASE_URL，汇总：
  - project_archives（项目归档）
  - project_archive_files（项目文件）
  - 关联用户 email / display_name

用法:
  python scripts/query_project_archives.py
  python scripts/query_project_archives.py --days 7
  python scripts/query_project_archives.py --list-files --files-per-project 20
  python scripts/query_project_archives.py --status ready
  python scripts/query_project_archives.py --include-deleted
  python scripts/query_project_archives.py --json
  python scripts/query_project_archives.py --env path/to/.env
"""

from __future__ import annotations

import argparse
import json
import sys
from collections import defaultdict
from dataclasses import asdict, dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from urllib.parse import unquote, urlparse


def _repo_root() -> Path:
    return Path(__file__).resolve().parents[1]


def _default_env_path() -> Path:
    return _repo_root() / "dev" / "backend" / ".env"


def load_dotenv_values(env_path: Path) -> dict[str, str]:
    if not env_path.is_file():
        raise FileNotFoundError(f"找不到 .env 文件: {env_path}")

    values: dict[str, str] = {}
    for raw_line in env_path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip()
        value = value.strip().strip("'").strip('"')
        values[key] = value
    return values


def database_url_to_conninfo(database_url: str) -> dict[str, Any]:
    """把 SQLAlchemy/psycopg URL 转成 psycopg.connect kwargs。"""
    raw = database_url.strip()
    for prefix in (
        "postgresql+psycopg://",
        "postgresql+psycopg2://",
        "postgres+psycopg://",
        "postgresql://",
        "postgres://",
    ):
        if raw.lower().startswith(prefix):
            raw = "postgresql://" + raw[len(prefix) :]
            break

    parsed = urlparse(raw)
    if parsed.scheme not in {"postgresql", "postgres"}:
        raise ValueError(f"不支持的 DATABASE_URL scheme: {parsed.scheme!r}")

    query: dict[str, str] = {}
    if parsed.query:
        for part in parsed.query.split("&"):
            if not part:
                continue
            if "=" in part:
                k, v = part.split("=", 1)
                query[unquote(k)] = unquote(v)
            else:
                query[unquote(part)] = ""

    conninfo: dict[str, Any] = {
        "host": parsed.hostname or "127.0.0.1",
        "port": parsed.port or 5432,
        "user": unquote(parsed.username or ""),
        "password": unquote(parsed.password or ""),
        "dbname": (parsed.path or "/").lstrip("/") or "postgres",
    }

    # 透传常见 query 参数（如 sslmode）
    for key in ("sslmode", "connect_timeout", "application_name"):
        if key in query:
            conninfo[key] = query[key]

    return conninfo


def human_bytes(n: int | None) -> str:
    if n is None:
        return "-"
    size = float(n)
    for unit in ("B", "KB", "MB", "GB", "TB"):
        if abs(size) < 1024 or unit == "TB":
            if unit == "B":
                return f"{int(size)} {unit}"
            return f"{size:.1f} {unit}"
        size /= 1024
    return f"{n} B"


def fmt_dt(value: Any) -> str:
    if value is None:
        return "-"
    if isinstance(value, datetime):
        if value.tzinfo is None:
            value = value.replace(tzinfo=timezone.utc)
        return value.astimezone(timezone.utc).strftime("%Y-%m-%d %H:%M:%S UTC")
    return str(value)


@dataclass
class FileRow:
    file_id: str
    relative_path: str
    filename: str
    size_bytes: int
    sha256: str
    upload_status: str
    is_deleted: bool
    media_type: str
    created_at: str
    updated_at: str
    uploaded_at: str
    last_seen_at: str
    archived_by_user_id: str | None
    archived_by_email: str | None
    archived_by_name: str | None


@dataclass
class ProjectRow:
    project_id: str
    local_project_id: str
    name: str
    root_name: str | None
    sync_status: str
    file_count: int
    total_bytes: int
    owner_user_id: str | None
    owner_email: str | None
    owner_name: str | None
    last_synced_by_user_id: str | None
    last_synced_by_email: str | None
    last_synced_by_name: str | None
    last_synced_at: str
    created_at: str
    updated_at: str
    organization_id: str
    organization_name: str | None
    files: list[FileRow]


SUMMARY_SQL = """
SELECT
  (SELECT COUNT(*) FROM project_archives) AS project_count,
  (SELECT COUNT(*) FROM project_archive_files) AS file_count,
  (SELECT COUNT(*) FROM project_archive_files WHERE is_deleted = false) AS active_file_count,
  (SELECT COUNT(*) FROM project_archive_files WHERE is_deleted = false AND upload_status = 'ready') AS ready_file_count,
  (SELECT COUNT(*) FROM project_archive_files WHERE is_deleted = false AND upload_status = 'pending') AS pending_file_count,
  (SELECT COUNT(*) FROM project_archive_files WHERE is_deleted = false AND upload_status = 'failed') AS failed_file_count,
  (SELECT COALESCE(SUM(size_bytes), 0) FROM project_archive_files WHERE is_deleted = false) AS active_total_bytes,
  (SELECT COALESCE(SUM(size_bytes), 0) FROM project_archive_files WHERE is_deleted = false AND upload_status = 'ready') AS ready_total_bytes,
  (SELECT COUNT(*) FROM project_archive_conversations WHERE is_deleted = false) AS conversation_count,
  (SELECT COUNT(*) FROM project_archive_messages WHERE is_deleted = false) AS message_count,
  (SELECT COUNT(*) FROM project_archive_message_attachments WHERE is_deleted = false) AS attachment_count,
  (SELECT MAX(created_at) FROM project_archive_files) AS latest_file_created_at,
  (SELECT MAX(uploaded_at) FROM project_archive_files) AS latest_file_uploaded_at,
  (SELECT MAX(last_synced_at) FROM project_archives) AS latest_project_synced_at
"""


PROJECTS_SQL = """
SELECT
  pa.id AS project_id,
  pa.local_project_id,
  pa.name AS project_name,
  pa.root_name,
  pa.sync_status,
  pa.file_count,
  pa.total_bytes,
  pa.organization_id,
  org.name AS organization_name,
  pa.owner_user_id,
  ou.email AS owner_email,
  ou.display_name AS owner_name,
  pa.last_synced_by_user_id,
  su.email AS last_synced_by_email,
  su.display_name AS last_synced_by_name,
  pa.last_synced_at,
  pa.created_at AS project_created_at,
  pa.updated_at AS project_updated_at
FROM project_archives pa
LEFT JOIN organizations org ON org.id = pa.organization_id
LEFT JOIN users ou ON ou.id = pa.owner_user_id
LEFT JOIN users su ON su.id = pa.last_synced_by_user_id
ORDER BY pa.last_synced_at DESC NULLS LAST, pa.updated_at DESC
"""


FILES_SQL = """
SELECT
  f.id AS file_id,
  f.project_archive_id,
  f.relative_path,
  f.filename,
  f.size_bytes,
  f.sha256,
  f.upload_status,
  f.is_deleted,
  f.media_type,
  f.created_at,
  f.updated_at,
  f.uploaded_at,
  f.last_seen_at,
  f.archived_by_user_id,
  u.email AS archived_by_email,
  u.display_name AS archived_by_name
FROM project_archive_files f
LEFT JOIN users u ON u.id = f.archived_by_user_id
WHERE 1=1
  {deleted_clause}
  {status_clause}
  {days_clause}
ORDER BY f.created_at DESC NULLS LAST, f.updated_at DESC
"""


def table_exists(conn, table_name: str) -> bool:
    row = conn.execute(
        "SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = %s",
        (table_name,),
    ).fetchone()
    return row is not None


def query_archives(
    *,
    env_path: Path,
    days: int | None,
    status: str | None,
    include_deleted: bool,
) -> tuple[dict[str, Any], list[ProjectRow], dict[str, Any]]:
    try:
        import psycopg
        from psycopg.rows import dict_row
    except ImportError as exc:
        raise SystemExit(
            "缺少依赖 psycopg。请先安装: pip install 'psycopg[binary]'"
        ) from exc

    env = load_dotenv_values(env_path)
    database_url = env.get("DATABASE_URL", "").strip()
    if not database_url:
        raise SystemExit(f"{env_path} 中没有 DATABASE_URL")

    conninfo = database_url_to_conninfo(database_url)
    safe_target = f"{conninfo['user']}@{conninfo['host']}:{conninfo['port']}/{conninfo['dbname']}"

    with psycopg.connect(**conninfo, row_factory=dict_row, connect_timeout=15) as conn:
        required = ["project_archives", "project_archive_files", "users"]
        missing = [t for t in required if not table_exists(conn, t)]
        if missing:
            raise SystemExit(f"数据库缺少表: {', '.join(missing)}")

        summary_row = conn.execute(SUMMARY_SQL).fetchone() or {}
        summary = {
            "database": safe_target,
            "env_file": str(env_path),
            "queried_at": datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S UTC"),
            "filters": {
                "days": days,
                "status": status,
                "include_deleted": include_deleted,
            },
            "totals": {
                "project_count": int(summary_row.get("project_count") or 0),
                "file_count": int(summary_row.get("file_count") or 0),
                "active_file_count": int(summary_row.get("active_file_count") or 0),
                "ready_file_count": int(summary_row.get("ready_file_count") or 0),
                "pending_file_count": int(summary_row.get("pending_file_count") or 0),
                "failed_file_count": int(summary_row.get("failed_file_count") or 0),
                "active_total_bytes": int(summary_row.get("active_total_bytes") or 0),
                "ready_total_bytes": int(summary_row.get("ready_total_bytes") or 0),
                "conversation_count": int(summary_row.get("conversation_count") or 0),
                "message_count": int(summary_row.get("message_count") or 0),
                "attachment_count": int(summary_row.get("attachment_count") or 0),
                "latest_file_created_at": fmt_dt(summary_row.get("latest_file_created_at")),
                "latest_file_uploaded_at": fmt_dt(summary_row.get("latest_file_uploaded_at")),
                "latest_project_synced_at": fmt_dt(summary_row.get("latest_project_synced_at")),
            },
        }

        project_rows = conn.execute(PROJECTS_SQL).fetchall()

        deleted_clause = "" if include_deleted else "AND f.is_deleted = false"
        status_clause = ""
        days_clause = ""
        params: list[Any] = []

        if status:
            status_clause = "AND f.upload_status = %s"
            params.append(status)
        if days is not None and days > 0:
            # 最近 N 天：按 created_at / uploaded_at / last_seen_at 任一命中
            days_clause = """
              AND (
                f.created_at >= NOW() - (%s || ' days')::interval
                OR f.uploaded_at >= NOW() - (%s || ' days')::interval
                OR f.last_seen_at >= NOW() - (%s || ' days')::interval
              )
            """
            params.extend([str(days), str(days), str(days)])

        files_sql = FILES_SQL.format(
            deleted_clause=deleted_clause,
            status_clause=status_clause,
            days_clause=days_clause,
        )
        file_rows = conn.execute(files_sql, params).fetchall()

    files_by_project: dict[str, list[FileRow]] = defaultdict(list)
    for row in file_rows:
        files_by_project[row["project_archive_id"]].append(
            FileRow(
                file_id=row["file_id"],
                relative_path=row["relative_path"],
                filename=row["filename"],
                size_bytes=int(row["size_bytes"] or 0),
                sha256=row["sha256"] or "",
                upload_status=row["upload_status"] or "",
                is_deleted=bool(row["is_deleted"]),
                media_type=row["media_type"] or "",
                created_at=fmt_dt(row["created_at"]),
                updated_at=fmt_dt(row["updated_at"]),
                uploaded_at=fmt_dt(row["uploaded_at"]),
                last_seen_at=fmt_dt(row["last_seen_at"]),
                archived_by_user_id=row["archived_by_user_id"],
                archived_by_email=row["archived_by_email"],
                archived_by_name=row["archived_by_name"],
            )
        )

    projects: list[ProjectRow] = []
    for row in project_rows:
        project_id = row["project_id"]
        files = files_by_project.get(project_id, [])
        # 有 days/status 过滤时，只展示仍有匹配文件或项目本身在窗口内的项目
        if (days is not None and days > 0) or status:
            if not files:
                continue
        projects.append(
            ProjectRow(
                project_id=project_id,
                local_project_id=row["local_project_id"],
                name=row["project_name"],
                root_name=row["root_name"],
                sync_status=row["sync_status"] or "",
                file_count=int(row["file_count"] or 0),
                total_bytes=int(row["total_bytes"] or 0),
                owner_user_id=row["owner_user_id"],
                owner_email=row["owner_email"],
                owner_name=row["owner_name"],
                last_synced_by_user_id=row["last_synced_by_user_id"],
                last_synced_by_email=row["last_synced_by_email"],
                last_synced_by_name=row["last_synced_by_name"],
                last_synced_at=fmt_dt(row["last_synced_at"]),
                created_at=fmt_dt(row["project_created_at"]),
                updated_at=fmt_dt(row["project_updated_at"]),
                organization_id=row["organization_id"],
                organization_name=row["organization_name"],
                files=files,
            )
        )

    # 用户维度汇总（按 owner，其次 archived_by）
    by_user: dict[str, dict[str, Any]] = {}
    for project in projects:
        user_key = project.owner_email or project.owner_user_id or "(unknown owner)"
        bucket = by_user.setdefault(
            user_key,
            {
                "user_email": project.owner_email,
                "user_name": project.owner_name,
                "user_id": project.owner_user_id,
                "project_count": 0,
                "file_count": 0,
                "total_bytes": 0,
                "projects": [],
            },
        )
        bucket["project_count"] += 1
        bucket["file_count"] += len(project.files)
        bucket["total_bytes"] += sum(f.size_bytes for f in project.files)
        bucket["projects"].append(
            {
                "name": project.name,
                "local_project_id": project.local_project_id,
                "sync_status": project.sync_status,
                "file_count": len(project.files),
                "total_bytes": sum(f.size_bytes for f in project.files),
            }
        )

    meta = {
        "matched_project_count": len(projects),
        "matched_file_count": sum(len(p.files) for p in projects),
        "users": by_user,
    }
    return summary, projects, meta


def print_text(
    summary: dict[str, Any],
    projects: list[ProjectRow],
    meta: dict[str, Any],
    *,
    list_files: bool,
    files_per_project: int | None,
) -> None:
    totals = summary["totals"]
    filters = summary["filters"]

    print("=" * 72)
    print("晓量 Backend · 用户项目文件归档查询")
    print("=" * 72)
    print(f"数据库:     {summary['database']}")
    print(f"配置文件:   {summary['env_file']}")
    print(f"查询时间:   {summary['queried_at']}")
    print(
        f"过滤条件:   days={filters['days']!r}  status={filters['status']!r}  "
        f"include_deleted={filters['include_deleted']}"
    )
    print("-" * 72)
    print("全库汇总")
    print(f"  项目数:             {totals['project_count']}")
    print(
        f"  文件数:             {totals['file_count']} "
        f"(active={totals['active_file_count']}, ready={totals['ready_file_count']}, "
        f"pending={totals['pending_file_count']}, failed={totals['failed_file_count']})"
    )
    print(
        f"  活跃文件体积:       {human_bytes(totals['active_total_bytes'])} "
        f"(ready={human_bytes(totals['ready_total_bytes'])})"
    )
    print(
        f"  对话/消息/附件:     {totals['conversation_count']} / "
        f"{totals['message_count']} / {totals['attachment_count']}"
    )
    print(f"  最近文件创建:     {totals['latest_file_created_at']}")
    print(f"  最近文件上传:       {totals['latest_file_uploaded_at']}")
    print(f"  最近项目同步:       {totals['latest_project_synced_at']}")
    print("-" * 72)
    print(
        f"本次匹配: 项目 {meta['matched_project_count']} 个, "
        f"文件 {meta['matched_file_count']} 个, "
        f"用户 {len(meta['users'])} 个"
    )
    if totals["file_count"] > 0:
        print("结论: 线上库已收集到用户项目文件。")
    print()

    if not projects:
        print("没有匹配到任何项目/文件记录。")
        if totals["project_count"] == 0 and totals["file_count"] == 0:
            print("结论: 线上库目前还没有收集到用户项目文件。")
        else:
            print("结论: 全库有数据，但当前过滤条件下没有命中。可去掉 --days/--status 再查。")
        return

    # 按用户汇总
    print("按用户汇总")
    print("-" * 72)
    for user_key, bucket in sorted(
        meta["users"].items(),
        key=lambda item: (-item[1]["file_count"], item[0] or ""),
    ):
        name = bucket["user_name"] or "-"
        email = bucket["user_email"] or user_key
        print(
            f"  · {email}  (name={name})  "
            f"projects={bucket['project_count']}  files={bucket['file_count']}  "
            f"size={human_bytes(bucket['total_bytes'])}"
        )
        for p in bucket["projects"]:
            print(
                f"      - {p['name']}  "
                f"(sync={p['sync_status']}, files={p['file_count']})"
            )
    print()

    # 明细
    print("项目明细" + ("与文件" if list_files else "（默认不展开文件路径，加 --list-files 查看）"))
    print("=" * 72)
    for idx, project in enumerate(projects, start=1):
        owner = project.owner_email or project.owner_user_id or "(unknown)"
        owner_name = project.owner_name or "-"
        synced_by = project.last_synced_by_email or project.last_synced_by_user_id or "-"
        print(f"[{idx}] 项目: {project.name}")
        print(f"    local_project_id : {project.local_project_id}")
        print(f"    project_id       : {project.project_id}")
        print(f"    owner            : {owner}  (name={owner_name})")
        print(f"    last_synced_by   : {synced_by}")
        print(f"    org              : {project.organization_name or project.organization_id}")
        print(
            f"    sync_status      : {project.sync_status}  "
            f"matched_files={len(project.files)}  "
            f"meta_file_count={project.file_count}  meta_total={human_bytes(project.total_bytes)}"
        )
        print(f"    last_synced_at   : {project.last_synced_at}")
        print(f"    created/updated  : {project.created_at} / {project.updated_at}")
        if not list_files:
            print()
            continue
        if not project.files:
            print("    文件: (无匹配文件行；可能仅有项目元数据、或文件已被过滤/删除)")
            print()
            continue

        shown = project.files
        omitted = 0
        if files_per_project is not None and files_per_project >= 0:
            omitted = max(0, len(project.files) - files_per_project)
            shown = project.files[:files_per_project]

        print(f"    文件 ({len(project.files)}" + (f", 展示前 {len(shown)}" if omitted else "") + "):")
        for fidx, file in enumerate(shown, start=1):
            deleted_tag = " DELETED" if file.is_deleted else ""
            archiver = file.archived_by_email or file.archived_by_user_id or "-"
            print(
                f"      {fidx:>3}. [{file.upload_status}{deleted_tag}] "
                f"{file.relative_path}"
            )
            print(
                f"           size={human_bytes(file.size_bytes)}  "
                f"sha256={file.sha256[:12]}…  by={archiver}"
            )
            print(
                f"           created={file.created_at}  "
                f"uploaded={file.uploaded_at}  last_seen={file.last_seen_at}"
            )
        if omitted:
            print(f"      … 另有 {omitted} 个文件未展示（加大 --files-per-project 或去掉上限）")
        print()


def print_json(summary: dict[str, Any], projects: list[ProjectRow], meta: dict[str, Any]) -> None:
    payload = {
        "summary": summary,
        "meta": {
            "matched_project_count": meta["matched_project_count"],
            "matched_file_count": meta["matched_file_count"],
            "users": meta["users"],
        },
        "projects": [asdict(p) for p in projects],
    }
    print(json.dumps(payload, ensure_ascii=False, indent=2, default=str))


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="查询线上 backend 数据库中已收集的用户项目文件",
    )
    parser.add_argument(
        "--env",
        type=Path,
        default=_default_env_path(),
        help=f"backend .env 路径（默认: {_default_env_path()}）",
    )
    parser.add_argument(
        "--days",
        type=int,
        default=None,
        help="只看最近 N 天创建/上传/看到的文件（默认: 不过滤）",
    )
    parser.add_argument(
        "--status",
        choices=["ready", "pending", "failed", "missing", "mismatch"],
        default=None,
        help="按 upload_status 过滤文件",
    )
    parser.add_argument(
        "--include-deleted",
        action="store_true",
        help="包含 is_deleted=true 的文件",
    )
    parser.add_argument(
        "--list-files",
        action="store_true",
        help="展开每个项目的文件路径（默认只输出汇总与项目列表）",
    )
    parser.add_argument(
        "--files-per-project",
        type=int,
        default=30,
        help="配合 --list-files：每个项目最多展示 N 个文件（默认 30；0 表示不限制）",
    )
    parser.add_argument(
        "--json",
        action="store_true",
        help="以 JSON 输出（含全部匹配文件）",
    )
    return parser


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)

    try:
        summary, projects, meta = query_archives(
            env_path=args.env.resolve(),
            days=args.days,
            status=args.status,
            include_deleted=args.include_deleted,
        )
    except Exception as exc:
        print(f"查询失败: {exc}", file=sys.stderr)
        return 1

    files_per_project = None if args.files_per_project == 0 else args.files_per_project

    if args.json:
        print_json(summary, projects, meta)
    else:
        print_text(
            summary,
            projects,
            meta,
            list_files=args.list_files,
            files_per_project=files_per_project,
        )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
