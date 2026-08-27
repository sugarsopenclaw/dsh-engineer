# local-dev

这里保存需要在本机 CAD 环境中迭代、但以后可能被产品层复用的能力源码。

约定：

- `cad/core/` 是宿主无关算法，不得引用 THCAD、Teigha、BricsCAD 或 COM。
- `cad/adapters/` 负责把具体 CAD 的对象模型转换成 Core 输入，允许依赖宿主 SDK。
- CAD 命令、COM 触发脚本、构建产物和实验输出仍放在 `dev-test/`。
- 一项能力只保留一份源码；宿主项目用 MSBuild linked file 引用，不复制实现。

当前能力清单见 [`cad/README.md`](cad/README.md)。
