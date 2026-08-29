# 16 · 制造轮廓与孔槽候选

16 把 12 的 DCEL 面、13 的工程视图区和 15 的保守对象身份整理成可供审图 Agent 查询的轮廓特征。它回答“某视图里有哪些闭合轮廓、内嵌边界、重复特征、共享边和开放线网”，但不凭二维几何把它们直接命名为材料外边、通孔、槽或缺陷。

## 输入与输出

- 输入：13 `EngineeringViewRegionDocument`、12 `PlanarTopologyDocument`、15 `RepresentationIdentityResolutionDocument`；
- 轮廓：只接收外环全部顶点落在同一工程视图区内的有界面，保留面积、周长、中心、轴对齐/定向包围盒、方向、圆度、矩形度、长宽比、直角率、角点数和源 edge/occurrence/handle；
- 内嵌边界：由 12 的面孔洞层级生成 `void_or_nested_part_candidate`，圆形只是形状证据，不等于通孔；
- 关系：输出共享 DCEL 边和内嵌包含关系。前者是图面 face adjacency，不等于零件物理接触；
- 重复特征：在同一视图区内按形状和尺度签名分组，记录局部横排、竖排、斜向共线、成对间距或分布关系；
- 开放边界：保留端点、分支、edge 和来源，只称开放链/开放网络候选，不自动报错；
- 对象摘要：按 15 的物理对象簇汇总各视图候选，但绝不把不同视图的坐标轮廓直接融合。

所有 ID 稳定生成，结果只读。`computed / ambiguous / unsupported_partial` 继承 12 的证据质量；轮廓候选和邻接有独立预算，重复组受轮廓候选上限约束，开放拓扑继承 12/13 的输入规模保护，截断会显式进入诊断。

## 几何口径

圆形判定综合圆度、径向变化和有效角点；矩形判定综合定向最小包围面积、直角率和角点数。定向包围盒同时比较世界轴、PCA 主轴和最长边方向，因此旋转矩形不会仅因不平行世界坐标轴而退化成不规则轮廓。

两个等形特征即使没有落在 13 的局部 X/Y 轴上，也保留欧氏间距为 `pair_spacing_only`；三项以上才用 PCA 检查斜向共线及连续间距。这里只有几何重复和节距事实，不推断孔数标注、紧固件类型或制造工艺。

## 回归

```powershell
powershell -ExecutionPolicy Bypass -File .\local-dev\cad\core\16-manufacturing-profile-features\test-manufacturing-profile-features.ps1
```

合成回归覆盖轴对齐/旋转矩形、两个离散圆、内嵌层级、重复间距、开放 U 链、15 对象摘要、语义防越权和预算截断。12 的保存事实 replay 会继续生成 `manufacturing-profile-features-replay.json`。

2026-08-29 七图保存事实回归处理 22,162 个 12 有界面：19,259 个严格归属到工程视图区，2,903 个保守留空，逐图均满足输入面守恒；得到 6,083 个内嵌边界候选，其中 1,909 个为圆形，另有 1,009 个重复特征组、1,535 个开放拓扑候选和 76 个对象簇摘要。只有最小图为 `computed`，其余两图为 `ambiguous`、四图为 `unsupported_partial`，均与源拓扑状态一致。该回归验证保存事实上的 Core，不替代新版 Adapter 在 THCAD 进程中的重新加载与连续旁数据库验证。
