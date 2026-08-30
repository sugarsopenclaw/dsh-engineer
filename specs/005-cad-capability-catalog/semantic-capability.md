# 005 附录 — SemanticCapability 与跨技术候选关系

本附录属于 `specs/005-cad-capability-catalog/`。它不替换 CapabilityAtom，也不授权 PostgreSQL 物化。Goal 8 在用户确认进入本阶段后生成独立候选数据集；入库仍须另一次明确授权。

## 对象

**SemanticCapability** 是跨技术功能聚类的语义对象，例如“删除 CAD 实体”。它不是方法重载，也不是命令 token。

稳定 ID：

```text
semantic_capability_id = "sem:" + slug
```

`slug` 只含 `[a-z0-9._-]`。

## 关系

### IMPLEMENTS

若干技术原子可以实现同一 SemanticCapability。原子保持独立：`.NET Entity.Erase`、`COM IAcadEntity.Delete`/`Erase`、`LISP/Command _ERASE` 不得合并或删除。

每条记录必须包含：

| 字段 | 含义 |
| --- | --- |
| `status` | `proposed` / `verified` / `rejected` |
| `confidence` | 置信度，0–1 |
| `basis` | 依据 |
| `producer` | 产生者 |

`verified` 仅当该关系或被引用原子带有 `runtime_probe` 或 `human_review` 证据。

### LOGIC_USES_CAPABILITY

`local-dev/cad` 的 01—07 Logic 只有在源码真实调用，或同目录文档/已有运行证据已经写明该调用时，才允许连接原子或语义能力。禁止“看起来可能会用”。宿主无关 Core（02—07，无 Teigha/Bricscad using）不得发明 CAD API 使用。没有证据的 Logic 允许零条关系。

## 匹配信号

候选匹配综合 `operation_kinds`、`domain_tags`、声明类型、完整参数/返回类型、`summary` 和已有 runtime evidence。成员同名只是弱信号：声明类型、签名或 `operation_kinds` 不同时，不得仅凭同名给出高置信 `IMPLEMENTS`。

既有 enrichment 的 `semantic_candidates` 只作为 `proposed` 输入，不得批量升级为 `verified`。

原生 PE 导出仍是未知签名线索，不因修饰名猜测进入 IMPLEMENTS。

## GraphView

三种视图只规定数据语义，不实现前端或图谱 API：

| `view_kind` | 节点 | 含义 |
| --- | --- | --- |
| `surface` | CapabilityAtom（本阶段仅纳入已有 IMPLEMENTS 的原子） | 按技术面观察入口 |
| `semantic` | SemanticCapability 及其 IMPLEMENTS 原子 | 跨技术功能聚类 |
| `logic-affinity` | Logic 01—07 及其 LOGIC_USES 目标 | 产品能力与原子的证据连接 |

坐标属于 `GraphLayoutPosition`（挂在 `GraphView` 下），不属于 atom / semantic / logic 对象。第一版坐标是稳定伪随机布局：种子为 `view_id + inventory_id + node_id` 的 SHA-256；同一种子必须得到同一 `x,y,z`。

## 产物

JSONL 写入 `data/datasets/staging/cad-capabilities/thcad-v24.semantic/`（不进 Git）。规格、schema 与生成器进 Git。本阶段不建 capability 表、不提供图谱 API、不进入 Goal 9 运行时探针。
