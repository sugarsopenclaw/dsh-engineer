做 vibe CAD，本质上是把 **vibe coding 那套「自然语言 → Agent 循环改几何」** 搬到可制造的零件上。X 上真正在用的，不是再造一个 AutoCAD 界面，而是三条线同时在长：

1. **代码即模型**（OpenSCAD / build123d / CadQuery / KCL）
2. **开源参数化内核 + Agent 工作台**（FreeCAD 系，尤其 VibeCAD）
3. **嵌进现有商业 CAD**（Fusion / SolidWorks / NX / AutoCAD 系，含国产 DWG 平台）

下面按「大家实际在用什么」来盘，而不是厂商宣传清单。

---

## 一、X 上 vibe CAD 最热的那一层

### 1. VibeCAD（FreeCAD 魔改，目前最贴这个词）
[10-X-eng/vibecad](https://github.com/10-X-eng/vibecad) 是 X 上直接叫 VibeCAD 的主力。它是 **带 AI 助手的 FreeCAD fork**：对话建模、可编辑特征树、VibeScript / Native 两种作者模式，支持 ChatGPT、Claude、Grok、Ollama。

近期还在发 26.3.1-RC 预览包（Linux / Win / macOS）。作者 @10_X_eng 反复强调的卖点是：生成结果还能用普通 CAD 工具改，参数还在。

相关站点/变体：
- [vibecad.studio](https://vibecad.studio/)：AI-native 参数化 CAD 定位
- `pip install vibecad`：走 FreeCAD MCP 的 chat-native 包
- [rawwerks/VibeCAD](https://github.com/rawwerks/VibeCAD)：给 Claude Code 用的 CAD skills（build123d、GLB 渲染等）

企业向还有德国 [vibecad.de](https://vibecad.de/en/)：自然语言进 **Siemens NX**，走 PLM 合规，不是 hobby 路线。

### 2. Zoo + Zookeeper（独立 AI-native CAD）
[zoo.dev](https://zoo.dev/) 是目前最完整的「自己做几何内核」玩家：KittyCAD 内核、真实 B-Rep、STEP 导出、Zookeeper 对话 Agent、KCL 代码编辑器。X / 评测里常把它当 text-to-CAD 第一梯队。

适合做「新平台」对标，不适合做中国工厂 DWG 交付的第一刀。

### 3. 纯 Agent harness（最像 vibe coding）
X 上传播很广的是开源 **text-to-cad**（Claude Code / Codex 当 CAD 工程师）：本地跑、导出 STEP/STL/DXF/GLB/3MF，甚至能出 URDF、切片、打 Bambu。这种路径和你们已经在做的 agent harness 最同构。

X 上日常吐槽/实操还常见：
- OpenSCAD + LLM（改尺寸快、装配弱）
- FreeCAD Python macro
- Fusion 360 里的 CADAgent
- Blueprint.io 这类「一句话出模型」demo

共同点：**LLM 写代码/调 API，比直接点 Ribbon 稳得多。**

---

## 二、代码 CAD：Agent 最容易打穿的一层

这是 vibe CAD 的「Cursor 层」，X 工程圈用得最多。

| 工具 | 语言 | 为什么 Agent 爱它 | 短板 |
|---|---|---|---|
| **OpenSCAD** | 自己的 DSL | 文本即模型，LLM 训练数据多 | 不是真正特征树，复杂装配差 |
| **build123d** | Python | 代数风格、参数化、有紧固件/齿轮库 | 要会 Python CAD 心智 |
| **CadQuery** | Python | 类似 SolidWorks 操作流 | 生态比 build123d 散一点 |
| **FreeCAD Python** | Python | 能落到真实 PartDesign / TechDraw | 拓扑命名、UI 历史债 |
| **Zoo KCL** | 自有语言 | 代码和特征树 1:1 | 生态新、国内交付链弱 |

如果你要做产品：**先让 Agent 产出可复现的代码（SCAD / build123d / VibeScript），再导出 STEP/STL**，比直接在 DWG 里「画一笔」成功率高一个数量级。

---

## 三、传统 CAD：工厂还在用什么（含你点名的 AutoCAD / 天河）

Vibe 是入口，交付还是这些软件。

### 全球 3D（机械）
- **SolidWorks**：工业默认。2026 有 AURA / LEO 虚拟伴侣，画图、装配诊断、知识检索。X 上机械工程师仍把它当「正经活」工具。
- **Fusion 360**：创客 + 中小团队。Autodesk Assistant、**Fusion MCP**（外部 Agent 能接进去，这点很关键）
- **Onshape**：浏览器参数化，黑客松 vibe CAD 经常接它的 API
- **Inventor / Creo / Siemens NX**：大厂、汽车、装备。NX 是 vibecad.de 那种企业自动化的目标盘
- **Rhino + Grasshopper**：曲面、建筑、珠宝
- **Blender**：网格/表现，不是工程 CAD，但 Geometry Nodes + MCP 在做概念很快

### 2D / DWG（中国工厂真实战场）
中国大量机械厂、工装、出图仍是 **DWG + 国标图框 + 明细表**，不是 SolidWorks 装配。

| 软件 | 定位 | vibe/二次开发相关 |
|---|---|---|
| **AutoCAD / AutoCAD Mechanical** | 全球 DWG 标准 | LISP、.NET、ObjectARX；Python 用 **PyRx**、pyautocad |
| **天河 THCAD / PCCAD** | AutoCAD 兼容 + 机械专业模块（图层/图幅/标准件/序号明细表/装配），国产替代里偏机械出图 | 完整 LISP、COM、.NET、BRX/ARX；PCCAD 是「AutoCAD + 机械插件」路线，THCAD 是自主平台版。二次开发可读写标题栏/明细表，接 PDM/ERP。赛力斯这类案例把它当 AutoCAD 替代。 |
| **中望 CAD / 中望 3D** | 国产份额第一（IDC 2025：2D+3D 国产双第一，2D 还进了中国市场全球前三） | LISP / VBA / .NET / **ZRX**；PyRx 也支持 ZwCAD。自主 Overdrive 内核在推 3D。 |
| **浩辰 CAD** | 国产 2D 第二梯队，看图/工地端强 | 兼容 DWG，永久授权常见 |
| **CAXA 电子图板** | 机械 2D + 和 PLM 近 | 国内老机械盘 |
| **天正 CAD** | 建筑，挂在 AutoCAD 上 | 别和天河搞混：天正=建筑，天河=机械 |
| **BricsCAD / nanoCAD / DraftSight** | 海外 AutoCAD 替代 | DWG 原生，Brics 有 AI 相似形状 |

天河要点（做 vibe 时很关键）：
- **PCCAD**：跑在 AutoCAD 2013–2025 上，国人机械习惯（轴类、孔阵、相贯线、序号明细表）
- **THCAD**：自主 DWG 平台，宣传「命令/别名/系统变量对齐 AutoCAD」，并带 3D 机械浏览器、钣金等
- 二次开发不是「没有口」，但口是 **LISP + COM/.NET**，不是现代 MCP 一等公民。Agent 要控它，现实路径是：COM 自动化 / 发 LISP / 写 .NET 插件，而不是直接聊出一张合格工装图。

---

## 四、2026 年独立 AI CAD 产品（对标用）

评测里常出现的专用 text-to-CAD：

- **Zoo.dev / Zookeeper**：B-Rep + STEP，最接近「能进下游 CAD」
- **AdamCAD**：快、有滑条改尺寸，偏原型，STEP/特征树弱
- **CADAgent**：开源 Fusion 插件，在 Fusion 时间线里长出真正特征（要 Fusion + Anthropic key）
- **GetVibeCAD / 各类 OpenSCAD 生成器**：先判断可制造，再吐 SCAD
- **Illoca Plamo**：AEC 的「vibe modeling」，草图/图/话 → 可编辑 3D
- 厂商内置：SolidWorks AURA/LEO、Onshape AI Advisor、Autodesk Assistant、Creo Advise/Assist、NX AI Chat

诚实结论：2026 年这些东西 **做支架、法兰、面板、简单壳体可以**；做带公差链、GB 明细表、多零件装配、可过审图纸，仍然要人 + 传统 CAD 收口。X 上机械工程师也在骂「别再做第 N 个 text-to-CAD，我们要的是 FMEA / 尺寸链 / SPC」。

---

## 五、若要「做 vibe CAD 方向」，工具该怎么选

按目标分，不要一把梭。

### A. 做 Agent / 开源产品（和现有 pi-agent、MCP、harness 最贴）
优先栈：

1. **FreeCAD / VibeCAD** — 已有对话 + 特征树 + 多 workbench，能直接 fork 或做 MCP
2. **build123d + OpenSCAD** — LLM 命中率最高的生成层
3. **Zoo API / STEP** — 需要真 B-Rep 时
4. **Fusion MCP** — 要进现有设计师工作流
5. 验证器用 STL/STEP + 截图，不要只信模型嘴上说「建好了」

### B. 做中国机械出图 / 国产替代（天河、中望这条）
优先栈：

1. 几何在 **FreeCAD / build123d / Zoo** 里生成（参数化、可版本管理）
2. 导出 **STEP + DWG/DXF**
3. 用 **中望 或 天河** 做国标图框、明细表、序号、公差标注、批量打印
4. 二次开发：中望走 ZRX/.NET/LISP；天河走 COM + LISP；AutoCAD 走 PyRx

不要一上来让 Agent 在 THCAD 里点工具栏——GUI 自动化脆、DWG 语义脏、国标标注规则 LLM 记不全。

### C. 做 AEC / 空间
Plamo、Rhino+Grasshopper、Revit/BIM 自动化是另一条产品，和机械 vibe CAD 用户重叠少。

---

## 六、一张「谁在用什么」速查

```
自然语言 / Agent
        │
        ├─ 代码层     OpenSCAD / build123d / CadQuery / VibeScript / KCL
        ├─ 开源CAD    FreeCAD · VibeCAD
        ├─ 新内核     Zoo Design Studio
        ├─ 云CAD      Onshape · Fusion 360
        ├─ 工业3D     SolidWorks · NX · Creo · 中望3D
        └─ 中国2D出图 AutoCAD · 天河THCAD/PCCAD · 中望CAD · 浩辰 · CAXA
                      （DWG + GB 图框 + 明细表才是交付物）
```

**X 圈共识可以压成一句：**  
vibe CAD 的「Cursor」是代码 CAD + FreeCAD/VibeCAD/Zoo；  
vibe CAD 的「生产环境」在中国仍是 AutoCAD 兼容族（天河/中望）和 SolidWorks/Fusion。

如果你下一步是选型而不是扫货，可以说一下更偏向哪条：  
① 开源 Agent 平台（对标 VibeCAD）  
② 接国内工厂 DWG/天河/中望  
③ 接 Fusion/SolidWorks 做插件  

我可以按那条把「该对接的 API / MCP / 二次开发口」再拆一版可开工的技术栈。