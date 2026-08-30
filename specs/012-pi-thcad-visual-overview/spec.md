# 012 · Pi THCAD 视觉概览子代理

状态：Implemented

## 目标

在既有 Pi–THCAD 机械链路旁新增一个低耦合视觉入口：用 capability 02 的确定性图框从当前 THCAD 导出整图 PNG，再由隔离的 DeepSeek Vision child 判断该图是否足以做宏观概览与后续导航。

## 数据流

```text
Pi 主 Agent → delegate_thcad_visual_overview
  → status / 必要时只读刷新 01–20
  → capability 02 frame bbox
  → 仅附着 thcad.exe → ZoomWindow → PNGOUT → 恢复现场并核对 DBMOD
  → 图片签名/尺寸/哈希/墨迹校验
  → fresh、无工具 DeepSeek Vision child
  → strict visual-assessment.json + evidence.md
  → 主 Agent 区分确定性出图事实与模型判断
```

## 必须满足

- 固定使用 `deepseek/deepseek-v4-flash-vision-exp`；图片只作为 child 的 user message 输入，child 无工具、无 extension、无 skill、无父 transcript。
- 图框来自与活动文档、当前 DBMOD 匹配的 capability 02 artifact；代次不匹配时先走既有 .NET `extract_current`，不由视觉模型猜图框。
- 出图只附着 `BricscadApp.AcadApplication` 且必须核验进程为 `thcad.exe`，不得启动或接触 AutoCAD。
- 保存并恢复布局、TILEMODE、模型视图和 DBMOD；恢复失败、活动图变化、空白图、异常尺寸、哈希不符均稳定失败。
- 视觉输出严格限定为 `readable_overview`、`overview_only`、`unreadable` 及布尔清晰度字段；矛盾 JSON 不得进入证据。
- 整图判断只做真实性和清晰度门禁，不能读取精确尺寸、BOM、技术要求或生成审图结论。
- 图片、原始 child events/session、结构化 assessment、父 Session、01–20 代次均进入现有本地 review bundle 与 SHA-256 CAS。

## 非目标

- 本切片不实现视图区、表格、标题栏或尺寸的局部出图，也不做多图递归缩放。
- 不照搬晓量 AutoCAD Python sidecar、桌面截图、Qwen 专用网关字段或建筑业务提示词。
- 不把视觉模型结果升级成 CAD 几何或文字的确定性事实。

## 验收

- Pi 类型检查、Bridge 构建和视觉 parser/review CAS fixture 全部通过。
- 真机对 frame-1 生成非空 PNG，DBMOD 前后相同且 `dwg_modified=false`。
- 真实 DeepSeek Vision child 返回可验证 JSON，主 Agent读取 evidence 后作答。
- review `verify` 同时通过 bundle 文件、01–20 对象和视觉输入对象校验。
