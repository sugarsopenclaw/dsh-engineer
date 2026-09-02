# CAD 原子能力 staging 管线

这条管线把 THCAD/BricsCAD 的 .NET、COM、LISP/命令和原生盘点转换为可逐条处理的机器清单。原始扫描和 enrichment 先进入 staging；人工确认后由同目录的确定性管线构建 curated 数据集，再由本机 SQLite 查询层导入。

## 谁负责生成 JSONL

JSONL 由确定性代码生成，不由 Agent 根据 Markdown 手写：

- COM：类型库 + `TlbImp` + 反射（`dev-test/visualstudionetframework/probes/ExportThcadComCapabilityAtoms.ps1` 扫描，`com_atoms.py` 写成 CapabilityAtom）；
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

## COM 原始导出

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File dev-test/visualstudionetframework/probes/ExportThcadComCapabilityAtoms.ps1
```

默认写入 `data/datasets/staging/cad-capabilities/thcad-v24.com/`。安装路径可通过参数覆盖；`canonical_key` / `atom_id` / JSONL 不含本机绝对路径。

.NET 原始导出：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File dev-test/visualstudionetframework/probes/ExportThcadDotNetCapabilityAtoms.ps1
```

默认写入 `data/datasets/staging/cad-capabilities/thcad-v24.dotnet/`。

LISP / 命令 / CUI 宏原始导出（拆成 `lisp` 与 `command` 两个 inventory，不从 Markdown 抄写）：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File dev-test/visualstudionetframework/probes/ExportThcadLispCommandCapabilityAtoms.ps1
```

默认写入 `data/datasets/staging/cad-capabilities/thcad-v24.lisp/` 与 `thcad-v24.command/`，并冻结 `thcad-v24.lisp-command-scan.json`。需要已打开的 THCAD 会话供 `atoms-family` 探针附着。

原生 PE 导出候选（`surface=native`，`atom_kind=native_export`，返回类型与参数保持未知，不生成 P/Invoke）：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File dev-test/visualstudionetframework/probes/ExportThcadNativeCapabilityAtoms.ps1
```

默认写入 `data/datasets/staging/cad-capabilities/thcad-v24.native/`。安装路径可参数化；`canonical_key` / `atom_id` / JSONL 不含本机绝对路径。

.NET enrichment（不改原始 atom，每批 100 条，只追加 `enrichments/part-*.jsonl`）：

```powershell
uv run --project backend python data/pipelines/cad_capabilities/dotnet_enrichment.py `
  --manifest data/datasets/staging/cad-capabilities/thcad-v24.dotnet/inventory-manifest.json `
  --atoms data/datasets/staging/cad-capabilities/thcad-v24.dotnet/capability-atoms.jsonl `
  --enrichments data/datasets/staging/cad-capabilities/thcad-v24.dotnet/enrichments `
  --batches data/datasets/staging/cad-capabilities/thcad-v24.dotnet/batches
```

LISP / 命令 / 宏 enrichment（不改原始 atom，每批 100 条，lisp 与 command 库存分别循环，只追加 `enrichments/part-*.jsonl`；不调用未知命令）：

```powershell
uv run --project backend python data/pipelines/cad_capabilities/lisp_command_enrichment.py `
  --manifest data/datasets/staging/cad-capabilities/thcad-v24.lisp/inventory-manifest.json `
  --atoms data/datasets/staging/cad-capabilities/thcad-v24.lisp/capability-atoms.jsonl `
  --enrichments data/datasets/staging/cad-capabilities/thcad-v24.lisp/enrichments `
  --batches data/datasets/staging/cad-capabilities/thcad-v24.lisp/batches

uv run --project backend python data/pipelines/cad_capabilities/lisp_command_enrichment.py `
  --manifest data/datasets/staging/cad-capabilities/thcad-v24.command/inventory-manifest.json `
  --atoms data/datasets/staging/cad-capabilities/thcad-v24.command/capability-atoms.jsonl `
  --enrichments data/datasets/staging/cad-capabilities/thcad-v24.command/enrichments `
  --batches data/datasets/staging/cad-capabilities/thcad-v24.command/batches
```

COM enrichment（不改原始 atom，每批 100 条，只追加 `enrichments/part-*.jsonl`）：

```powershell
uv run --project backend python data/pipelines/cad_capabilities/com_enrichment.py `
  --manifest data/datasets/staging/cad-capabilities/thcad-v24.com/inventory-manifest.json `
  --atoms data/datasets/staging/cad-capabilities/thcad-v24.com/capability-atoms.jsonl `
  --enrichments data/datasets/staging/cad-capabilities/thcad-v24.com/enrichments `
  --batches data/datasets/staging/cad-capabilities/thcad-v24.com/batches
```

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

跨技术 SemanticCapability 候选（不改原始 atom，不写 PostgreSQL）：

```powershell
uv run --project backend python data/pipelines/cad_capabilities/semantic_relations.py `
  --com-atoms data/datasets/staging/cad-capabilities/thcad-v24.com/capability-atoms.jsonl `
  --com-enrichments data/datasets/staging/cad-capabilities/thcad-v24.com/enrichments `
  --dotnet-atoms data/datasets/staging/cad-capabilities/thcad-v24.dotnet/capability-atoms.jsonl `
  --dotnet-enrichments data/datasets/staging/cad-capabilities/thcad-v24.dotnet/enrichments `
  --lisp-atoms data/datasets/staging/cad-capabilities/thcad-v24.lisp/capability-atoms.jsonl `
  --lisp-enrichments data/datasets/staging/cad-capabilities/thcad-v24.lisp/enrichments `
  --command-atoms data/datasets/staging/cad-capabilities/thcad-v24.command/capability-atoms.jsonl `
  --command-enrichments data/datasets/staging/cad-capabilities/thcad-v24.command/enrichments `
  --logic-root . `
  --output-dir data/datasets/staging/cad-capabilities/thcad-v24.semantic
```

## Curated 与本机 SQLite

构建器支持两个不可互相覆盖的数据集版本：

- `v1`：仅含 THCAD V24 的 5 个库存、79,549 个原子；
- `v2`：含 THCAD V24 与 AutoCAD 2024 的 10 个独立库存、334,049 个原子。

当前默认构建仍保留 v1 的兼容行为；综合 v2 使用显式参数：

```powershell
uv run --project backend python data/pipelines/cad_capabilities/build_curated.py
uv run --project backend python data/pipelines/cad_capabilities/build_curated.py --dataset-version v2
```

分别输出到 `data/datasets/curated/cad-capabilities/v1/` 与 `v2/`。构建器逐库存校验并以有界内存合并已排序片段；Native 原子没有 enrichment 时明确保存为 `classification_status=pending`，不猜测调用协议。v2 中两个宿主保持独立行，不按名称合并，也不生成同义或兼容关系。

导入本机 SQLite（默认 v2，本机生成 gzip 图投影，不经过 OSS）：

```powershell
uv run --project backend python data/pipelines/local_query_store/load_sqlite.py --kind cad-capabilities
```

默认写入 `data/datasets/local/cad-capabilities.sqlite`。旧的 `load_postgres.py` 与 `load_postgres_via_oss.py` 入口会立即失败，不得再对 `DATABASE_URL` 写入。当前物化范围只有库存、原子属性和同源传输投影；SemanticCapability、Logic 和运行矩阵仍留在独立数据层。详见 [`../local_query_store/README.md`](../local_query_store/README.md)。

完整要求见 [`specs/005-cad-capability-catalog/`](../../../specs/005-cad-capability-catalog/)。

## AutoCAD 2024 独立采集

AutoCAD 2024 的新一轮采集必须使用独立的 `autocad-2024.*` inventory，不得覆盖上述 THCAD 数据。启动目录、范围、停止边界和单 Goal 提示词见：

- [`specs/007-autocad-2024-capability-catalog/`](../../../specs/007-autocad-2024-capability-catalog/)
- [`dev-test/visualstudionetframework/probes/autocad-2024/README.md`](../../../dev-test/visualstudionetframework/probes/autocad-2024/README.md)
- [`docs/dev/2026-08-28-AutoCAD-2024-原子能力采集-Goal提示词.md`](../../../docs/dev/2026-08-28-AutoCAD-2024-原子能力采集-Goal提示词.md)

该采集 Goal 只生成原子库存及操作属性；其结果经人工确认后已由 [`specs/008-cad-capability-multi-host-dataset/`](../../../specs/008-cad-capability-multi-host-dataset/) 物化为综合 v2。本轮仍未生成跨宿主对比或关系。
