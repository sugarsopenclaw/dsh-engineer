# CAD 原子能力 Ontology v1

[`ontology.yaml`](ontology.yaml) 只定义 `CapabilityInventory` 和 `CapabilityAtom` 类型。当前默认对象实例来自 `cad.capabilities.curated.v2`，由 `data/pipelines/cad_capabilities/` 构建并物化到 PostgreSQL；仅含 THCAD V24 的 `cad.capabilities.curated.v1` 仍作为历史快照保留。

`surface` 表示 COM、.NET、LISP、Command 或 Native 等技术面；`observed_host_ids` 表示已经观察到该原子的宿主安装。当前包括 `thcad-v24` 与 `autocad-2024` 的独立原子行，但不能仅由名称或宿主观测推断二者兼容、共用或等价。

本版本没有把语义簇、Logic、运行记录或 Review 物化为对象。
