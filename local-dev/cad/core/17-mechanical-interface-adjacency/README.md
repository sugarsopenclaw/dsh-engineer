# 17 · 机械接口与装配邻接候选

17 把 16 的视图内轮廓特征组织成接口/邻接证据图。它回答“哪些嵌套边界可能构成接口特征、哪些形成同轴或重复模式、哪些图面边界相邻、哪些开放端靠近轮廓”，但不凭二维投影证明孔、法兰、螺栓、配合、物理接触或绘图缺陷。

## 输入与输出

- 输入：13 `EngineeringViewRegionDocument`、12 `PlanarTopologyDocument`、15 `RepresentationIdentityResolutionDocument` 和 16 `ManufacturingProfileFeatureDocument`；
- 接口特征候选：16 的每个内嵌边界一一投影为圆形、矩形、长形或不规则嵌套特征，保留 host/boundary profile、中心、定向尺寸、面积、面积等效直径、edge、occurrence 和 handle；面积等效直径不是非圆特征的实际孔径；
- 接口模式：输出 profile 包含特征、直接嵌套且中心对齐的圆形同轴栈、方向对齐的棱柱形嵌套栈，以及 16 已验证的重复特征模式；
- 邻接证据：把 16 的共享 DCEL 边分成纯 face adjacency 和多个 occurrence/句柄重合支持两级；另以空间索引测量开放分量端点到最近轮廓边的实际间隙；
- 对象摘要：按 15 物理对象簇建立索引，但不同视图的投影几何不融合。

输出保留中心残差、角度残差、尺寸比、名义间隙、共享长度、容差和完整来源。特征、模式、邻接均有规模上限；任何截断或源 12/16 降级都会显式传播为 `ambiguous / unsupported_partial`。

## 关键判定口径

同轴候选不对同一区域的全部圆做两两组合，只沿 16 的直接孔洞层级比较父子特征；要求中心残差小于视图区尺度容差，并要求尺寸存在明确分离。这样保留垫圈/台阶孔/同心套等后续解释入口，同时避免把远处同心投影或同尺寸重线误组装。

邻接分三层保存：

1. `drawing_face_adjacency_observation` 只表示两个 DCEL 面共享规范边；
2. `coincident_multi_source_boundary_candidate` 还要求规范边上存在多个 occurrence 或句柄支持，但仍可能只是块实例重合、重复绘制或装配投影；
3. `open_terminal_near_profile_boundary_candidate` 只记录端点、最近边、gap 和 tolerance，不把小间隙自动叫断线，也不把零间隙自动叫连接。

## 回归

```powershell
powershell -ExecutionPolicy Bypass -File .\local-dev\cad\core\17-mechanical-interface-adjacency\test-mechanical-interface-adjacency.ps1
```

合成回归覆盖直接嵌套同心圆、等形重复圆、重复绘制的分界边、距外轮廓 0.02 的开放端、预算截断和五项语义防越权。

2026-08-29 七图保存事实回归将 16 的 6,083 个内嵌边界全部投影为接口特征候选，其中圆形 1,909 个；得到 7,485 个模式记录，包括 6,083 个包含关系、1,009 个重复模式和 393 个圆形同轴候选，当前没有满足严格条件的棱柱形对齐嵌套栈。另得到 31,388 条邻接证据，其中 6,305 条具备多 occurrence/句柄重合支持、66 条为开放端近接。76 个 15 对象簇均有不融合几何的摘要，诊断为 0，逐图状态与 12/16 一致。该回归验证保存事实上的 Core，不替代新版 Adapter 在 THCAD 进程中的重新加载与连续旁数据库验证。
