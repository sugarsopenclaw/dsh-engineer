# 15 · 表示身份解析

15 把 13 的工程视图表示和 14 的对应关系整理成一张可执行的身份图。它解决“哪些表示已经足以合并、哪些只应等待复核、哪些绝不能合并”，不负责凭相似外形猜零件名称。

## 输入与输出

- 固定输入：13 `EngineeringViewRegionDocument` 与 14 `RepresentationCorrespondenceDocument`；
- 可选输入：额外的物理表示、表格记录、类型详图，以及来自 04、人工映射或专业对象稳定引用等独立来源的身份断言；
- 输出：表示清单、五类身份断言、保守物理对象簇、`same_object_possible` 候选组、同型候选组、表格挂接结果、被硬约束阻断的合并和诊断；
- 所有 ID 稳定生成，原断言、来源种类和 source ID 均保留，结果只读。

## 五类边的严格口径

1. `same_object_supported`：唯一可触发物理对象合并的边；必须来自 14 之外的独立证据，并带 evidence grade、source kind 和 source ID。
2. `same_object_possible`：正投影站位对齐或其他候选证据；只形成候选组，永不合并。
3. `different_object_proven`：硬负约束；合并前检查两个当前簇的所有成员，因此能阻断传递合并，而不只阻断直接边。
4. `same_type_only`：重复/相似几何最多形成同型候选组，对对象身份没有作用。
5. `represents_type`：实例到类型参考的候选关系，只进入类型组。

每个 13 工程视图先成为一个保守单例对象簇。单例表示“目前没有足够合并证据”，不表示它与其他单例已经证明为不同对象。15 也不会因两个区域处于同一张图或同一视图上下文就自动生成 `different_object_proven`。

## 表格记录边界

`schedule_record`（如 BOM 行）不能单独组成物理对象簇。只有它的全部有效 `same_object_supported` 链接都落到同一个已经解析的物理簇，而且没有与簇内任一成员的硬负约束时，才挂到该簇；多目标、负约束或无链接都显式保留为未解析状态。

当前 THCAD Adapter 没有把 04 的 BOM 行直接连到整个 13 视图区域，因为序号指向的是视图内构件，视图 scope 本身不等于该构件。后续得到更细的构件表示和独立 authored mapping 后，可通过公开 observation/evidence 输入接入，不需要修改合并内核。

## 运行回归

```powershell
powershell -ExecutionPolicy Bypass -File .\local-dev\cad\core\15-representation-identity-resolution\test-representation-identity-resolution.ps1
```

合成回归覆盖：几何关系零合并、强边合并、传递负约束阻断、候选组不合并、同型与对象身份分离、单目标/多目标/簇内负约束三种表格挂接，以及“几何重复伪装成强证据”降级。保存事实回归由 12 的 replay 脚本继续生成 `representation-identity-resolution-replay.json`。
