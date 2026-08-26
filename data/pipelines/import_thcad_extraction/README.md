# import_thcad_extraction

把已经验证的 `dev-test/visualstudionetframework/out-thcad/` PoC 结果导入 Data Layer。正式实现必须读取 Catalog、校验 extraction report 与源 SHA-256，并且只写 `data/datasets/`。

计划输出：

- `data/datasets/raw/shenbian-drawing-assets/`
- `data/datasets/staging/shenbian-thcad-extraction/`
- 数据质量报告和可复现 manifest

该管线不修改 `client-data/`，也不让 Ontology 或 FastAPI 直接依赖 `dev-test/`。

