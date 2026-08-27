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

它不负责：

- 通过 COM 连接或驱动 THCAD；
- 判断技术要求等后续业务规则；
- 修改或保存源 DWG。
- 切换图层开关、冻结或锁定状态；这些有状态操作以后单独做工具。

序号坐标路径与旧 `CustomPayload` 中的 `Entity.Explode` 不是同一个 API。旧方法在 `TH_XuHaoEntity` 上返回 `eNotApplicable`，不妨碍 `ExplodeGeometry` 取得基础图元。七图 178 个序号对象实测：序号侧 178/178 可取，指向侧 162/178 可取；另 16 个对象本身只有序号圆和文字，没有可记录的指向端，因此 `pointing_position=null`。其他序号绘制样式出现后再扩展，不以夹点顺序作为固定协议。

## 宿主与重新加载

CAD 命令入口仍在 `dev-test/visualstudionetframework/ThcadExtractor/Commands.cs`。PowerShell COM 脚本只负责连接、触发命令和保留框选句柄。

THCAD V24 使用经典 .NET Framework 加载插件。程序集一旦进入当前 CAD 进程，通常不能真正卸载；重新编译后要让新 DLL 生效，安全做法是先保存需要保留的图纸状态，退出并重启 THCAD，再 `NETLOAD` 新 DLL。
