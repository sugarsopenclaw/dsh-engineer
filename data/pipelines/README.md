# pipelines

Data Layer 转换代码。读 `client-data/` 或上游数据集，写 `data/datasets/`。

- [`shenbian_client_requirements/`](shenbian_client_requirements/)：把客户原始 XLSX/DOCX/Markdown 组织成可追溯的业务需求 Ontology 数据集。
- [`cad_capabilities/`](cad_capabilities/)：把 CAD 各 API surface 的确定性库存变成不可变 CapabilityAtom JSONL，并以独立 enrichment part 支持可恢复 Agent 循环。
