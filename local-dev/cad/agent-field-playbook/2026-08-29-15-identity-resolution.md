# 15 · 身份图现场实现记录

## 最初假设

14 已能找到重复图形和正投影关系，下一步似乎可以把相关视图直接聚成对象。但“长得一样”“投影对齐”“同一对象”其实是三种不同结论；直接聚类会把相同型号的多台构件误合并。

## 最小反例

设 A–B、B–C 都有强同一对象边，同时 A–C 有明确不同对象边。只检查当前边会先合并 A/B，再错误合并 B/C；正确做法是在每次 union 前检查两个当前簇所有成员之间的硬负约束。表格行也可能链接到簇内 A、却与簇内 B 明确冲突，同样不能挂接。

## 最终规则

- 14 的重复几何只转成 `same_type_only`，强投影只转成 `same_object_possible`；两者都不 union。
- 只有外部独立、带 grade/source kind/source IDs 的 `same_object_supported` 可 union；几何/投影来源即使自称强证据也降级。
- 所有受支持的 `different_object_proven` 先进入硬约束表；每次 union 检查两个根的全体成员。
- 工程表示从保守单例开始；未合并不等于明确不同。BOM/表格行永不单独形成物理对象，只能挂到唯一无冲突物理簇。
- 同型组、可能同一对象组和已解析对象簇分开输出，矛盾边保留为 blocked merge，不静默丢弃。

## 重放入口与边界

合成反例运行 `core/15-representation-identity-resolution/test-representation-identity-resolution.ps1`；真实保存事实继续使用 12 的 replay 脚本。七图得到 76 个表示、5 个可能同一对象组和 0 次合并，验证的是“候选可见、几何不越权”。目前表示粒度仍是工程视图 scope；视图内部构件身份要等更细表示和独立 authored mapping，不能把 04 序号指向直接绑定到整幅视图。
