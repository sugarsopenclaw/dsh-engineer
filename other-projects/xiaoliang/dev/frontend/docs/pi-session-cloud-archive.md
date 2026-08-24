# Pi Session 云归档

状态：已实现最小归档闭环。

## 目标

Pi JSONL 是主 Agent 会话、工具调用和 Tree 的完整事实源。云端不把每个 Entry 重复拆成业务表，而是：

- OSS 原样保存不可变 JSONL 版本。
- 数据库保存归属、哈希、版本和关键关系。
- 现有 `project_archive_messages` 继续保存活动路径投影，服务界面、搜索和快速查询。

## 数据关系

`pi_session_archives` 通过以下字段建立最小索引：

```text
organization / project / conversation
→ pi_session_id
→ parent_pi_session_id
→ sha256 / storage_key
→ runtime_version / jsonl_schema_version
→ current_leaf_entry_id / entry_count
```

JSONL 内的 `entry.id` 和 `entry.parentId` 负责还原完整 Tree，不另建 Entry 明细表。

活动路径消息额外同步 `client_run_id`、`pi_session_id` 和 `pi_entry_id`。用户反馈保存相同的 Pi 身份；Subagent 归档保存父级 `pi_session_id` 和用户 Prompt 的 `pi_entry_id`，从而可以把主 Agent、Subagent、用量与反馈重新关联。

## 上传流程

1. 桌面端先同步会话元数据和活动路径。
2. 完整读取并校验本地 JSONL；不完整行不会上传。
3. 后端按内容哈希创建版本记录并返回 OSS 签名地址。
4. 桌面端上传原始字节。
5. 后端检查 OSS 对象大小、SHA-256 元数据和实际内容后标记 `ready`。
6. 相同哈希直接复用；哈希变化时保留新的归档版本，不覆盖旧版本。

空会话和 reset 后的会话也会同步，因此云端可以正确清空旧的活动路径投影。

## 边界

- 原始归档不等同于训练授权，当前 `training_consent` 保持 `false`。
- 数据清洗、Tree 展开和训练样本生成以后离线完成。
- 本阶段不新增 Entry 范式化表、训练数据表或复杂同步队列。
