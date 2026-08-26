# 字段：TH_XUHAO

- **字段 ID**：`entity.xdata.TH_XUHAO`
- **JSON 路径**：`entities.jsonl / xdata.TH_XUHAO`
- **来源表/文件**：`entities.jsonl`
- **作用域**：`entity.xdata`

## 实测观察

- 来源文件：`entities.jsonl`
- JSON 路径：`entities.jsonl / xdata.TH_XUHAO`
- 作用域：`entity.xdata`（同名键按表区分，例如 `layer.handle` ≠ `entity.handle`）
- 抽取器 Serialize/Dump 是否声明该键：是
- 在这些图纸的 JSON 中出现过：`5TBC.384.A110050.1_1`、`5TBC.384.A110050.2_1`、`5TBC.426.A110050.1_1`、`5TBC.457.A110050.1_1`、`5TBC.709.A110050.1_2`
- 这些图纸上未出现该键：`5TBC.709.A110050.1_1`、`8TBC.312.A110050.101_1`
- 计数：{"seen": 208}
- 实测例子：
  - `5TBC.384.A110050.1_1 h=4CCA4 AcDbBlockReference: [{"code":1070,"value":1001},{"code":1000,"value":"1"}]`
  - `5TBC.384.A110050.1_1 h=4CCAE AcDbBlockReference: [{"code":1070,"value":1001},{"code":1000,"value":"2"}]`
  - `5TBC.384.A110050.1_1 h=4CCB8 AcDbBlockReference: [{"code":1070,"value":1001},{"code":1000,"value":"3"}]`
  - `5TBC.384.A110050.1_1 h=4CCC2 AcDbBlockReference: [{"code":1070,"value":1001},{"code":1000,"value":"4"}]`
  - `5TBC.384.A110050.1_1 h=4CCCC AcDbBlockReference: [{"code":1070,"value":1001},{"code":1000,"value":"5"}]`
  - `5TBC.384.A110050.1_1 h=4CCD6 AcDbBlockReference: [{"code":1070,"value":1001},{"code":1000,"value":"6"}]`

## CAD 含义

天河序号/明细行扩展数据应用名。PCCAD 序号与明细双向关联（PC_XH / PC_MXB）。XData 按已注册应用名分组的 TypedValue 链，AutoCAD 只保存不解释（https://help.autodesk.com/view/OARX/2027/ENU?guid=GUID-92D663FA-0452-44F4-BDAC-0EEF0AF3BD88）。

公开资料：天河 PCCAD 把标题栏、明细表、序号做成专业对象并双向关联（官网功能说明与命令表：PC_BTLEDIT / PC_MXB / PC_XH，https://www.thcad.net/pccad 、https://www.thcad.net/5485.html）。XData 按已注册应用名分组的 TypedValue 链，AutoCAD 只保存不解释（https://help.autodesk.com/view/OARX/2027/ENU?guid=GUID-92D663FA-0452-44F4-BDAC-0EEF0AF3BD88）。

## 沈变工程能做什么

对象是特变沈变变压器图纸（本批 `SZ-63000/110`：油箱、桥架、联气管、总装配附件、箱盖），目标场景是图纸去标注 / 文件配对 / BOM·序号 / 标注 vs 几何，而不是通用 CAD 教程。

### 单独使用

明细行块参照上能读到 1000 组的序号字符串（如 handle `4575` 上 `"1"`），气泡 TH_XuHaoEntity 本身通常没有这包 XData。

### 与其他字段组合

要落到图面气泡必须再连 `dict_key.PC_BOMXHRELATEDIC` / `link.item.xuhao_handle` 和 `bom.序号`。不要把 TypedValue 当成粗糙度或件号内部结构。

## 工程可用性判定

**判定：仅与其他字段组合可用**

内部 TH_* 专业参数（气泡数字、粗糙度 Ra、基准字母）若本抽取没有列，本文不会编造。
