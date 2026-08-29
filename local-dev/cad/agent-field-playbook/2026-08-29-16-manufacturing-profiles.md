# 16 · 制造轮廓现场实现记录

## 最初假设

12 已有闭合面和孔洞，因此似乎可以直接输出“零件外轮廓”和“孔”。反例是剖视嵌套零件、装配间隙、装饰圆和局部详图：同一个二维内环既可能是孔，也可能是另一构件边界；开放链也可能是合法的遮挡或被其他图元截断，不必然是缺陷。

## 踩坑与最小反例

- 只用世界轴包围盒会把旋转矩形判成不规则形，最终改为比较世界轴、PCA 和最长边三个方向的最小包围面积。
- 两个相同圆在 13 局部坐标轴旋转后不再同 X/同 Y；两点无法证明一条“斜向阵列”，但欧氏间距仍是确定事实，因此保留 `pair_spacing_only`。
- 用面中心落区会把跨区大面误归属；最终要求外环全部顶点落在同一工程视图区，剩余面显式计入未归属。
- 15 合并的是身份，不是坐标系；按对象簇只做索引摘要，不能把不同视图的二维轮廓 union 成一个几何。

## 最终规则

有界面只叫 profile candidate，嵌套环只叫 void/nested boundary candidate，圆形只叫 shape evidence；共享边是 DCEL face adjacency，开放分量是 observed topology。每条结论保留 region、face、edge、occurrence、handle 和 identity cluster 回链，源拓扑降级或预算截断必须同步降级。

## 重放入口与边界

合成反例运行 `core/16-manufacturing-profile-features/test-manufacturing-profile-features.ps1`；真实事实继续使用 12 replay。七图面数全部守恒，说明分类没有静默丢面；它不证明候选已经具备孔、槽、材料或缺陷语义。要升级这些语义，必须再结合剖视关系、尺寸/中心标注、遮挡规则、零件身份或人工规范证据。
