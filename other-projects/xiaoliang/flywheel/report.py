"""Status and completeness checks against the local corpus and production."""

from __future__ import annotations

import logging
from pathlib import Path
from typing import Any

from flywheel.config import corpus_dir
from flywheel.prod import bootstrap_admin, prod_session
from flywheel.sqlite_store import LocalStore

bootstrap_admin()
from sqlalchemy import func, select  # noqa: E402
from app.schemas_orm import (  # noqa: E402
    AgentUsageRun,
    PiSessionArchive,
    ProjectArchive,
    ProjectArchiveConversation,
    ProjectArchiveFile,
    ProjectArchiveMessage,
    User,
)

log = logging.getLogger("flywheel")


def _store(corpus: Path | None = None) -> LocalStore:
    root = corpus or corpus_dir()
    db_path = root / "index.sqlite"
    if not db_path.exists():
        raise SystemExit(f"还没有本地语料库: {db_path}。先运行 python -m flywheel pull")
    return LocalStore(db_path)


def status(corpus: Path | None = None) -> dict[str, Any]:
    store = _store(corpus)
    try:
        run = store.latest_run()
        dup_rows = store.query(
            """
            SELECT sha256, COUNT(*) AS keys
            FROM oss_objects
            WHERE sha256 IS NOT NULL AND sha256 != ''
            GROUP BY sha256
            HAVING COUNT(*) > 1
            """
        )
        return {
            "sqlite": str(store.path),
            "latest_run": dict(run) if run else None,
            "counts": store.counts(),
            "project_file_download_status": store.file_status_counts(),
            "oss_duplicate_sha_count": len(dup_rows),
            "oss_extra_keys_from_dup_sha": int(sum(row["keys"] - 1 for row in dup_rows)),
        }
    finally:
        store.close()


def verify(corpus: Path | None = None) -> dict[str, Any]:
    root = corpus or corpus_dir()
    store = _store(root)
    problems: list[str] = []
    try:
        blobs_root = root / "blobs" / "sha256"
        blob_rows = store.query("SELECT sha256, size_bytes FROM blobs")
        missing_blobs = 0
        size_mismatch = 0
        for row in blob_rows:
            path = blobs_root / row["sha256"][:2] / row["sha256"]
            if not path.exists():
                missing_blobs += 1
                continue
            if int(row["size_bytes"] or 0) != path.stat().st_size:
                size_mismatch += 1
        if missing_blobs:
            problems.append(f"blobs 表有 {missing_blobs} 条在磁盘上不存在")
        if size_mismatch:
            problems.append(f"blobs 有 {size_mismatch} 条 size 与磁盘不一致")

        dangling = store.query(
            """
            SELECT id FROM project_files
            WHERE download_status='downloaded'
              AND (blob_sha256 IS NULL OR blob_sha256 = '')
            LIMIT 5
            """
        )
        if dangling:
            problems.append(f"有 {len(dangling)}+ 条 project_files 标记 downloaded 但没有 blob_sha256")

        for row in store.query("SELECT email, local_dir FROM users"):
            path = Path(row["local_dir"]) if row["local_dir"] else None
            if path is None or not path.exists():
                problems.append(f"用户目录不存在: {row['email']}")

        prod = _prod_counts()
        drift: list[str] = []
        local_users = int(store.query("SELECT COUNT(*) AS n FROM users")[0]["n"])
        if local_users != prod["included_users"]:
            drift.append(
                f"本地 users={local_users} 与当前生产纳入用户 {prod['included_users']} 不同（语料是快照，生产可能还在写入）"
            )

        local_files = int(
            store.query("SELECT COUNT(*) AS n FROM project_files WHERE is_deleted=0")[0]["n"]
        )
        if local_files != prod["included_project_files"]:
            drift.append(
                f"本地未删除项目文件 {local_files} 与当前生产 {prod['included_project_files']} 不同（语料是快照，生产可能还在写入）"
            )

        local_pi = int(store.query("SELECT COUNT(*) AS n FROM pi_sessions")[0]["n"])
        if local_pi != prod["included_pi_sessions"]:
            drift.append(
                f"本地 pi_sessions={local_pi} 与当前生产 {prod['included_pi_sessions']} 不同（语料是快照，生产可能还在写入）"
            )

        status_sum = sum(store.file_status_counts().values())
        total_files = int(store.query("SELECT COUNT(*) AS n FROM project_files")[0]["n"])
        if status_sum != total_files:
            problems.append(
                f"project_files download_status 合计 {status_sum} != 行数 {total_files}"
            )

        return {
            "ok": not problems,
            "problems": problems,
            "prod_drift": drift,
            "blob_rows": len(blob_rows),
            "missing_blobs": missing_blobs,
            "size_mismatch": size_mismatch,
            "prod": prod,
            "local_counts": store.counts(),
            "file_status": store.file_status_counts(),
        }
    finally:
        store.close()


def _included_user_ids(db) -> list[str]:
    msg_ids = set(
        db.execute(
            select(ProjectArchiveConversation.source_user_id)
            .join(
                ProjectArchiveMessage,
                ProjectArchiveMessage.conversation_id == ProjectArchiveConversation.id,
            )
            .where(
                ProjectArchiveConversation.is_deleted.is_(False),
                ProjectArchiveMessage.is_deleted.is_(False),
                ProjectArchiveConversation.source_user_id.isnot(None),
            )
            .distinct()
        ).scalars()
    )
    run_ids = set(db.execute(select(AgentUsageRun.user_id).distinct()).scalars())
    included = []
    for user in db.execute(select(User)).scalars():
        email = (user.email or "").lower()
        if email.endswith("@example.com"):
            continue
        if user.id in msg_ids or user.id in run_ids:
            included.append(user.id)
    return included


def _prod_counts() -> dict[str, int]:
    with prod_session() as db:
        included = _included_user_ids(db)
        if not included:
            return {"included_users": 0, "included_project_files": 0, "included_pi_sessions": 0}

        owned_project_ids = set(
            db.execute(
                select(ProjectArchive.id).where(ProjectArchive.owner_user_id.in_(included))
            ).scalars()
        )
        talked_project_ids = set(
            db.execute(
                select(ProjectArchiveConversation.project_archive_id).where(
                    ProjectArchiveConversation.source_user_id.in_(included)
                )
            ).scalars()
        )
        project_ids = list(owned_project_ids | talked_project_ids)
        file_count = 0
        if project_ids:
            file_count = int(
                db.execute(
                    select(func.count())
                    .select_from(ProjectArchiveFile)
                    .where(
                        ProjectArchiveFile.is_deleted.is_(False),
                        ProjectArchiveFile.project_archive_id.in_(project_ids),
                    )
                ).scalar_one()
            )
        conv_ids = list(
            db.execute(
                select(ProjectArchiveConversation.id).where(
                    ProjectArchiveConversation.source_user_id.in_(included),
                    ProjectArchiveConversation.is_deleted.is_(False),
                )
            ).scalars()
        )
        pi_count = 0
        if conv_ids:
            pi_count = int(
                db.execute(
                    select(func.count())
                    .select_from(PiSessionArchive)
                    .where(PiSessionArchive.conversation_archive_id.in_(conv_ids))
                ).scalar_one()
            )
        return {
            "included_users": len(included),
            "included_project_files": file_count,
            "included_pi_sessions": pi_count,
        }
