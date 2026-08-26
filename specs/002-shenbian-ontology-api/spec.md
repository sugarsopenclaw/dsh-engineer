# 002 — 沈变图纸审查 Ontology API

## 背景

沈变项目首期聚焦两条业务链：生产用 DXF 图纸净化、铁芯叠片一致性校验。现有仓库已经完成 Source、Data Layer、Ontology、Agent 插件的目录分层，也已有 7 张天河 CAD 图纸的旁数据库抽取结果，但还没有承载对象查询、任务状态、受控 Action 和基础设施访问的后端服务。

本规格建立第一条可运行纵向切片：用 FastAPI 提供后端服务，用声明式 Ontology 描述业务对象、关系和动作，用 Data Catalog 登记客户数据与抽取结果。首轮只建立稳定边界，不执行图纸修改和生产输出。

## 目录决策

FastAPI 新建在仓库根目录 `backend/`，不放入 `ontology/`。

- `ontology/`：跨语言、跨运行时的 Object / Link / Action 类型定义，不连接数据库，不启动服务，不存对象实例。
- `backend/`：C/S 系统的服务端，负责 API、应用用例、权限与审计入口、PostgreSQL/Redis/OSS 适配和 Ontology 查询。
- `data/`：客户原文到稳定数据集的登记与可复现管线。后端和 Ontology 只消费 Catalog 与 curated 数据，不直接扫描 `client-data/`。
- `plugins/`：DeepSeek Harness 的 Agent 和交互能力，通过后端公开 API 使用对象、关系和动作。

## 目标

### R1 — 可独立运行的后端

使用 uv 管理 `backend/` 的 Python 版本、虚拟环境和锁文件。FastAPI 应能在 Windows 开发机和后续 Linux 服务端以同一入口启动。

### R2 — 单一环境变量来源

后端只读取仓库根目录 `.env`。不得在 `backend/` 内复制或生成 `.env`。日志、错误响应和测试输出不得回显数据库、Redis、OSS 或模型密钥。

### R3 — 声明式 Ontology

`ontology/shenbian/v1/ontology.yaml` 定义首期对象类型、链接类型和动作类型。后端启动时校验该文件，通过 API 暴露稳定类型 ID、显示名、风险级别和动作审批要求。

### R4 — Data Catalog 是数据入口

后端可读取 `data/catalog/*.yaml`，不得通过 API 进程遍历 `client-data/` 或 `dev-test/`。客户数据的发现、哈希、复制、解析和清洗属于 Data Layer 管线职责。

### R5 — 运行依赖可观测

提供存活与就绪检查。就绪检查分别验证 PostgreSQL、Redis 和 OSS；单项失败必须返回结构化状态，不得阻止进程启动，也不得泄露连接信息。

### R6 — DDD 分层

后端至少包含以下依赖方向：

```text
API → Application → Domain
          ↓
   Infrastructure
```

Domain 不依赖 FastAPI、SQLAlchemy、Redis 或 OSS SDK。Infrastructure 实现 Application 定义的端口。API 只负责协议转换、依赖注入和 HTTP 状态码。

### R7 — 首轮 API

- `GET /api/v1/health/live`：进程存活；
- `GET /api/v1/health/ready`：PostgreSQL、Redis、OSS 就绪状态；
- `GET /api/v1/ontology`：Ontology 概要和全部类型 ID；
- `GET /api/v1/ontology/actions`：受控动作及风险、审批信息；
- `GET /api/v1/data-catalog`：已登记数据集及治理状态。

### R8 — 客户原文不可变

本规格范围内不得修改、重命名、覆盖或上传 `client-data/` 内容。现有 DWG 与 `.bak` 的权威版本仍待确认，两者分别登记来源，不自动判定主版本。

## 非目标

- 不在本轮实现 DWG 解析器、DXF 写出或铁芯几何算法；
- 不把 91,605 个 CAD 图元逐条写入 PostgreSQL；
- 不开放会修改图纸、数据库业务状态或外部系统的 Action 执行接口；
- 不实现登录、组织权限和四级审核工作流；
- 不接入 LLM，不实现 RAG/KAG/OAG；
- 不上传客户文件到 OSS，OSS 首轮只做连通性验证和后续对象存储适配准备。

## 验收标准

1. `backend/` 可用 `uv sync` 安装并由 `uv run shenbian-api` 启动。
2. 自动化测试不需要真实外部服务即可运行。
3. `/health/live`、`/ontology`、`/ontology/actions`、`/data-catalog` 返回确定结果。
4. `/health/ready` 能以不泄密的方式报告三项依赖状态。
5. Ontology 契约至少覆盖两个首期场景共用的对象、关系和动作。
6. Data Catalog 能登记三类客户 Source 和一套天河抽取 staging 数据。
7. `client-data/` 与 `harness/` 无任何修改。

