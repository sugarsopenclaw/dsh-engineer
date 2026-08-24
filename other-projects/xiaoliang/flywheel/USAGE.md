# 飞轮使用说明

在仓库根目录执行。只读生产库和 OSS，不写回。凭据用 `dev/admin/.env`。

第一次全量结果见 [PHASE1.md](PHASE1.md)。

## 日常

```text
python -m flywheel pull
python -m flywheel verify
```

数据在 `flywheel/corpus/`（已 gitignore）。不要删这个目录再拉，否则会整库重下。

## 增量（明天再拉）

还是这条，**不要加 `--force`**：

```text
python -m flywheel pull
```

已有 sha256 的文件不会再从 OSS 下载。新用户、新对话、新文件、新的 Pi Session 快照会补上。

只拉一个人：

```text
python -m flywheel pull --user 209612331@qq.com
```

## LLM 评委（grok-4.5）

按「一条用户消息到下一条用户消息」切轮次，代码先统计用时/token/工具成败，再让 grok-4.5 做意图和综合质量判断。意见写入 `corpus/index.sqlite` 的 `judge_opinions`，以及对话目录 `turns/{序号}/judge.json`。

```text
python -m flywheel judge --limit 3
python -m flywheel judge --user 209612331@qq.com --limit 5
python -m flywheel judge
python -m flywheel judge-status
python -m flywheel web
```

本地评审页（绑 `127.0.0.1:8765`）：按用户 → 项目 → 评审结果展开。每条可标跟进：未处理 / 修复方案 / 修复完成 / 验收，写在本地 sqlite 的 `review_followups`，不改评委结论。`--port` 可改。

`--limit N` 只评尚未有成功意见的轮次（本进程最多 N 条新评价）。日常用 `python -m flywheel judge --limit 5` 一批 5 条往下走。同一指纹默认跳过；`--force-judge` 才重评。图跟着这一轮消息走，单轮最多 4 张（过大或网关 524 会改成纯文本重试）。模型名读 `.env` 的 `GROK_T2T_MODEL` / `GROK_I2T_MODEL`。

## 训练数据集导出

```text
python -m flywheel dataset export
python -m flywheel dataset export --user 209612331@qq.com --output out.jsonl
```

把客户端 cad_detail 写在本地的 evidence 提交标记（`detail-*.evidence.json`）连同 PNG/entities sidecar，按 trace → client_run_id → 对话轮次 → feedback 精确 join 成多模态训练样本。默认输出 `corpus/datasets/cad_detail_samples.jsonl`。结果 JSON 里 `sample_count` 是样本数，`evidence_invalid/unmatched` 是被丢弃/没 join 上的 evidence 数，`evidence_skipped_unsaved` 是出图时 CAD 文档未保存（`drawing.saved == false`）而被默认排除的 evidence 数（`--include-unsaved` 可保留）；`index.sqlite` 缺失时 trace join 不可用，会在 `warnings` 里说明。

## 其它命令

| 命令 | 作用 |
| --- | --- |
| `python -m flywheel pull --dry-run` | 只编目、写对话投影，不下载 OSS |
| `python -m flywheel pull --force` | 无视本地缓存，整库重下（一般不用） |
| `python -m flywheel status` | 看 sqlite 里上次拉取统计 |
| `python -m flywheel verify` | 对照磁盘和当前生产，检查有没有漏 |
| `python -m flywheel dataset export` | 导出 CAD detail 多模态训练样本 |
| `python -m flywheel web` | 本机打开评审浏览器（用户 → 项目 → 评审） |

`verify` 里 `prod_drift` 表示生产和上次快照有计数差（用户还在用），不是抓取出错。`problems` 为空才算通过。

日志里：`already_on_disk` 是跳过的旧对象，`download groups` 是这次真正要 GET 的新对象。

## 数据在哪

```text
flywheel/corpus/
  index.sqlite
  blobs/sha256/{aa}/{sha}          字节只存一份
  users/{email}/
    catalog.json
    projects/{id}__{项目名}/
      tree.json / files_index.json / files/
      conversations/{id}__{标题}/
        messages.md
        pi_sessions/…/{sha256}.jsonl
        traces/
    skills/
    usage_runs.jsonl               没归档对话的用户主要看这个
```

纳入条件：有带消息的对话，或至少有一条 usage。排除 `*@example.com` 和只注册没聊过的账号。天正/晓量安装包等只记清单，不下载。

## 环境（可选）

| 变量 | 默认 |
| --- | --- |
| `FLYWHEEL_ENV_FILE` | `dev/admin/.env` |
| `FLYWHEEL_CORPUS_DIR` | `flywheel/corpus` |
