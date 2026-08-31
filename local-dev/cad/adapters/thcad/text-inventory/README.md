# THCAD text-inventory adapter

项目级文字路由的窄抽取器，与 01 全量实体抽取平级：

- 输入是 `Database.ReadDwgFile` 打开的只读 side database；
- 遍历模型空间、图纸空间和块定义；
- 输出 DBText、MText、块属性/定义、Dimension、MLeader、块名；
- 把 `PC_MXB_BLOCK` 直接投影为带八列字段和 `bom_item_number` 的 `bom_row`；
- 把 `PC_TITLE_BLOCK` 属性保存为标题栏元数据；
- 不调用 02–21 Core，不打开或切换编辑器文档，不写 DWG。

产品桥通过 `scan_texts` 调用它，TypeScript 再把结果物化到被 Git 忽略的 `.pi/runtime/thcad-bridge/text-index/`。索引是可重建路由缓存，不是 Data Layer 数据集。
