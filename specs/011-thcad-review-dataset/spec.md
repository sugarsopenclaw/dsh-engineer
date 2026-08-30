# 011 · THCAD 可复验运行包与训练候选

状态：Implemented

## 目标

每次 THCAD 机械或视觉委派都生成唯一、不可覆盖的本地 review bundle，使一次现场任务的输入、主/子 Agent 输出、工具轨迹、视觉输入、确定性证据和当次 01–20 原始产物可以按同一 `run_id` 复核，并可在人工筛选后导出为微调候选数据。

## 数据布局

```text
.pi/runtime/thcad-reviews/
  runs/<run-id>/
    request.json
    parent-system-prompt.md
    child-system-prompt.md
    child-events.jsonl
    child-stderr.log
    child-session/*.jsonl
    child-result.json
    child-inputs.json            # 视觉 child 实际收到的图片及 CAS 引用
    visual-assessment.json       # 存在时的结构化视觉判断
    evidence.md
    artifact-manifest.json
    parent-result.json
    parent-session.jsonl
    review-manifest.json
  objects/sha256/<aa>/<sha256>
  cache/
  exports/
```

## 必须满足

- child 每次仍是 fresh、隔离上下文，但改用唯一 `--session-dir` / `--session-id` 保存原生 Pi Session，不得续接前一次 child。
- 同时保存 child JSON 模式的完整 stdout 事件流和 stderr；解析失败的事件也必须保留原始字节。
- 每次运行冻结当次 `current-analysis.json`、分析目录全部文件和存在时的跨图项目图；源文件后来被同名覆盖不得改变旧 run。
- 大文件用 SHA-256 内容寻址对象库存一份，run manifest 记录逻辑路径、源引用、字节数、SHA-256 和对象引用。
- 保存父任务原始提示、系统提示、模型/思考等级、父 Session 标识、最终消息及当时的父 Session JSONL 快照。
- 父提示含图片时，图片字节写入同一 SHA-256 对象库，request/export 只保留 MIME、大小、哈希和对象引用。
- 子代理运行时生成的视觉输入也必须在调用模型前写入同一对象库；保存角色、MIME、出图 provenance、DBMOD、尺寸与哈希，并纳入完整性校验和候选导出。
- 保存 Git HEAD、相关集成路径脏状态、Pi/插件/Node 版本及 current Bridge deployment DLL 哈希。
- bundle 最终清单对 bundle 内文件逐一计算 SHA-256；提供离线完整性验证。
- 失败、取消和缺失 artifact 也要形成 partial run，不得因为没有最终答案而丢失现场。
- 所有数据只写被 Git 忽略的 `.pi/runtime/`；不自动上传、不写客户源文件目录、不复制 DWG 二进制。
- 训练候选导出必须明确标记 `unreviewed` / `training_eligible=false`，不得把模型推断自动当作金标。

## 明确边界

- 只能保存供应商实际返回并由 Pi 暴露的 reasoning/text，不能声称保存模型未暴露的内部思维。
- dirty 图纸保存的是当次抽取产物、DBMOD 与证据，不是未保存 DWG 的二进制快照。
- 内容寻址对象库用于本机去重与复验，不是产品数据库、客户数据上传或长期保留策略。
- 本切片不决定最终微调格式、脱敏规则、数据授权、质量标签或训练平台。

## 验收

- fixture 证明源 artifact 被覆盖后旧 run 仍可由 CAS 还原并通过 SHA-256 校验。
- 重复快照相同文件复用同一对象，不重复保存 351 MB 级原始字节。
- child 原生 Session、raw events、evidence、artifact manifest 和父 Session snapshot 均可由同一 run 找到。
- Pi 类型检查、现有 01–20 artifact 测试和 review-store 测试通过。
- TUI 真机窄任务生成完整 bundle，且不新增 CAD 写操作。
