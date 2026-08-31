# Pi–THCAD BOM 构件视觉精读

## 结论

主 Agent 现在只需调用一次 `delegate_thcad_bom_close_reading`。工具内部按 capability 04 的序号段遍历 BOM，对每个共同指向构件生成一对局部图、组织选中态拓扑和 BOM 准则，再交给 fresh 视觉 child 做机械/变压器语义推理。不把 04/08/11/13 的零碎操作暴露给视觉 Agent。

```text
04 BOM 行 + 序号关联坐标
  → 序号指向图（识别 19→20→21 等局部连接）
  → 共同指向点
  → 11 块实例世界坐标几何 + 13 视图边界
  → 不遗漏构件窗口
  ├─ THCAD SetWindowToPlot 原生完整图
  └─ 08/10/11 驱动的去干扰图（保留目标、相交上下文与未知线型）
  → BOM + 序号段 + 选中态拓扑 + 两图
  → fresh vision child
  → 每项几何对应 / 当前投影 / 其他视图推导 / 装配作用
```

## 04 序号段

04 不再只保存“BOM 行→一个序号气泡”。它使用序号数字位置和指向点建无向图：当一个气泡的指向端落在它与另一气泡中心之间，并满足局部共线/比例条件时，建立 `serial_balloon_points_to_preceding_balloon`。连通分量是一段语义，唯一非内部指向端是共同构件目标。

真图回归暴露了一个边界：只用线段投影比例，远处引线会因偶然共线把两串序号误合并。现在额外使用本图气泡最近邻距离的下四分位估计绘图尺度，内部连边最大为该尺度的 4 倍。样图真实局部连接中心距约 `197–215`，三千余单位的偶然共线因此被排除。

## 成对出图

- **完整图**：使用 THCAD 模型布局的 `SetWindowToPlot + PlotToFile`，窗口来自世界坐标，不调用 Zoom，不移动当前视口。当前机器只有 PDF PC3，因此用 `DWG To PDF2.pc3` 出 PDF，再由独立 `uv`/pypdfium2 脚本栅格化为 PNG。
- **去干扰图**：使用 11 的展平世界坐标 path 绘制同一 bbox。只去除 08 已识别标注、外部剖面线、与目标不相交的外围线和超长跨界上下文；目标块全保留，未知颜色/线型若在构件上仍保留。
- 两图使用同一窗口与像素尺寸，sidecar 保存所有保留/移除 occurrence、handle、layer、linetype、color、bbox、线长/直径统计和清理原因。
- 每次 Plot 保存模型布局、PC3、媒体、`TILEMODE`、`BACKGROUNDPLOT`、`VIEWCTR`、`VIEWSIZE`和 `DBMOD`。THCAD COM 不能直接恢复某些原打印机名时，使用已验证的布局字典回写，最后回读校验；任一状态不等即失败，不静默留下现场变化。

## 视觉推理口径

- .NET 直接告诉 child 序号段成员共同指向目标；图中不必包含气泡。
- BOM 的代号、名称、数量、规格和备注作为业务准则。当前平面投影没有直接显示某一维时，child 应结合 BOM 和机械画法几何推得其他视图/剖面，不做置信度降级。
- 输出覆盖每个序号的 `geometry_mapping`、`current_projection`、`inferred_other_views`、`assembly_role`和 `mechanical_reasoning`，另有段级装配关系、变压器领域解读和真实图/BOM 冲突。新 schema 没有数字置信度字段。
- 当前默认 `deepseek/deepseek-v4-flash-vision-exp` + `high`；根 `.env` 的 `SHENBIAN_THCAD_VISION_MODEL` / `SHENBIAN_THCAD_VISION_THINKING` 可切换到后续 Qwen 视觉模型，不改业务管线。

## 真图验证

`5TBC.384.A110050.1_1.DWG`、DBMOD 21 的序号 19/20/21 完整跑通：

- 04 生成唯一三成员 `connected_serial_run`：20 指向 19 气泡、21 指向 20 气泡，19 的远端 `[752.7137,5599.4692]` 为共同目标；
- BOM：19 `板16×280×350`、20 `加强铁300×400×100×20` 数量 2、21 `法兰`；
- 原生 Plot 与去干扰图均为 `2048×2048`，视口前后不变、DBMOD `21→21`、原 `Canon PlotWave 3500 / 自定义大小 1` 恢复；
- DeepSeek 精读将三项解释为法兰、垫板和两块加强铁的共同装配，并从 BOM 积极推导 16mm 垫板厚度、100mm 加强铁高度等剖面语义；
- 完整 review bundle 校验通过：20 个 bundle 文件、46 个 CAS 对象，0 个哈希/大小问题。

现场运行包在被 Git 忽略的 `.pi/runtime/thcad-reviews/runs/thcad-2026-08-30T11-16-55-960Z-9b50bb5d-dfea-4011-868e-e0de57de4d45/`。

## 落盘与后续训练

每次高层调用保存：`request.json`、父/子系统提示、`batch-plan.json`、每段两张 PNG、sidecar、真实 vision prompt、child JSONL events、child session、stderr、原始最终正文、结构化结果、`coverage.json`、`evidence.md`、01–20 artifact 快照和内容寻址对象。默认仍是 `unreviewed / training_eligible=false`；人工审核、授权与筛选后再进入训练数据管线。

## 实现中的四个重要边界

1. THCAD 当前 AppDomain 不会热替换同名、同版本 .NET 程序集。视觉精读初次验证时用 `Shb.Thcad.AgentBridge.V3` / `SHBTHCADAGENTV3` 与旧 Bridge 并存；图纸会话与文字检索继续顺延为当前的 V4，均遵守“新身份旁加载，不重启 dirty THCAD”的原则。
2. Windows 进程命令行有长度上限。精读拓扑证据较大，直接把 prompt 作为 CLI 参数会 `spawn ENAMETOOLONG`。现在系统提示和 user prompt 都通过 Pi 公开的文件入口加载，同时完整保留文件证据。
3. 从开发终端直跑 runner 不会自动加载根 `.env`，而正式 `start-pi.ps1` 会加载。现场测试必须按正式启动口径，不应把“测试 shell 没有 API key”误判为模型集成失败。
4. DeepSeek 视觉模型偶尔会在 reasoning 部分直接给出完整 JSON 而不另发 text，也出现过所有字段均已结束但只漏最外层一个 `}` 的输出。执行器仅在 text 为空时把 reasoning 作为候选，并且只允许补齐唯一缺失的根对象右括号；随后仍用同一严格 schema 校验。其他括号不配对、字符串截断或字段缺失照常失败。
