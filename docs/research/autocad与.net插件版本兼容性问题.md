# 先把概念定准：不是“C# 还是 .NET”

两者不是同一层面的东西：

* **C#** 是编程语言；
* **.NET / .NET Framework** 是运行时和基础类库；
* **THCAD .NET API / AutoCAD Managed .NET API** 是宿主 CAD 提供的托管开发接口；
* **COM/ActiveX** 是另一套调用接口，也完全可以由 C# 调用。

所以实际可选路线是：

1. **C# 外部程序 + COM API**
2. **C# 编写的 CAD 进程内 .NET 插件**
3. **C++ 编写的 BRX/TX/ObjectARX 插件**
4. **以上几种混合**

对沈变所项目，我的明确建议是：

> **主路线采用“C# + THCAD 进程内 .NET 插件”，COM 保留为天河专业数据接口和跨版本控制桥，DeepSeek Harness 继续放在 CAD 外部；第一阶段不使用 BRX/TX。**

---

# 一、你担心的是对的：.NET 插件确实比 COM 更需要考虑版本兼容

你之前的 C# 外部程序通过 COM 操作 AutoCAD 2024，同时也能跑在 2022、2027，主要是因为 **ActiveX/COM 自动化接口刻意维持了较强的向后兼容性**。Autodesk 对 AutoCAD 2025 的说明就是：为旧版本编写的 ActiveX 自动化程序通常应当可以直接运行，虽然仍建议重新测试并更新类型库引用。([Autodesk Developer Blog][1])

但 AutoCAD 托管 .NET 插件不是这样。它会直接引用宿主提供的：

```text
AcCoreMgd.dll
AcDbMgd.dll
AcMgd.dll
```

并且必须运行在 AutoCAD 自己选择的 .NET Runtime 中。

当前版本断代非常明显：

| AutoCAD 版本         | 托管运行时              | 兼容情况                   |
| ------------------ | ------------------ | ---------------------- |
| 2022               | .NET Framework 4.8 | 与 2021、2022 SDK 同一代    |
| 2023               | .NET Framework 4.8 | 支持 2021—2023 SDK       |
| 2024               | .NET Framework 4.8 | 支持 2021—2024 SDK       |
| 2025               | .NET 8             | 2024 插件需要升级项目并重新编译     |
| 2026 至 Update 1.1  | .NET 8             | 可兼容 2025 SDK           |
| 2026 Update 1.2 路线 | .NET 10            | Autodesk 已开放破坏性更新 Beta |
| 2027               | .NET 10            | 与 2025、2026 二进制不兼容     |

Autodesk 明确要求 AutoCAD 2024 的 .NET Framework 4.8 插件升级到 .NET 8 后，才能用于 AutoCAD 2025；AutoCAD 2027 又切换到了 .NET 10，并明确属于二进制不兼容版本。([Autodesk Help][2])

更值得注意的是，Autodesk 在 **2026 年 6 月 29 日**开放了 AutoCAD 2026 Update 1.2 的 .NET 10 Beta，因为 .NET 8 将于 2026 年 11 月结束支持。这意味着以后甚至不能只判断“AutoCAD 2026”，还要判断具体 Update 版本。([Autodesk Developer Blog][3])

所以：

> **一个 COM 外部程序可以较容易横跨 2022—2027；一个 Managed .NET 插件 DLL 则不能安全地横跨 .NET Framework 4.8、.NET 8 和 .NET 10。**

但这并不意味着要维护三套业务代码。正确目标是：

> **一套源码、一个产品、多个很薄的宿主适配 DLL，而不是强求一个 DLL 兼容所有版本。**

---

# 二、四种路线综合比较

| 维度          | C# 外部程序 + COM | C# 进程内 .NET 插件 | C++ BRX/TX | 推荐混合方案     |
| ----------- | ------------- | -------------- | ---------- | ---------- |
| 全量实体提取性能    | 较低            | **高**          | 最高         | **高**      |
| DWG 数据库访问深度 | 中等            | **高**          | 最高         | **最高实用覆盖** |
| PCCAD 专业数据  | 取决于专业 COM     | 可结合专业 COM      | 取决于 SDK    | **最好**     |
| 跨版本二进制兼容    | **高**         | 中等或较低          | 低          | 产品层面高      |
| CAD 崩溃隔离    | **好**         | 较弱             | 较弱         | 较好         |
| 开发效率        | 高             | **高**          | 低          | **高**      |
| 调试维护成本      | 较低            | 中等             | 高          | 中等         |
| 适合复杂 UI     | 外部窗口          | **最适合内嵌面板**    | 不适合单独承担 UI | **最适合**    |
| 适合逐实体全量抽取   | 不推荐           | **推荐**         | 复杂场景推荐     | **推荐**     |
| 推荐定位        | 启动、控制、兜底      | **生产主链路**      | 局部补充       | **最终方案**   |

---

# 三、为什么 C# .NET 插件性能明显优于你之前的 COM

AutoCAD 官方说明，Managed .NET API 是为**进程内运行**设计的，而 ActiveX Automation 可以在进程内或进程外使用；Managed API 又是 ObjectARX 的托管包装层，覆盖了大部分数据库、DWG 读写、编辑器、Plot 等能力。([Autodesk Help][4])

你之前的架构大概是：

```text
外部 Python/C# 程序
    ↓ COM 调用
AutoCAD
    ↓
取一个实体
    ↓ COM 返回一个属性
再取一个属性
再取下一个实体
```

每次调用都要经过：

```text
进程边界
→ COM 参数封送
→ VARIANT / SAFEARRAY 转换
→ CAD 主线程处理
→ 结果封送回来
```

如果一张图有十万实体，每个实体读取十几个属性，就会产生大量跨进程调用。这通常才是实体抽取慢的主要原因，而不是 C#、Python 或 CAD 本身单纯算得慢。

进程内 .NET 插件则是：

```text
THCAD 进程内
→ 打开 Database Transaction
→ 遍历全部对象
→ 一次性转换成普通 DTO
→ 关闭 Transaction
→ 一次性发送结果
```

不再需要每读一个点、一个图层、一个属性都跨进程往返。

因此，在全量 DWG 数据导出上，性能排序通常是：

```text
C++ BRX/TX
≈ C# Managed .NET
≫ 外部 C# COM
≫ 外部 Python COM
```

对于你们主要做的：

* 遍历实体；
* 提取图层、块、文字、标注；
* 读取 XData、XRecord；
* 建立 Handle 和关系；
* 输出 JSON/Protobuf；

C# Managed .NET 通常已经足够快。只有 ACIS/B-Rep、复杂布尔运算、大量实体离散化等重几何任务，才有明显理由下沉到 BRX/TX。

---

# 四、数据质量上，不能简单把 COM 全部废掉

THCAD 官方列出的开发能力包括：

* ActiveX；
* COM API；
* .NET；
* BRX（ARX 兼容）；
* TX。([天河PCCAD官网][5])

但是天河对于 PCCAD 的公开集成能力，重点强调的是通过自动化接口读写：

* 标题栏；
* 明细表；
* 序号；
* 标准件信息；
* PDM/ERP 数据。

同时，PCCAD 自身还维护序号与明细表双向关联、P3DM 装配树、批量数据提取等专业语义。([天河PCCAD官网][6])

因此不建议“为了技术纯洁”而把 COM 全部删掉。正确分工应是：

## 标准 DWG 数据走 Managed .NET

```text
Line
Polyline
Arc
Circle
Spline
Text
MText
Dimension
Hatch
BlockTable
BlockReference
Attribute
Layout
Viewport
Layer
Linetype
XData
ExtensionDictionary
XRecord
Handle
Owner
ProxyObject
```

## 天河专业语义优先走天河提供的专业 API

```text
标题栏
明细表
序号关联
标准件
通用件
物料编码
P3DM 装配节点
企业自定义字段
变压器算单
BOM
```

如果这些专业数据目前只通过 COM 暴露，就在 C# 插件里增加一个很薄的：

```text
PccadSemanticComBridge
```

这不是退回原来的慢速 COM 架构，因为你不会再用 COM 遍历十万条 Line，而只是一次读取一张标题栏、一个 BOM 或一棵装配树。

---

# 五、THCAD 本身也要考虑版本，但沈变所项目很好控制

我查到的 THCAD 公开页面列出了 `.NET、BRX、TX、COM`，并宣传与 AutoCAD 开发接口兼容；但公开资料没有给出清晰的：

* THCAD 各版本对应哪一代 .NET Runtime；
* V24、V25 之间是否托管二进制兼容；
* 一个旧版插件 DLL 能否直接加载到新版；
* BRX/TX 是否必须逐版本重新编译；
* 小版本更新是否更换托管程序集。

因此不能直接假设：

```text
THCAD V24 编译的 DLL
=
未来 THCAD V25、V26 都能加载
```

天河自己的 PCCAD 虽然宣称支持 AutoCAD 2013—2025，但更新记录同时显示，它会针对不同 AutoCAD 平台修复兼容问题，并在安装时让用户选择平台版本。合理推断是：天河也通过**同一产品、分版本适配和安装选择**来实现广泛兼容，而不是一个毫无变化的 DLL 横跨所有版本。([天河PCCAD官网][7])

不过沈变所是 To B 定制，这反而很好办：

> 不需要像晓量 To C 一样默认兼容用户电脑上所有 CAD 版本，只需要定义“沈变所认证运行环境”。

例如：

```text
认证平台：
THCAD V24.x
指定 Update 版本
指定 PCCAD/变压器模块版本
指定 SDK 版本
Windows 版本
插件版本
```

沈变所升级 THCAD 前，先跑兼容性测试，通过后再统一升级。这是工业软件定制项目最稳的做法。

---

# 六、最推荐的产品和代码架构

```text
┌─────────────────────────────────────┐
│               THCAD                 │
│                                     │
│  Shb.Thcad.Plugin                   │
│  C# + THCAD Managed .NET API        │
│                                     │
│  ├─ StandardDwgExtractor            │
│  │   标准DWG数据库全量抽取            │
│  │                                   │
│  ├─ PccadSemanticBridge             │
│  │   调用天河专业COM/业务接口          │
│  │                                   │
│  ├─ CadActionService                │
│  │   定位、高亮、选择、批注、修改       │
│  │                                   │
│  └─ IPC Client                      │
│      Named Pipe / localhost HTTP    │
└──────────────────┬──────────────────┘
                   │
                   ▼
┌─────────────────────────────────────┐
│        CAD Data Gateway             │
│                                     │
│  项目快照、CAD-IR、版本、缓存、算法    │
└──────────────────┬──────────────────┘
                   │
                   ▼
┌─────────────────────────────────────┐
│         DeepSeek Harness            │
│  审图 Skill、Workflow、工具、报告     │
└─────────────────────────────────────┘
```

这套架构中：

* CAD 插件只负责 CAD；
* DeepSeek Harness 不进入 THCAD 进程；
* 模型 SDK、向量数据库、Node.js 依赖、浏览器等都不塞进 CAD；
* CAD 崩溃风险被控制在一个很薄的插件边界；
* Agent 崩溃不会直接拖死 THCAD；
* THCAD 升级时只需要改宿主 Adapter。

---

# 七、代码不要按“版本复制工程”，要按“宿主适配器”组织

建议工程结构：

```text
src/
├─ Shb.Cad.Contracts
│  ├─ EntityDto
│  ├─ DrawingSnapshot
│  ├─ BomDto
│  ├─ ReviewIssue
│  └─ IPC Contract
│
├─ Shb.Cad.Core
│  ├─ 坐标归一化
│  ├─ 块关系处理
│  ├─ CAD-IR生成
│  ├─ 数据校验
│  └─ 通用序列化
│
├─ Shb.Thcad.Adapter.V24
│  ├─ 引用THCAD V24 SDK
│  ├─ Database访问
│  └─ THCAD命令与UI
│
├─ Shb.Pccad.ComBridge
│  ├─ 标题栏
│  ├─ 明细表
│  ├─ 序号
│  └─ P3DM/专业接口
│
├─ Shb.AutoCAD.Adapter.2022_2024
│  └─ 可选，.NET Framework 4.8
│
├─ Shb.AutoCAD.Adapter.2025_2026
│  └─ 可选，.NET 8
│
├─ Shb.AutoCAD.Adapter.2027
│  └─ 可选，.NET 10
│
└─ Shb.Cad.Gateway
   └─ 外部独立服务
```

其中真正与 THCAD、AutoCAD 版本绑定的代码，应该只占很少一部分：

```text
打开对象
遍历对象
读取属性
注册命令
获取选择集
定位视图
写入批注
```

以下内容全部共享：

```text
CAD-IR
数据结构
序列化
审图规则
关系建模
实体分类
项目快照
数据上传
错误模型
DeepSeek Harness工具协议
```

---

# 八、版本部署应该怎么做

用户层面仍然只有一个安装包。安装器启动时检测：

```json
{
  "host": "THCAD",
  "host_version": "24.2.1",
  "runtime": "实际检测结果",
  "pccad_version": "2025.1.1",
  "architecture": "x64"
}
```

然后加载对应目录：

```text
plugins/
├─ thcad-v24/
│  └─ Shb.Thcad.Plugin.dll
├─ thcad-v25/
│  └─ Shb.Thcad.Plugin.dll
├─ autocad-r24-net48/
│  └─ Shb.AutoCAD.Plugin.dll
├─ autocad-r25-net8/
│  └─ Shb.AutoCAD.Plugin.dll
└─ autocad-r26-net10/
   └─ Shb.AutoCAD.Plugin.dll
```

所以用户感知是：

```text
同一个“沈变AI审图插件”
```

研发层面则是：

```text
同一套源码
+ 几个自动编译出来的版本适配包
```

而不是每年重新开发一遍。

---

# 九、稳定性要这样保证

## 1. 插件必须“薄”

不要在 CAD 插件中运行：

* DeepSeek Harness 主循环；
* LLM SDK；
* 向量数据库；
* 大规模图像处理；
* 长时间网络重试；
* 模型推理；
* 复杂报表生成。

插件只做：

```text
取数据
写数据
定位
高亮
批注
与外部服务通信
```

## 2. CAD 对象不要离开 Transaction

错误方式：

```text
读取 Entity 对象
→ 保存到全局变量
→ Transaction 关闭
→ 其他线程继续使用
```

正确方式：

```text
Transaction 中读取
→ 转换成纯 C# DTO
→ Transaction 关闭
→ 后续只处理 DTO
```

## 3. 不要在后台线程直接操作 CAD API

后台线程可以做：

* JSON 序列化；
* 压缩；
* 哈希；
* 网络发送；
* 普通算法。

但 CAD Database、Document、Editor、Entity 操作应回到宿主规定的执行上下文。

## 4. 不要把 THCAD SDK DLL 一起复制发布

宿主提供的托管程序集一般只用于编译引用，应由 THCAD 安装目录提供。否则插件目录里混入另一版本 SDK，很容易造成：

```text
程序集绑定冲突
类型加载失败
启动崩溃
方法不存在
```

## 5. COM 只做粗粒度调用

推荐：

```text
一次调用读取完整标题栏
一次调用读取完整明细表
一次调用读取整棵装配树
```

不推荐：

```text
每个实体
→ 每个属性
→ 每个顶点
→ 都单独COM调用
```

## 6. 不支持的版本要明确拒绝

不要“试着加载看看”。

应返回：

```text
当前 THCAD 版本未通过认证
已检测：24.3.2
支持：24.2.0—24.2.5
请使用认证版本或安装对应插件适配包
```

工业软件里，明确拒绝比偶尔抽错数据更安全。

---

# 十、BRX/TX 什么时候才值得上

第一版不要上。

只有出现下列证据时再增加 C++ Native 模块：

1. 某类天河私有对象在 .NET 中只能得到 Proxy；
2. 天河只提供 BRX/TX 版本的专业 API；
3. 大型图纸 Managed .NET 抽取确实达不到性能指标；
4. 需要读取托管 API 未暴露的底层数据；
5. 要执行复杂 B-Rep、ACIS 或大规模网格计算；
6. 沈变所已有大量可复用的 C++/ARX 代码。

即使上 BRX/TX，也不要把整个产品改成 C++。只做：

```text
Shb.Thcad.Native.dll
```

然后由 C# 插件通过明确的接口调用。

---

# 最终定案

## 技术语言

```text
C#
```

## CAD 主接口

```text
THCAD Managed .NET API
```

## 天河专业业务数据

```text
PCCAD/变压器专业 COM 或官方业务接口
```

## Agent 与审图编排

```text
外部 DeepSeek Harness 服务
```

## 版本策略

```text
一套共享源码
+ 每个运行时家族一个薄适配 DLL
+ 沈变所固定认证 THCAD 版本
+ 升级前回归测试
```

## BRX/TX

```text
暂不采用
仅在 .NET 确实读取不到或性能不足时局部补充
```

一句话概括：

> **不要因为 COM 跨版本方便，就继续用 COM 做十万实体的全量抽取；也不要为了性能直接跳到 C++。沈变所项目最合理的是“C# 编写的 THCAD .NET 进程内插件做高质量、高性能数据抽取，专业天河数据保留 COM Bridge，外部 Harness 负责智能审图”，并通过一套源码、多版本薄适配包解决兼容问题。**

[1]: https://blog.autodesk.io/autocad-2025-interoperability-for-customization/ "Autodesk Developer Blog : AutoCAD 2025 のカスタマイズ互換性"
[2]: https://help.autodesk.com/cloudhelp/2026/KOR/AutoCAD-Customization/files/GUID-A6C680F2-DE2E-418A-A182-E4884073338A.htm "관리되는 .NET 호환성 정보"
[3]: https://blog.autodesk.io/autocad-2026-net-10-update-beta-preview-is-now-available/?utm_source=chatgpt.com "AutoCAD 2026 .NET 10 Update Beta Preview is Now Available"
[4]: https://help.autodesk.com/view/OARX/2024/ITA/?caas=caas%2Fdocumentation%2FCIV3D%2F2014%2FITA%2FfilesACD%2FGUID-C8C65D7A-EC3A-42D8-BF02-4B13C2EA1A4B-htm.html&utm_source=chatgpt.com "AutoCAD 2024 Developer and ObjectARX Guida | Out-of-Process ..."
[5]: https://www.thcad.net/thcad "天河THCAD国产自主CAD解决方案，完全替代AutoCAD | 天河PCCAD官网"
[6]: https://www.thcad.net/thcad?utm_source=chatgpt.com "天河THCAD国产自主CAD解决方案，完全替代AutoCAD"
[7]: https://www.thcad.net/pccad "天河PCCAD官网 | 天河PCCAD官网"
