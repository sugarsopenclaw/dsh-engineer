# Flywheel 内测语料抓取

把生产 PostgreSQL + OSS 上的内测用户数据拉到本地，按用户分目录，供后续 LLM 评价晓量表现。只读生产，不写回。

怎么跑、怎么增量见 [USAGE.md](USAGE.md)。第一期做了什么、第一次全量结果见 [PHASE1.md](PHASE1.md)。

凭据用 `dev/admin/.env`（`DATABASE_URL`、OSS）。可用 `FLYWHEEL_ENV_FILE` 覆盖路径，`FLYWHEEL_CORPUS_DIR` 覆盖落盘目录。

## 纳入谁

- 至少有一条带消息的归档对话，或至少有一条 `agent_usage_runs`
- 排除 `*@example.com`
- 只注册、或只有空「新对话」的用户不建目录

## 用法

在仓库根目录：

```text
python -m flywheel pull --dry-run
python -m flywheel pull
python -m flywheel pull --user 209612331@qq.com
python -m flywheel status
python -m flywheel verify
python -m flywheel web
```

明天（以及之后）再拉：**直接再跑一遍 `python -m flywheel pull`，不要加 `--force`。** 这就是增量更新。

- OSS 字节：本地已有相同 sha256 且 size 一致，不再 GET。
- 用户树：目标文件已在就跳过硬链接；新路径碰到旧内容只补一条硬链接。
- sqlite：按主键 upsert，不会插重复行。
- 对话 `messages.jsonl` / `messages.md`：`last_synced_at` 和消息数没变则不重写。
- 新用户、新对话、新 Pi Session 快照、新文件照常补上。

`--force` 才会无视本地 blob 重下一遍。`--user email` 只扫那一个人。`--dry-run` 仍会写 sqlite、用户 catalog、对话投影，但不从 OSS 拉文件。

## 落盘

```text
flywheel/corpus/                 gitignore
  index.sqlite
  blobs/sha256/{aa}/{sha256}     字节只存一份
  users/{email}/
    user.json
    catalog.json
    projects/{id前缀}__{项目名}/
      project.json
      tree.json                  从文件路径还原的目录名
      files_index.json           全量清单（含 skipped / missing）
      files/{相对路径}           已下载文件，硬链接到 blob
      conversations/{id}__{标题}/
        messages.jsonl
        messages.md
        pi_sessions/{session_id}/{sha256}.jsonl
        traces/...
    skills/
    usage_runs.jsonl
```

同一内容按 sha256 去重。OSS 上跨项目的重复对象记在 sqlite `oss_objects`。安装包 / 运行时（天正 zip、晓量 setup、exe/dll/pak/cab 等）清单保留、文件不下载。

同一 `pi_session_id` 的每次上传都保留，不会互相覆盖。
