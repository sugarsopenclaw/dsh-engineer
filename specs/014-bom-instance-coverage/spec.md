# 014 · BOM 实例覆盖对账

状态：Implemented

## 目标

在不修改 DWG 的前提下，把 04 已解析的 BOM 序号段、11 的块实例世界坐标和 13 的工程视图区组合为确定性覆盖账本：锚定序号所指块定义，枚举全图同定义实例，并与全部序号指向交叉对账。

## 输入与输出契约

- 输入是内存中的 `MechanicalBomKnowledgeDocument`、`BlockInstanceCoordinateDocument` 和 `EngineeringViewRegionDocument`，Core 不引用 THCAD。
- 仅处理 `target_status == resolved_shared_target` 的段；没有目标点的段仍原样列出，但不枚举实例。
- 锚点先落到最近叶子 occurrence，再取叶子路径中最深的块引用 owner，并以该引用的 `target_definition_handle` 作为实例类身份。
- 同一定义 handle 的每个块引用 occurrence 都是一项实例；MINSERT 单元格、嵌套插入和镜像插入分别计数。
- 每项实例分类为 `pointed`、`pointed_by_other_item`、`unpointed_candidate` 或 `in_documentation_region`，并保留序号、句柄、视图区、位置和足迹证据。
- 原始 `values.quantity` 与 `parsed_values.quantity.value` 只和覆盖计数并列输出，不做数量一致或 BOM 错误判定。

## 确定性边界

- `unpointed_candidate` 只表示“同块定义且未被已解析序号指向”；多视图重复表达、对称画法和示意表达都可能合法。
- v1 不用松散线网或拓扑签名猜构件；锚点落在根空间散线时输出 `not_matchable_loose_geometry`。
- 视图归属使用实例插入点落入的最小非纸张结构区域，不跨视图合并物理对象身份。
- 匿名块仍按 definition handle 对账并留下诊断；动态块只按 11 当前暴露的有效 definition handle 分组，不收束 authoring definition 变体。
- 实例明细有显式上限；超限保留完整计数、截断明细并留下诊断。

## 产品接入

- 能力编号：21。
- 产物：`bom-instance-coverage.json`、`bom-instance-coverage.md`。
- `DrawingExtractor` 在 13 之后、14 之前调用本能力。
- Pi 机械子代理通过既有 `thcad_analysis` 的 catalog/summary/query 读取，不新增工具或子代理。

## 非目标

- 不做松散几何拓扑签名匹配。
- 不做跨视图物理实例合并。
- 不接入 19 的版本快照或视觉确认。
- 不输出“漏标”“数量错误”或任何审图缺陷结论。

## 验收

- 五组合成回归覆盖普通遗漏候选、散线锚点、MINSERT/镜像、文档区排除和其他序号占用。
- Bridge Release 构建、Pi 类型检查和既有测试通过。
- 真图生成 21 号 JSON/Markdown、报告计数和桥 artifact 状态；观察数字只作样本记录，不设为真值断言。
- 最终人工真值需在工作区副本中手工删除一个序号气泡后重抽，确认相应实例进入候选。
