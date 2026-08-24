**推荐优先下载这两个系列中支持二次开发的版本：**

### 1. 最推荐：天河CAD V24 平台版 或 二维机械设计版（完全国产独立平台）
- 对应你截图里的 **「天河CAD V24 平台版【完全国产独立平台】」** 或 **「天河CAD V24 二维机械设计【完全国产独立平台】」**。
- 官方明确宣传 **二次开发接口一致**（支持 LISP、COM API、.NET、BRX/ARX 等），可直接对接 PDM/ERP，接口风格接近 AutoCAD，方便迁移原有开发代码。
- 特变电工（含沈变）宣传用的就是这类**完全自主可控的国产天河CAD平台** + 行业解决方案，和他们的使用方向更匹配。
- 适合做变压器相关参数化、明细表、BOM、通用件、自定义命令等二次开发。

### 2. 备选：PCCAD 企业版（基于 AutoCAD 的插件版）
- 最新是 **PCCAD2025 企业版**（兼容 AutoCAD 2013–2025）。
- 官方多次提到「开放的二次开发接口」「完善二次开发接口」，支持 COM 组件、C++ / C# / VB.NET，可读写标题栏、明细表等数据，并有 THCADToolKit 等开发相关模块。
- 如果你已经有正版 AutoCAD，或者习惯 ObjectARX / .NET / LISP 开发，这个上手更快，开发文档和生态相对成熟。

### 下载与注意点
- **个人免费版**（PCCAD 个人版等）功能阉割较多（缺少完整 PDM/ERP 集成、部分数据接口等），**不适合认真做二次开发**，建议直接走企业版试用。
- 官网下载页（thcad.net 或 thsoft.com.cn）都有「免费下载」入口，安装后一般有 30 天全功能试用。
- 正式做深度二次开发（拿完整 SDK、接口文档、技术支持）通常需要联系天河销售/技术支持（电话常见 400-101-7178 或 15811246811），企业授权后才会提供更完整的开发包和接口说明。

**简单建议：**
- 想跟特变/沈变同方向、走纯国产独立平台 → 直接下 **V24 平台版** 或 **二维机械设计版**。
- 已有 AutoCAD、想快速用熟悉的开发方式 → 下 **PCCAD2025 企业版**。

---

## 有，而且值得纳入付费路线，但要把它的定位说准

天河有两套东西：

* **THCAD 自主平台版**：独立 CAD 平台，可以作为 DWG/DXF 数据抽取运行时。
* **PCCAD**：安装在 AutoCAD 上的机械设计插件，本身不是独立 DWG 解析底座。([天河产品知识库][1])

真正与你这个需求有关的是 **THCAD**。

### 1. THCAD 确实有较完整的底层二次开发接口

天河官方功能表明确列出了：

* ActiveX
* 完整 LISP，包括 `vl / vlr / vla / vlax`
* SDS/ADS
* COM API
* `.NET`
* **BRX（ARX 兼容路线）**
* **TX（Teigha 扩展）**

同时支持动态块、ACIS 实体和曲面建模、Xref、布局、表格、数据链接等标准 DWG 对象。([天河PCCAD官网][2])

所以从接口能力判断，完全可以在 THCAD 内编写一个抽取插件，遍历的不只是 ModelSpace，而是整个 DWG Database，例如：

```text
Database
├─ BlockTable
│  ├─ ModelSpace
│  ├─ PaperSpace
│  ├─ 普通块定义
│  ├─ 匿名块
│  └─ 动态块求值结果
├─ Layer / Linetype / TextStyle / DimStyle
├─ Layout / Viewport / PlotSettings
├─ Named Objects Dictionary
├─ Group / Material / VisualStyle
├─ XData / XRecord
├─ Extension Dictionary
├─ Handle / Owner / Pointer
├─ Xref / Image / PDF Underlay
└─ Proxy Entity / Proxy Object
```

其中：

* **C#/.NET**：最适合快速做验证版；
* **C++ BRX/TX**：最适合生产级全量抽取，性能和底层覆盖通常更好；
* **COM/ActiveX**：可以外部控制，但不建议作为主抽取路径，和你目前 AutoCAD COM 一样会有跨进程调用慢、状态机复杂、并行困难的问题。

---

## 2. 但它不是已经确认的“独立无头 DWG SDK”

这是最重要的区别。

我在天河公开网站上能确认的是：

> THCAD 是完整桌面 CAD，提供 `.NET、BRX、TX、COM` 等二次开发接口。

但目前**没有找到公开、可单独下载和再分发的 THCAD DWG Runtime、Headless SDK 或 Server SDK**。官方公开下载的是完整 THCAD V24 产品，可全功能试用 30 天，而不是类似 ODA Drawings SDK 那样的独立开发包。([天河PCCAD官网][3])

因此现阶段应把它理解为：

```text
安装并授权 THCAD
        ↓
在 THCAD 进程内加载 .NET / BRX / TX 插件
        ↓
插件读取一个或多个 DWG
        ↓
输出 JSON / Protobuf / Parquet / CAD-IR
```

而不是已经确认可以：

```text
你的独立服务器程序
        ↓
直接链接 THCAD DLL
        ↓
无需安装和启动 THCAD
        ↓
任意并发解析 DWG
```

后者必须向天河确认是否提供：

* OEM Runtime；
* 无界面运行许可；
* 服务器部署许可；
* 可再分发 SDK；
* Linux Headless 版本；
* 多进程并发授权。

所以，**THCAD 目前更像一个国产、相对低成本的 AutoCAD/BricsCAD 类运行环境，而不是已经公开售卖的 ODA Drawings SDK 替代品。**

---

## 3. 对“全量实体数据”的实际覆盖判断

| 数据范围                                   | THCAD 判断                                |
| -------------------------------------- | --------------------------------------- |
| 标准 Line、Polyline、Arc、Spline、Text、MText | 可以                                      |
| 块定义、块实例、嵌套块、属性                         | 可以                                      |
| 动态块及当前求值状态                             | 官方明确支持动态块，值得实测                          |
| 图层、线型、文字样式、标注样式                        | 可以                                      |
| ModelSpace、PaperSpace、Layout、Viewport  | 可以                                      |
| XData、XRecord、Named Object Dictionary  | 通过 .NET/BRX/TX 应可遍历，需 PoC 验证覆盖率         |
| Handle、Owner、对象引用关系                    | 应可取得                                    |
| 表格、MLeader、Hatch、关联阵列                  | 标准对象大概率完整                               |
| 3D Solid、Surface、ACIS 数据               | 官方支持 ACIS，但原始 SAT/SAB、B-Rep API 暴露深度需验证 |
| Proxy Entity / Proxy Object            | 能检测和保留代理对象，但不保证能解释私有语义                  |
| Civil 3D、AutoCAD Architecture 等对象      | 官方列有相关对象启用支持，但应按版本实测                    |
| 天正高版本对象                                | **不能保证，官方明确说可能显示不全**                    |
| 第三方自定义实体原始私有参数                         | 依赖对应 Object Enabler、DBX 或原始应用           |

---

## 4. 天正是明确的短板

天河官方常见问题直接写明：

> 打开高版本天正 CAD 图纸可能显示不全，因为部分代理图形不向第三方开放；解决方式是使用天正将文件转换为 T3。([天河PCCAD官网][4])

这说明 THCAD 不能解决“任何 DWG 都获得全部专业语义”的根本问题。

比如天正高版本中的：

* 墙；
* 门窗；
* 轴网；
* 房间；
* 楼梯；
* 专业构件；
* 构件参数；
* 构件关联关系；

在没有天正对应接口时，THCAD 可能只能得到：

```json
{
  "type": "PROXY_ENTITY",
  "class_name": "...",
  "handle": "1A3F",
  "bounding_box": {},
  "proxy_graphics": "...",
  "semantic_properties": null
}
```

把图纸转为 T3 后，虽然几何能读取，但会把智能构件炸成普通线、块、文字，本质上是：

```text
保住可见几何
牺牲专业对象语义
```

因此它可以提高标准 DWG 的抽取能力，但不能突破第三方私有对象的权限边界。

---

# 对晓量最合理的定位

我建议把天河增加为第四条 Adapter：

```text
DXF
└─ ezdxf + Raw Group Code Scanner

DWG 服务端主链路
└─ ODA Drawings SDK

DWG 国产桌面/信创链路
└─ THCAD + .NET/BRX/TX Extractor

最高保真 Oracle
└─ AutoCAD/ObjectARX + 对应垂直产品/Object Enabler
```

THCAD 对你们最有价值的不是替代 ezdxf，而是：

### 替代目前慢速的 AutoCAD COM 抽取

当前方式：

```text
Python
→ COM
→ AutoCAD Document
→ ModelSpace
→ 每个实体跨进程读取属性
```

建议改成：

```text
THCAD 进程内
→ C#/.NET 或 C++ BRX/TX
→ Side Database 读取 DWG
→ 单次内存遍历全部对象
→ 一次性输出 Protobuf/JSON
```

即使仍需启动 THCAD，**进程内批量数据库遍历也会比 Python 逐实体 COM 调用快很多**。差距可能主要来自架构，而不只是 AutoCAD 与 THCAD 谁打开文件更快。

---

# 我对天河方案的最终判断

| 评价项                     | 结论                    |
| ----------------------- | --------------------- |
| 能否进行标准 DWG/DXF 底层数据抽取   | **能**                 |
| 是否有比 COM 更深的接口          | **有，.NET、BRX、TX**     |
| 是否适合做本地桌面抽取器            | **很适合验证**             |
| 是否适合国产化、信创部署            | **值得重点测试**            |
| 是否已确认可以独立无头服务器部署        | **尚未确认**              |
| 是否可以取代 ODA Drawings SDK | **暂时不能下结论**           |
| 是否能完整理解天正高版本对象          | **不能保证，官方建议转 T3**     |
| 是否值得立即做 PoC             | **值得，官方提供 30 天全功能试用** |

## 推荐实施顺序

第一步直接安装 THCAD V24 平台版，向天河索要对应版本的：

```text
.NET SDK
BRX SDK
TX SDK
开发文档
示例项目
头文件与 LIB
OEM/Runtime 授权说明
```

然后只做一个最小抽取器，不碰 UI：

```text
打开 DWG
→ 遍历所有 BlockTableRecord
→ 遍历所有 SymbolTable
→ 递归 NamedObjectsDictionary
→ 提取 XData、XRecord、Extension Dictionary
→ 保存 Handle、Owner、Runtime Class
→ 标记 Proxy Entity / Proxy Object
→ 输出统一 JSON
```

再拿同一批测试图纸与：

* AutoCAD ObjectARX；
* ODA Drawings SDK；
* ezdxf 转换结果；
* MLight/LibreDWG；

按 `Handle 集合、对象数量、对象类型、字典数量、XData 数量、块关系、代理对象数量` 做自动差异比较。

**一句话结论：天河 THCAD“有”，而且 `.NET + BRX/TX` 足以做一个比现有 AutoCAD COM 快得多、深得多的国产 DWG 抽取 Adapter；但公开资料尚不能证明它提供可独立嵌入服务器的无头 SDK，所以现阶段应把它定位为“国产 CAD 运行时抽取方案”，而不是直接替代 ODA Drawings SDK。**

[1]: https://help.thcad.cn/pages/viewpage.action?pageId=327845 "产品简介 - 天河产品知识库"
[2]: https://www.thcad.net/thcad "天河THCAD国产自主CAD解决方案，完全替代AutoCAD | 天河PCCAD官网"
[3]: https://www.thcad.net/download "天河CAD下载|PCCAD免费版下载|天河云CAD下载|国产THCAD下载|清华天河下载|AutoCAD下载|天河THCAD下载|机械CAD软件下载|PCCAD2018下载 | 天河PCCAD官网"
[4]: https://www.thcad.net/category/support/common_problem/common_problem_b "THCAD平台版 | 天河PCCAD官网"
