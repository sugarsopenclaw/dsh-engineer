# CAD 插件交付与安装

**DSH 不能自动把 .NET 抽取器装进 AutoCAD / THCAD。**

两套插件：

| | CAD .NET 插件 | DSH 插件 |
| --- | --- | --- |
| 产物 | `Shb.*.dll`，跑在 CAD 进程 | `dsh.bundle`，跑在 Node / Cordis |
| 谁加载 | CAD：`NETLOAD` / `.bundle` / 注册表 | DSH：`--patch` / profile |

DSH 装的是自己的 TS 工具，到不了宿主 CLR，也绕不过 `SECURELOAD` 和版本绑定。用 DSH 去 COM 发 `NETLOAD` 不是安装，会话结束就没了。

## 给用户怎么装

一个安装包（或所里静默分发），不要让设计员 `NETLOAD`：

1. 检测 THCAD / AutoCAD 版本和 .NET 运行时，只拷对应适配 DLL。
2. 写成 CAD 自动加载：AutoCAD 用 `ApplicationPlugins\*.bundle\PackageContents.xml`（或 Applications 注册表）；THCAD 跟天河要官方插件目录。
3. 签名或装到受信任路径。PoC 里 `SECURELOAD=0` 只给本机。
4. 不要把 `accoremgd` / `acdbmgd` 打进包（`Copy Local = False`）。

## DSH 能做的

体检：ping 不通就提示先装 CAD 插件 / 重启 THCAD。经批准可拉起已签名的 `Setup.exe`。审图 Skill 随 DSH 分发，和 CAD 插件分开升级。

## 现在

`dev-test` 的抽取器只是 `NETLOAD` / `accoreconsole` PoC，还不是交付物。

详见 `autocad与.net插件版本兼容性问题.md` 第八节。
