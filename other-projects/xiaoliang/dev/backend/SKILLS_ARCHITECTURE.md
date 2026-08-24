# Skills 投稿退役与客户端三分类架构

## 结论

自 2026-08-09 起，晓量不再接收 skill 投稿。后端只负责“市场”skill 的单向版本分发；客户端负责随包内置 skills 与用户本地自制 skills。已经确认的 CAD 算法仍可保存在本机算法库，不再自动生成投稿草稿或上传证据。

## 退役范围

### 后端

- 删除 `/submissions` 全部路由：列表、创建、自动收纳、详情、资产、几何快照、提交和审核。
- 删除由投稿审核产生的 `GET /skills` 与 `GET /skills/{skill_id}` 社区目录接口。
- 删除 Submission/Skill/SkillVersion 的服务、仓储、请求响应 schema、资产存储与亚型提取脚本。
- 删除投稿与亚型提取测试、示例草稿文本和相关环境变量。
- 不在本次变更中执行生产数据库 DROP；旧表数据先保留，待单独的数据保留期与迁移审批确定后再清理。

### 客户端

- 删除 submissions API 封装、未挂载的投稿工作台和共享投稿类型。
- 删除 `cad_skill_draft_create`、教学模式内部 authoring skill、本地投稿草稿 store 与 `draftSkills` 状态。
- `cad_algorithm_save` 仍保留；它只保存用户已确认的本地算法，并明确不投稿、不上传。

## 保留范围

- `GET /skills/releases/check`：检查稳定通道市场包版本。
- `GET /skills/releases/pack`：下载只读市场包。
- `frustum-box-foundation`：当前唯一市场算量 skill，支持下部矩形体加上部矩形截头体的体积流程。
- 项目归档、会话归档和云文档解析接口完全保留，与 skill 投稿无关。
- 自制 skill 后台归档：`POST /user-skills/archive/snapshots/start`、`/files/prepare`、`/files/confirm`、`/snapshots/{id}/complete`。这是账号级收集通道，不是市场投稿。

## 客户端三分类

| 分类 | 来源与更新 | 用户权限 | 当前内容 |
|---|---|---|---|
| 内置 | 随客户端发布和升级 | 只读 | DOCX/XLSX/PPTX/报告生成与自制 skill 指导 |
| 市场 | 后端只读版本包 | 检查并安装更新 | `frustum-box-foundation`；客户端包内有离线回退副本 |
| 自制 | 用户 Agent Workspace 的 `skills/` | 创建、编辑、启停、删除 | 用户通过设置页或 Agent 工具创建的本地 skills；客户端后台按账号归档到私有 OSS |

## Skill 规范与安全边界

- 目录和 frontmatter `name` 使用一致的 2-64 位小写 hyphen-case slug；`description` 说明“做什么”和“何时使用”，不超过 1024 字符。
- `SKILL.md` 正文不超过 500 行；细节按需拆到 `references/`，遵循元数据、正文、资源三级渐进披露。
- `agents/openai.yaml` 保存展示名、短描述、`$slug` 默认提示和隐式触发策略。
- 市场包只允许 `SKILL.md` 与一层文本 references；安装前验证 domain、slug、路径、文件数、大小和 SHA-256，不接收远程脚本。
- 自制 skill 的 scripts/assets 可以由用户维护，但默认视为不可信，只允许按需读取文本，不自动执行。
- 手动放入用户 skills 目录的条目默认禁用；只有校验通过且用户启用后才参与调用。

## Office skills 迁移与阅读 skill 退役

从晓图迁入并按晓量工具边界重写：`document-writing`、`spreadsheet-writing`、`presentation-writing`、`report-writing` 与 `create-skills`。未迁入晓图的原位 inspect/edit 声明；晓量当前提供受控的新建 DOCX、XLSX、PPTX 与文本产物能力，全部限定在项目 `xiaoliang-outputs`，默认不覆盖同名文件。

`project-file-reading-playbook`、`pdf-reading`、`docx-reading`、`spreadsheet-reading` 已退役。PDF、Word、PowerPoint、Excel 直接由 `doc_parse` 按工具参数完成解析；阅读链路不再先加载重复的 SKILL.md。该裁剪只影响阅读 skills，写产物与自制 skill 的领域规则继续保留。
