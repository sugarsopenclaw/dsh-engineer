"""python -m flywheel pull|status|verify|judge|judge-status|dataset|web"""

from __future__ import annotations

import argparse
import json
import logging
import sys
from pathlib import Path


def _configure_logging() -> None:
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s %(message)s",
    )


def main(argv: list[str] | None = None) -> int:
    _configure_logging()
    parser = argparse.ArgumentParser(prog="flywheel", description="晓量内测语料抓取与 LLM 评委")
    sub = parser.add_subparsers(dest="cmd", required=True)

    pull = sub.add_parser("pull", help="从生产库 + OSS 抓取到 flywheel/corpus")
    pull.add_argument("--user", dest="user_filter", default=None, help="只抓这个 email")
    pull.add_argument("--dry-run", action="store_true", help="只写清单和对话投影，不下 OSS")
    pull.add_argument("--force", action="store_true", help="忽略本地 blob 缓存，重新下载")
    pull.add_argument("--workers", type=int, default=4)
    pull.add_argument("--corpus", default=None, help="覆盖 FLYWHEEL_CORPUS_DIR")

    sub.add_parser("status", help="看本地 sqlite 统计")
    verify = sub.add_parser("verify", help="对照磁盘与生产库做完整性检查")
    verify.add_argument("--corpus", default=None)

    judge = sub.add_parser("judge", help="用 .env 中的 GROK_*_MODEL 按用户问题评价晓量")
    judge.add_argument("--user", dest="user_filter", default=None)
    judge.add_argument("--limit", type=int, default=None, help="本进程最多新评 N 条尚未有意见的轮次")
    judge.add_argument("--workers", type=int, default=5, help="并发 LLM 路数，默认 5，上限 5")
    judge.add_argument("--force-judge", action="store_true", help="忽略指纹，重评")
    judge.add_argument("--corpus", default=None)
    sub.add_parser("judge-status", help="看本地 LLM 评委统计")

    dataset = sub.add_parser("dataset", help="导出离线训练数据集")
    dataset_sub = dataset.add_subparsers(dest="dataset_cmd", required=True)
    dataset_export = dataset_sub.add_parser("export", help="导出 CAD detail 多模态样本 JSONL")
    dataset_export.add_argument("--user", dest="user_filter", default=None, help="只导出这个 email")
    dataset_export.add_argument("--output", default=None, help="输出 JSONL；默认写到 corpus/datasets")
    dataset_export.add_argument("--include-unsaved", action="store_true", help="保留出图时 CAD 文档未保存的 evidence")
    dataset_export.add_argument("--corpus", default=None, help="覆盖 FLYWHEEL_CORPUS_DIR")

    web = sub.add_parser("web", help="本地打开评审浏览器（用户 → 项目 → 评审）")
    web.add_argument("--host", default="127.0.0.1")
    web.add_argument("--port", type=int, default=8765)
    web.add_argument("--corpus", default=None)

    args = parser.parse_args(argv)
    corpus = Path(args.corpus) if getattr(args, "corpus", None) else None

    if args.cmd == "pull":
        from flywheel.pull import PullOptions, run_pull

        result = run_pull(
            PullOptions(
                dry_run=args.dry_run,
                force=args.force,
                workers=args.workers,
                user_filter=args.user_filter,
                corpus=corpus,
            )
        )
        print(json.dumps(result, ensure_ascii=False, indent=2, default=str))
        return 0

    if args.cmd == "status":
        from flywheel.report import status

        print(json.dumps(status(corpus), ensure_ascii=False, indent=2, default=str))
        return 0

    if args.cmd == "verify":
        from flywheel.report import verify as verify_fn

        payload = verify_fn(corpus)
        print(json.dumps(payload, ensure_ascii=False, indent=2, default=str))
        return 0 if payload.get("ok") else 1

    if args.cmd == "judge":
        from flywheel.judge import JudgeOptions, run_judge

        result = run_judge(
            JudgeOptions(
                limit=args.limit,
                user_filter=args.user_filter,
                force=args.force_judge,
                corpus=corpus,
                smoke=args.limit is not None,
                workers=args.workers,
            )
        )
        print(json.dumps(result, ensure_ascii=False, indent=2, default=str))
        stats = result.get("stats") or {}
        print(
            "STATS judged={judged} failed={failed} remaining={remaining} model={model} workers={workers}".format(
                judged=stats.get("judged"),
                failed=stats.get("failed"),
                remaining=stats.get("remaining"),
                model=stats.get("model"),
                workers=stats.get("workers"),
            ),
            flush=True,
        )
        return 0

    if args.cmd == "judge-status":
        from flywheel.judge import judge_status

        print(json.dumps(judge_status(corpus), ensure_ascii=False, indent=2, default=str))
        return 0

    if args.cmd == "dataset" and args.dataset_cmd == "export":
        from flywheel.dataset import DatasetExportOptions, export_dataset

        result = export_dataset(DatasetExportOptions(
            corpus=corpus,
            output=Path(args.output) if args.output else None,
            user_filter=args.user_filter,
            include_unsaved=args.include_unsaved,
        ))
        print(json.dumps(result, ensure_ascii=False, indent=2, default=str))
        return 0

    if args.cmd == "web":
        from flywheel.web.server import serve_web

        serve_web(host=args.host, port=args.port, corpus=corpus)
        return 0

    parser.error(f"unknown command {args.cmd}")
    return 2


if __name__ == "__main__":
    sys.exit(main())
