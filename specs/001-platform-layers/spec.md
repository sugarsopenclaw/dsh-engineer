# 001 — 平台分层

## 背景

`client-data/` 将长期存放客户给的原始资料（图纸、PLM 导出、表格等）。后续要做 Palantir 式 Ontology：对象类型、属性、链接、动作，把业务世界映射成 agent 和人都能操作的语义层。

Ontology 不直接吃原始文件。Foundry 的拆法是：

1. **Source** — 源系统 / 客户交付物
2. **Data Layer** — 数据集 + 管线（可复现的表）
3. **Ontology** — 把数据集映射成对象 / 链接 / 动作
4. **Application** — Workshop、AIP、以及我们这边的 DSH 插件

本仓库已经有 `plugins/`（应用层）和 `client-data/`（源）。缺的是 Data Layer 和 Ontology 的位置与边界。

## 目标

把四层钉在仓库根目录上，让之后写管线、对象模型和插件时不会把文件塞错地方。

## 需求

- **R1** 客户原文只进 `client-data/`。落地后视为不可变 drop：不重命名、不就地清洗、不在该目录写派生文件。
- **R2** Data Layer 放在根目录 `data/`。Ontology 和插件只消费这里登记过的数据集，不直接遍历 `client-data/`。
- **R3** Ontology 放在根目录 `ontology/`。这里只放类型定义（对象 / 属性 / 链接 / 动作），不放对象实例、不放图纸二进制。
- **R4** Agent 能力仍只写在 `plugins/`，通过公开 seam 读 ontology、查 data。数据集和对象模型都不是插件。
- **R5** 客户原文和 Data Layer 产物不进 git。进 git 的是：规格、管线代码、数据集登记、ontology 类型定义。
- **R6** 一次客户交付对应 `client-data/` 下的一个 drop 目录；Data Layer 用登记文件记下路径、格式和校验，而不是靠扫盘发现。

## 验收

- 仓库根上能指出四层各自的目录，且 `AGENTS.md` 表里有对应行。
- 把一份客户 drop 放进 `client-data/` 之后，git status 不会把其中的 DWG / PDF / xlsx 列为待提交。
- 在 `data/` 跑管线时，输出只出现在 `data/datasets/`，`client-data/` 内容字节级不变。
- 新增对象类型时，文件落在 `ontology/`，而不是 `data/` 或 `plugins/`。

## 非目标

- 不在本变更实现 DWG 解析、PLM 同步或任何管线。
- 不定变压器 / 图纸的对象模型（留给后续 ontology spec）。
- 不接入 Palantir Foundry 产品，也不模仿其仓库或 API。
- 不选定 curated 数据集的存储引擎（Parquet / SQLite / JSONL 等，等第一条管线再定）。

## 成功标准

之后加第一条「解析变压器图纸」管线时，作者不需要再讨论文件该放哪：源在 `client-data/`，代码在 `data/pipelines/`，产物在 `data/datasets/`，对象类型另开 ontology spec。
