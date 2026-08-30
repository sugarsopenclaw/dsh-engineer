# 008 — 实施计划

## 数据流

1. 从 `data/datasets/staging/cad-capabilities/{thcad-v24,autocad-2024}.*` 读取十个已验证库存。
2. 逐库存校验 manifest、原子哈希、ID、排序和 enrichment 完整性。
3. 为每个库存生成一个已排序临时片段，再以 `atom_id` 做多路归并，生成自包含 v2。
4. 用现有事务导入器写入同一组 ontology 表；只替换相同 `dataset_id` 的行。
5. v2 验收后切换 API 默认数据集，保留显式 v1 查询。
6. 入库时在 PostgreSQL 内部生成按“数据集 + 技术面 + 宿主”分片的 gzip 图投影；批量 API 冷启动读取压缩投影，列表和详情仍以原子表为准。

## 文件

- `data/pipelines/cad_capabilities/build_curated.py`：参数化 v1/v2 并改为有界内存构建；
- `data/catalog/cad-capabilities.curated-v2.yaml`：登记综合数据集；
- `data/datasets/curated/cad-capabilities/v2/`：本机可重建产物，不进 git；
- `backend/src/shenbian_api/application/cad_capabilities.py`：默认数据集切换；
- `backend/migrations/`：登记与 dataset 同生命周期的压缩图投影缓存；
- `ontology/cad_capabilities/v1/`：对象类型不变，只更新当前 backing dataset；
- `docs/backend/`：更新真实数量、宿主与 API 示例。

## 取舍

`atom_id` 是扫描器按技术面与 canonical key 生成的事实 ID。本轮发现两批库存没有相同 ID，因此可直接作为独立对象装入 v2；即使未来发现碰撞，也应让构建失败并单独设计身份策略，而不是静默合并。
