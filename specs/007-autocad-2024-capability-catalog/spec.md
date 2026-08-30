# 007 — AutoCAD 2024 原子能力采集

## 目标

在本机已经安装并打开的 AutoCAD 2024 上，建立一批与 THCAD V24 完全隔离、可重建、可校验的 `CapabilityAtom` 库存。采集结果只描述当前 AutoCAD 2024 安装、注册表和运行时会话中实际观察到的技术原子，不建立原子之间、原子与 Logic 之间或原子与业务需求之间的关系。

## 本轮范围

采集以下五个技术面：

- COM 类型库、接口成员、属性访问器、事件和 ProgID 激活入口；
- .NET 公开程序集中的方法重载、构造器、属性访问器、事件与公开字段读写入口；
- AutoLISP 源码定义和当前会话中可证明存在的函数；
- 当前会话命令、CUI/CUIX 命令 token 与宏；
- AutoCAD 2024 安装目录和当前已加载产品模块中的 PE 导出候选。

读取、计算、创建、写入、编辑、删除、变换、保存、导入、导出、选择、显示、调用、事件和生命周期入口都属于采集范围。采集这些入口不等于在用户当前图纸上逐一执行它们。

## 数据隔离

AutoCAD 数据只能写入：

```text
data/datasets/staging/cad-capabilities/
  autocad-2024.com/
  autocad-2024.dotnet/
  autocad-2024.lisp/
  autocad-2024.command/
  autocad-2024.native/
```

固定观测宿主为 `autocad-2024`，固定库存 ID 为以上五个目录名。不得修改、删除、覆盖或把新结果写入任何 `thcad-v24.*`、`thcad-v24.semantic` 或 `data/datasets/curated/cad-capabilities/v1/` 目录。

扫描器和可复现代码进入：

```text
dev-test/visualstudionetframework/probes/autocad-2024/
data/pipelines/cad_capabilities/
```

AutoCAD 专用脚本放前一个目录；真正可跨宿主复用的原子化、校验和分类逻辑才放后一个目录。不得复制一份只改名称的公共 Python 管线。

## 需求

- **R1 宿主实证**：开始扫描前，从运行进程、可执行文件版本、COM/ROT、注册表或 AutoCAD 运行时中至少取得两类相互吻合的证据，确认目标是 AutoCAD 2024。不得只根据用户口述或默认安装路径写入宿主 ID。
- **R2 路径白名单**：安装文件扫描范围必须由实际 `acad.exe`、注册表或已加载模块解析得到。不得扫描 THCAD、THSOFT 或 BricsCAD 安装目录后标记为 AutoCAD。
- **R3 确定性原始层**：`inventory-manifest.json` 和 `capability-atoms.jsonl` 必须由类型库、程序集元数据、LSP/CUI 文件、当前会话或 PE 导出表直接生成，禁止 Agent 从 Markdown 手抄原子。
- **R4 原子粒度**：重载、getter/setter、事件 add/remove、field read/write、同名不同声明类型必须分别保存；枚举常量等支持符号不得伪装成可执行 Action。
- **R5 来源完整**：每条原子必须保留来源构件、声明符号、完整签名、参数、返回类型、静态/实例、提取器和来源定位。原始记录不得包含本机绝对路径。
- **R6 独立宿主事实**：每条原子的 `observed_host_ids` 必须只包含本次实际证实的 `autocad-2024`。不得因为名称相似写入 `thcad-v24`，也不得宣称某原子是 AutoCAD 独有。
- **R7 属性分类**：允许使用现有 enrichment 管线补充 `classification_status`、`operation_kinds`、`domain_tags`、summary、confidence 和 evidence；`semantic_candidates` 必须为空，不生成 SemanticCapability 或关系文件。
- **R8 禁止证据串宿主**：不得把 THCAD、Teigha、BricsCAD 或 `TH_XuHaoEntity` 的运行证据附到 AutoCAD 原子。复用旧分类器时必须隔离宿主专属规则。
- **R9 完整归账**：每个库存必须通过公共 schema、稳定 ID、唯一性、manifest 计数和 SHA-256 校验；COM、.NET、LISP、Command enrichment 必须达到 `pending=0`。无法判断操作语义的真实原子可以 `deferred`，但不能丢弃；Native 没有可证明签名时不强制 enrichment，保持显式 `pending` 并按 manifest 完整计数。
- **R10 确定性复跑**：对同一冻结输入连续生成两次，原子顺序、`canonical_key`、`atom_id` 和 `capability-atoms.jsonl` SHA-256 必须一致。
- **R11 有界全量**：最终报告必须列出每个技术面的来源边界、文件/类型库/程序集/会话版本、错误数和未覆盖范围。“全量”只指 manifest 声明范围内无漏项。
- **R12 停止边界**：本轮不生成跨宿主对比、不生成任何关系、不修改 Ontology、不导入 PostgreSQL、不改后端或前端。完成五个库存后等待人工确认。
- **R13 旧数据保护**：开始前记录五个 `thcad-v24` 原始库存 manifest 与 atoms 文件的哈希，结束后复核完全一致；如果发生差异，任务不能报告完成。

## 复用原则

公共 schema、稳定 ID、校验器和 atomizer 以以下内容为准：

- `specs/005-cad-capability-catalog/`
- `data/pipelines/cad_capabilities/README.md`
- `data/pipelines/cad_capabilities/schemas/`
- `data/pipelines/cad_capabilities/catalog_queue.py`

现有 `ExportThcad*` 脚本只能作为实现参考，不能直接用默认参数运行，也不能改坏 THCAD 的已完成采集。优先保留共享 C# 扫描内核，为 AutoCAD 新建薄入口并把宿主、来源目录、程序集清单、类型库清单和输出目录参数化。

## 完成条件

1. 五个固定 inventory 均存在 manifest 与原子 JSONL；COM、.NET、LISP、Command enrichment 均已完整归账；Native 未知签名原子允许保持 `pending`，但必须在最终汇总中单独计数。
2. 所有原始库存通过公共 validator；无未知 enrichment ID、无重复 ID、无静默跳过。
3. 同一冻结输入的二次导出哈希一致。
4. 自动化测试覆盖新增的 AutoCAD 宿主解析和至少一种跨宿主隔离失败场景。
5. 最终报告给出五个 inventory 的来源、原子总数、by-kind、分类分布、错误、产物路径和复现命令。

## 后续但不在本轮

人工确认 AutoCAD 库存后，可另开规格构建 AutoCAD 独立 curated 数据集，再与 THCAD V24 做“完全相同、高概率等价、仅本次 AutoCAD 观察到、仅本次 THCAD 观察到、待判断”五类对比。对比结果不得反向改写两个宿主的原始原子。
