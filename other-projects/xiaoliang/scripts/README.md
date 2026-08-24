# scripts

仓库根级运维/巡检脚本（与 `dev/` 平级）。

## 查询线上已收集的用户项目文件

读取 `dev/backend/.env` 的 `DATABASE_URL`，查询：

- `project_archives` — 项目归档元数据
- `project_archive_files` — 用户项目文件
- 关联 `users` / `organizations`

```bash
# 汇总：有哪些用户、哪些项目（默认不展开数千条文件路径）
python scripts/query_project_archives.py

# 最近 7 天 + 展开文件路径（每项目最多 20 条）
python scripts/query_project_archives.py --days 7 --list-files --files-per-project 20

# 只看已上传成功
python scripts/query_project_archives.py --status ready

# JSON 输出（含全部匹配文件）
python scripts/query_project_archives.py --json

# 巡检视角：用户×项目表 + 最近 24h 样本 + 扩展名分布
python scripts/summarize_project_archives.py

# 导出最新一组对话（含完整度统计）到 scripts/exports/*.md
python scripts/export_latest_conversation.py

# 查询已归档的用户自制 skills
python scripts/query_user_skill_archives.py
python scripts/query_user_skill_archives.py --days 7 --list-skills --list-files
```

依赖：`psycopg[binary]`（backend 的 `requirements.txt` 已包含）。
