# 飞轮第一期：把内测数据拉下来

完成于 2026-08-21。这一期只做可复用的抓取，不跑 LLM 分析。

飞轮目标：生产证据 → 按用户落盘 → 以后按问题评价晓量表现。旧脚本 `dev/admin/server/scripts/dump_user_cad_case.py` 一次只挑一条最长 CAD 对话、项目文件只下证据/预览、同一 `pi_session_id` 多次上传会覆盖，不够当语料库。

## 拍板过的取舍

- 清单全量入库，不漏路径；下载跳过安装包/运行时（天正 zip、晓量 setup、`.exe/.msi/.dll/.pak/.cab/.arx/.fas` 等）。工程 zip（如 `34#地块项目.zip`）要下。
- 对话全链路：DB 消息 + 附件 + **全部** Pi Session 快照（不覆盖）+ 子代理 trace/截图 + usage + 反馈 + 文档解析。
- 有 `agent_usage_runs`、但客户端没把对话归档上来的账号也建用户目录。
- 用户文件夹用 email。排除 `*@example.com`。只有空「新对话」、零消息零 run 的账号不算（如 `yaoqipink@163.com`）。
- 空「新对话」写进 catalog，不建空文件夹（除非其实有 Pi Session）。
- 语料不进 git（`.gitignore` 已加 `flywheel/corpus/`）。

## 做了什么

独立包 `flywheel/`，只读生产 PostgreSQL + OSS（凭据 `dev/admin/.env`），本地 sqlite 做索引，字节按 sha256 只存一份。

| 路径 | 作用 |
| --- | --- |
| `classify.py` | 安装包/运行时跳过规则 |
| `pull.py` | 编目 → 按 sha 去重下载 → 硬链接到用户树 |
| `blobs.py` | `corpus/blobs/sha256/{aa}/{sha}` |
| `sqlite_store.py` | `corpus/index.sqlite` 清单与下载状态 |
| `report.py` | `status` / `verify` |
| `extra_orm.py` | admin 没映射的 skill / prompt / 文档解析表 |
| `tests/` | 跳过规则、路径安全 |

用法见 [README.md](README.md)。

落盘：

```text
flywheel/corpus/
  index.sqlite
  blobs/sha256/{aa}/{sha256}
  users/{email}/
    user.json
    catalog.json
    projects/{id前缀}__{项目名}/
      project.json
      tree.json                 # 从文件路径还原的目录名；空目录云端没有，标 empty_dirs_unobserved
      files_index.json          # 全量，含 skipped / missing / deleted
      files/{相对路径}
      conversations/{id}__{标题}/
        messages.jsonl / messages.md    # DB 投影，不截断
        pi_sessions/{session_id}/{sha256}.jsonl
        traces/...
    skills/
    usage_runs.jsonl            # 无归档对话的用户主要靠这个
```

OSS 去重：同一项目同内容多路径共用一个 key；跨项目同内容是不同 key、相同 sha。本地按 sha 存一份，`oss_objects` 里能查出 OSS 侧重复。`upload_status != ready` 记 `missing`，不假装下到了。下载后重算 sha，对不上进 `corpus/quarantine/`。

## 第一次全量拉取（2026-08-21 01:09 CST）

14 个用户：9 个有带消息的归档对话，5 个只有 usage。

| 项 | 数量 |
| --- | --- |
| 项目 / 对话 / 消息 | 64 / 285 / 3551 |
| 项目文件清单 | 6059（含已删 134） |
| 已下载 / 跳过 / OSS 缺失 | 5772 / 103 / 50 |
| 去重 blob | 4892 个，约 5.02GB |
| Pi Session 快照 | 740（738 已下，2 缺失；71 个 session 有多份历史） |
| 子代理轨迹 / 截图 | 230 全下 / 341 |
| 消息附件 | 411（407 已下，4 已删） |
| 自制 skill | 3 用户、33 文件 |
| usage / 反馈 / 文档解析 | 723 / 7 / 43 |
| OSS 同 sha 不同 key | 866 个 sha，多 1651 个对象 |

纳入的用户目录：

- 有项目和对话：`209612331@qq.com`、`wangzhaochang08@163.com`、`2427288349@qq.com`、`490051094@qq.com`、`2269646189@qq.com`、`390951887@qq.com`、`15773224603@163.com`、`2621527246@qq.com`、`330682814@qq.com`
- 只有 usage、无归档对话：`zhoudan@biad.com.cn`、`382901065@qq.com`、`754108975@qq.com`、`donghaifeng41@sina.com`、`598806189@qq.com`

抽查：DWG 在磁盘上；天正安装 zip 只在清单里；`34#地块项目.zip` 等工程包有下；晓量 `Setup`/`晓量.exe`/`uv.exe` 已跳过；同一 session 的多份 jsonl 都留着。

`python -m flywheel verify`：本地清单自洽（5772+103+50+134=6059），blob 无缺失、size 一致。当时生产又多了 5 个项目文件（5925 vs 5930），记为快照漂移，不是抓取漏项。再跑 `python -m flywheel pull` 会按 sha 增量补。

## 已知缺口

- 生产还在写。verify 把与当前生产的计数差标成 `prod_drift`，不当作失败。
- 3 条用户 prompt template 的 OSS 对象是 JSON 包装，和 DB 里 `content_sha256` 对不上，第一次被放进 `quarantine/`。正文已经在各用户 `prompt_templates.json`。代码已改为不再用 content sha 校验 OSS 对象，下次 pull 会把那 3 个对象留下。
- 50 个项目文件 `upload_status != ready`，云端没有可下的对象。
- 云端归档不存空目录，`tree.json` 里 `empty_dirs_unobserved: true`。
- 跳过规则按「天正 / 晓量 setup / 运行时扩展名」。名为 `CAD快速看图…安装包.zip` 这类未点名的安装 zip 仍会下载（约 58MB）。

## 之后怎么增量拉

不要清空 `flywheel/corpus/`，也不要加 `--force`。仓库根目录再跑：

```text
python -m flywheel pull
python -m flywheel verify
```

只关心某个人时：`python -m flywheel pull --user 209612331@qq.com`。

重复是按 **sha256** 消的，不是按文件名。同一张图出现在两个项目里，OSS 上可能有两个 key，本地 blob 只有一份；新路径会再硬链接一次。Pi Session 按 `(session_id, sha256)` 各留一份，用户多聊几轮会出现新快照，旧的不动。

每次仍会扫一遍生产库编目（分钟级），但已在磁盘上的对象不会再走 OSS。日志里 `already_on_disk` 是跳过的条数，`download groups` 才是这次真正要 GET 的新对象。

## 下一期

还没做：按用户问题切 case、对照项目文件/轨迹打分、产出观察报告和回归候选。语料已经按用户-项目-对话铺好，可以直接扫 `corpus/users/*/projects/*/conversations/*`。
