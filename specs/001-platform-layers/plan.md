# 001 — 计划

## 目录怎么放

Data Layer **不**放进 `client-data/`，也 **不**放进 `plugins/`。

`client-data/` 是 Source：客户交什么就存什么，带客户自己的文件夹名和文件名。一旦在这里做解析或改名，原文和产物混在一起，无法证明「模型看到的」能从客户交付复现。

`plugins/` 是 Pi package 运行时。上游没有数据 ABI；把数据集或 ontology 实例塞进插件包，会把数据生命周期绑到加载面上。

所以四层都在仓库根，和现有 `plugins/` 并列：

```
client-data/                 Source：客户原文 drop（本地，不进 git）
  <drop-name>/               一次交付一个目录，内部结构保持客户原样
data/                        Data Layer
  catalog/                   数据集登记（进 git）
  pipelines/                 转换代码（进 git）
  datasets/                  产物（不进 git）
    raw/                     按登记从 drop 做成的规范化输入
    staging/                 解析 / 清洗
    curated/                 给 ontology 映射用的稳定表
ontology/                    类型定义（进 git）；实例不放这里
plugins/                     Agent 能力，只消费上面两层
```

`data/` 就是 Data Layer 的目录名。不叫 `data-layer/`：和 `ontology/`、`plugins/` 一样用短名；Palantir 术语写在 README / AGENTS 表里。

当前已有 drop：`client-data/transformer-design-drawings/`（变压器二维 CAD）。本变更不移动、不改名其中的文件。

## 数据流

```
client-data/<drop>
        │  登记（路径、格式、校验），不扫盘当 API
        ▼
data/datasets/raw
        │  pipelines
        ▼
data/datasets/staging
        │  pipelines
        ▼
data/datasets/curated  ◄──  ontology 类型把列映射成属性 / 链接
        │
        ▼
plugins/  通过 ctx.* 查询对象，不读 client-data
```

三条不变量：

1. **原文不可变。** 管线只读 `client-data/`，写入只发生在 `data/datasets/`。
2. **产物可复现。** 删掉 `data/datasets/` 后，用同一 drop + 同一管线能再生。
3. **Ontology 不是库。** `ontology/` 描述「什么是一张图 / 一台变压器」；行数据留在 curated 数据集（或以后的对象存储里）。

## 登记文件（本轮只定形状，不写实例）

`data/catalog/` 里每个数据集一份 YAML，最少包含：

- `id` — 稳定标识，ontology 以后引用这个，不引用磁盘路径
- `stage` — `raw` | `staging` | `curated`
- `source` — 上游：`client-data` drop 路径，或另一个 dataset `id`
- `format` — 声明的文件格式（`dwg`、`pdf`、`parquet`…）
- `pipeline` — 可选，指向生成它的管线

第一条管线落地时再写第一份登记，不在本变更编造。

## git

`.gitignore`：

- `client-data/**`，例外：`client-data/README.md`
- `data/datasets/`

大二进制和可再生表都不进源码库。需要共享某次 drop 时用网盘 / 对象存储，不把 git 当交付通道。

## 取舍

| 方案 | 结论 |
| --- | --- |
| Data Layer 放在 `client-data/derived/` | 否。原文目录会被写成工作区。 |
| Data Layer 放在 `plugins/data/` | 否。和 Pi package 生命周期绑死。 |
| 目录叫 `data-layer/` | 否。短名 `data/`，文档里称 Data Layer。 |
| 现在就定 Parquet / SQLite | 否。等第一条管线的产物形态再定（spec 非目标）。 |
| 现在就建 ontology 对象类型 | 否。另开 spec；本轮只占目录。 |

## 本轮落地

只做骨架：目录 README、gitignore、`AGENTS.md` / `README.md` 的层表、本 SDD 三份文档。不管线、不解析 DWG。
