# CAD 原子能力 staging 管线

这条管线把 THCAD/BricsCAD 的 .NET、COM、LISP/命令和原生盘点转换为可逐条处理的机器清单。当前阶段只生成 JSONL staging 数据，不写 PostgreSQL。

## 谁负责生成 JSONL

JSONL 由确定性代码生成，不由 Agent 根据 Markdown 手写：

- COM：类型库 + `TlbImp` + 反射；
- .NET：程序集反射；
- LISP：LSP 源码扫描；
- Command：当前会话符号与 CUI/CUIX 命令 token；
- Native：PE 导出表。

Agent 负责写另一层 enrichment：操作分类、简述、领域标签、语义能力候选和暂缓/失败原因。原始 `capability-atoms.jsonl` 永不由 Agent 改写。

## 产物目录

```text
data/datasets/staging/cad-capabilities/
  <inventory-id>/
    inventory-manifest.json
    capability-atoms.jsonl
    enrichments/
      part-000001.jsonl
      part-000002.jsonl
    batches/
      next-000001.jsonl
```

`data/datasets/` 已被 Git 忽略。生成器、schema、校验器和说明文档进入版本控制。

## 两层事实

### 原始原子

`capability-atoms.jsonl` 保存扫描器能够确定的事实：来源构件、声明类型、完整签名、参数、返回类型、技术面和当前观测宿主。稳定 ID 规则为：

```text
atom_id = "cap:" + surface + ":" + sha256(canonical_key)[0:24]
```

`canonical_key` 由导出器按固定格式生成，至少包含技术面、逻辑来源构件、声明符号、原子种类和规范化签名；不得包含本机绝对路径、抓取时间或随机值。

### Agent enrichment

enrichment 只能引用原始 `atom_id`，不能重写原子。`operation_kinds` 是多值分类，例如同一方法可以同时是 `read` 和 `compute`，或同时是 `edit` 和 `transform`。

状态：

- `classified`：已有可解释分类；
- `deferred`：证据不足或需要特定对象/参数；
- `failed`：本批处理失败，保留错误原因；
- 没有 enrichment 的原子自动视为 `pending`。

## 通用命令

验证并查看进度：

```powershell
uv run --project backend python data/pipelines/cad_capabilities/catalog_queue.py validate `
  --manifest <inventory>/inventory-manifest.json `
  --atoms <inventory>/capability-atoms.jsonl `
  --enrichments <inventory>/enrichments
```

领取下一批 100 个尚未处理的原子：

```powershell
uv run --project backend python data/pipelines/cad_capabilities/catalog_queue.py next-batch `
  --manifest <inventory>/inventory-manifest.json `
  --atoms <inventory>/capability-atoms.jsonl `
  --enrichments <inventory>/enrichments `
  --limit 100 `
  --output <inventory>/batches/next-000001.jsonl
```

最终验收：

```powershell
uv run --project backend python data/pipelines/cad_capabilities/catalog_queue.py validate `
  --manifest <inventory>/inventory-manifest.json `
  --atoms <inventory>/capability-atoms.jsonl `
  --enrichments <inventory>/enrichments `
  --require-complete
```

`--require-complete` 只要求每个原子都被 `classified/deferred/failed` 归账，不会把 deferred 或 failed 偷换成成功。

## 数据库边界

JSONL 经程序校验和人工抽查后，才进入后续 curated 数据集与 PostgreSQL。当前不要新增 capability 数据库表、导入器、API 或前端页面；这些等首批 COM/.NET 数据形态稳定后另开规格。

完整要求见 [`specs/005-cad-capability-catalog/`](../../../specs/005-cad-capability-catalog/)。
