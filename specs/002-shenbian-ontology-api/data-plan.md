# 002 — 沈变客户数据利用方案

## 1. 当前可用数据

### 客户需求与调研资料

`client-data/client-requirements/` 现有 2 份 Markdown 整理稿、1 份原始 Word 调研材料和 1 份优先级 Excel。用途是形成业务术语、场景、角色、规则候选和验收口径。

这些材料属于需求事实与业务发现，不直接发布为可执行规则。规则需要沈变业务负责人确认来源、适用范围、公差、例外和版本后，才能成为 `RuleVersion`。

### 通用标准资料

`client-data/general-knowledge/` 现有 7 份变压器相关 PDF。用途是建立标准文档、章节、条款和适用范围的候选知识集。

进入知识库前需要完成版本有效性、文件来源、版权使用范围、OCR/文本质量和产品适用性的确认。检索命中条款不自动等于校验规则成立。

### 变压器二维图纸

`client-data/transformer-design-drawings/` 现有 7 份 DWG 和对应 7 份 `.bak`。当前 DWG 多为天河 CAD 宿主保存过的版本，`.bak` 是打开前文件；权威版本尚未决定。

首轮分别登记为 `DataAsset`，计算 SHA-256 并记录来源状态，不执行覆盖恢复。业务确认后再建立正式 `DrawingRevision` 关系。

### 天河 CAD 抽取结果

`dev-test/visualstudionetframework/out-thcad/` 现有 7 套同版本抽取结果，共 91,605 个实体、7 个标题栏、208 行明细、450 个天河专业对象；proxy 与失败实体均为 0。数据包含图层、运行时类型、基础几何、块、布局、XData、标题栏、明细表和专业对象等事实。

该目录仍是 PoC 产物。Data Layer 管线应验证报告中的源哈希与 schema 后，将其导入 `data/datasets/staging/`；Ontology 和后端不得直接依赖 `dev-test/` 路径。

## 2. 数据分层

```text
client-data/                                   客户不可变 Source
    ↓ 显式登记、SHA-256、来源状态
data/datasets/raw/                             资产清单与规范化输入
    ↓ 文档解析 / THCAD 抽取导入
data/datasets/staging/                         原子事实
    ↓ 身份消歧、字段标准化、工程特征提升
data/datasets/curated/                         Ontology 映射表
    ↓
PostgreSQL 对象状态 + OSS 大文件/产物 + Redis 任务状态
```

## 3. 建议的 curated 数据集

### 第一批：已经有数据基础

- `shenbian.drawing_assets.v1`：文件身份、哈希、大小、来源和状态；
- `shenbian.drawing_revisions.v1`：图号、版本、标题栏与源资产关联；
- `shenbian.extraction_snapshots.v1`：宿主、抽取 schema、源哈希和统计；
- `shenbian.cad_entities.v1`：图元原子事实，采用 Parquet/列式文件，不逐条进入业务数据库；
- `shenbian.cad_tables.v1`：图层、块、布局、文字/标注样式和 RegApp；
- `shenbian.title_blocks.v1`：标题栏字段；
- `shenbian.bom_rows.v1`：明细行及序号关联；
- `shenbian.professional_entities.v1`：天河序号、引出、基准、粗糙度等专业对象。

### 第二批：需要业务共同定义

- `shenbian.manufacturing_regions.v1`：生产主视图与制造区域；
- `shenbian.geometry_features.v1`：轮廓、孔位、连接关系及保护标识；
- `shenbian.lamination_parameter_sets.v1`：铁芯明细字段和单位；
- `shenbian.rule_versions.v1`：经确认的规则版本；
- `shenbian.review_ground_truth.v1`：专家答案、问题分级和验收集。

## 4. 三类基础设施的职责

### PostgreSQL

保存稳定对象身份、链接、版本、任务、Action 运行、Finding、Issue、Approval 和 Artifact 元数据。首期使用独立 schema，避免与其他应用表混杂。

### Redis

保存任务队列、短期执行状态、分布式锁、幂等键和可失效缓存。正式业务结论不得只存在 Redis。

### OSS

保存源文件的受控副本、抽取 JSONL/Parquet、图纸工作副本、DXF、截图、差异包和报告。对象 key 使用资产 ID/内容哈希组织，PostgreSQL 保存引用和谱系。

首轮不上传客户文件；先验证连接与命名空间。原始文件迁移到 OSS 需单独确认数据安全、生命周期、加密和权限策略。

## 5. 首条导入管线

`data/pipelines/import_thcad_extraction/` 后续承担：

1. 读取显式 Catalog，不扫目录发现客户数据；
2. 校验 7 套 extraction report、源 SHA-256、schema 版本和零失败条件；
3. 将 JSON/JSONL 标准化为 staging 数据集；
4. 分离实体事实、标题栏、BOM、专业对象和序号关联；
5. 生成数据质量报告和可复现 manifest；
6. 再由 identity/curation 管线生成图纸版本及 Ontology 映射表。

## 6. 数据使用顺序

1. 先导入 7 套天河抽取事实，建立图纸版本和数据谱系；
2. 用标题栏、明细表和专业对象支撑文件配对、对象识别和规则样例；
3. 对 DXF 净化场景人工标注制造区域和保留/清理对象，形成首个 ground truth；
4. 收集并结构化铁芯参数明细，完成参数到几何的重建规则；
5. 标准 PDF 和企业资料经专家确认后转为 `RuleVersion`；
6. 最后接入 Agent，使其只查询已登记对象并调用受控 Action。

