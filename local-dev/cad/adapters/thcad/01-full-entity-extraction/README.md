# 01 · THCAD 全量实体抽取

`DrawingExtractor.cs` 是这项能力的唯一实现，由 `dev-test/visualstudionetframework/ThcadExtractor/ThcadExtractor.csproj` 以 linked file 方式编译。

## 边界

它负责：

- 使用 THCAD/Teigha .NET API 遍历数据库、符号表、字典和实体；
- 序列化几何、文字、XData、扩展字典、Proxy 和可反射的 TH 专业对象属性；
- 让整图抽取与框选抽取复用相同的实体序列化路径；
- 将普通线段适配成 Core 的图框检测输入。
- 将模型空间文字的有效对齐锚点适配成 Core 的图框分区检测输入。
- 将 `PC_MXB_BLOCK` 的属性、位置、包围盒和 `TH_XUHAO`，以及 `PC_BOMXHRELATEDIC` 的 `序号#气泡Handle十进制` 关系，适配成 Core 的机械明细表知识输入。
- 对 `TH_XuHaoEntity` 使用 `Entity.ExplodeGeometry`，以“引线端点 + 两个同心目标小圆”确定指向侧坐标、以最大序号圆圆心确定序号侧坐标；两个坐标既写入实体 `geometry`，也传给对应明细行的序号标注。
- 将模型空间 DBText/MText 的正文、图层、句柄和包围盒适配成 Core 的技术要求提取输入。
- 将图层表定义和每个实体的图层/所属空间/类型适配成 Core 的图层分析输入。
- 将图层定义、各空间 Line/Arc/Circle/Polyline/Spline 的几何与实体线型，以及 `TH_DimLeaderUA` 的“XX中心线”文字和引线顶点适配成 Core 的中心线与中心几何输入。
- 将尺寸测量值/文字/样式/定义点、Leader/MLeader、天河标注实体，以及普通 Line/Solid/Text 的几何与所属空间适配成 Core 的全图标注识别输入；Solid 额外保留四个顶点，标准尺寸按子类保留定义点。
- 将 Rotated/Aligned 尺寸的定义点、旋转角、`Dimension.Dimlfac`、包围盒和 `ACAD_DIMASSOC` 句柄适配成尺寸拓扑输入，并把 07 已绑定文字的直线中心几何作为可选具名参考轴；只传观测，不在 Adapter 中判尺寸链、几何绑定或对称性。
- 将每个实体及图层的颜色方法/索引/RGB、线型、线宽，线型表的原始 dash pattern 和受支持曲线几何适配成工程图线语义输入；复用 07–09 的句柄与偏置证据，未知样式照常传入，不在 Adapter 中按颜色硬判业务含义。
- 将所有 BlockTableRecord 登记为 definition，并从 `BlockReference.BlockTransform` 对原点和三条单位基向量的实际变换构造宿主无关仿射矩阵；同时传入目标/动态 authoring definition、MINSERT 行列、外参、图层与原始样式，供 11 生成 occurrence 世界坐标和有效样式。
- 对 Line/直 Polyline 保留精确路径，对 bulge、圆弧、圆、椭圆和样条生成带质量标签的参数采样路径；把 11 结果送入 12，但吸附、交点、固定网格和 DCEL 全留在 Core。
- 将最大绘图区图框及四边句柄、全部模型空间文字、04 BOM、05 技术要求和 `PC_TITLE_BLOCK` 包围盒适配给 13；13 的 scope 结果送入 14，再由 15 形成保守身份图，12/13/15 进入 16 形成视图内轮廓候选，17 整理接口与邻接证据，18 再把 09 尺寸 occurrence 绑定到这些结构事实并作量值筛查；19 最后把 04/05/08/11/13/16/17/18 投影为当前图纸的稳定语义快照，20 从中压出可供项目汇聚的单图 observation，并补入块表已声明的外参路径。Adapter 不在单图内伪造项目图，也不判断视图名、同型、同一对象、孔槽、接口、物理接触、尺寸正确性、版本变化或缺陷。

它不负责：

- 通过 COM 连接或驱动 THCAD；
- 判断技术要求等后续业务规则；
- 修改或保存源 DWG。
- 切换图层开关、冻结或锁定状态；这些有状态操作以后单独做工具。

序号坐标路径与旧 `CustomPayload` 中的 `Entity.Explode` 不是同一个 API。旧方法在 `TH_XuHaoEntity` 上返回 `eNotApplicable`，不妨碍 `ExplodeGeometry` 取得基础图元。七图 178 个序号对象实测：序号侧 178/178 可取，指向侧 162/178 可取；另 16 个对象本身只有序号圆和文字，没有可记录的指向端，因此 `pointing_position=null`。其他序号绘制样式出现后再扩展，不以夹点顺序作为固定协议。

专业对象的通用反射属性包不得调用 `Hyperlinks`，也不得调用声明类型为 `Teigha.Runtime.DisposableWrapper`、`IDisposable` 或 `DBObject` 的 getter；广义声明类型实际返回临时 wrapper 时立即释放，但事务持有的 `DBObject` 不由此处释放。连续旁数据库回归曾在 `HyperLinkCollection` 于数据库释放后终结时触发 `TD_DbCore` 原生访问冲突；这些可释放包装器不是业务字段证据，创建后跨越数据库生命周期反而会破坏宿主稳定性。具体业务字段应使用显式、事务内 API 读取。

## 宿主与重新加载

CAD 命令入口仍在 `dev-test/visualstudionetframework/ThcadExtractor/Commands.cs`。PowerShell COM 脚本只负责连接、触发命令和保留框选句柄。

THCAD V24 使用经典 .NET Framework 加载插件。程序集一旦进入当前 CAD 进程，通常不能真正卸载；重新编译后要让新 DLL 生效，安全做法是先保存需要保留的图纸状态，退出并重启 THCAD，再 `NETLOAD` 新 DLL。
