# 013 · THCAD 图纸会话与项目文字索引

状态：Implemented

## 目标

让 Pi 父 Agent 能在不修改客户原图的前提下管理多图纸 THCAD 会话，并用可重建的项目级文字索引把“法兰审图”等自然语言任务路由到已有 BOM 构件精读链路。

## 用户路径

```text
用户业务词
  → thcad_project_texts build/status/search
  → 图纸 + bom_item_number 命中
  → thcad_app open/activate
  → delegate_thcad_bom_close_reading
  → 单图 Review 证据包 + 父 Agent 跨图汇总
```

## 会话契约

- `status/list` 返回活动图、所有打开图、只读状态与各图 DBMOD。
- `open` 只接受 `client-data/` 或 `.pi/runtime/thcad-workspace/` 内的 DWG；客户原图由本工具新打开时强制只读。若同一客户图已由用户可写打开，`open` 报告冲突而不谎称只读，既有会话仍可用 `activate` 做读取。
- `activate` 只能按唯一名称或路径切换已打开图。
- `close` 从不代存；DBMOD 非零或不可确定时，未显式 `discard_changes=true` 必须拒绝。
- `copy_to_workspace` 默认复制磁盘已保存态；`from_session=true` 才通过受保护的 save-as 捕获会话态。
- `save` 只允许保存已经位于工作区内的图纸。
- C# Host 与 TypeScript runtime 分别校验一次读写根，任何写路径不得落入 `client-data/`。

## 索引契约

- 默认扫描 `client-data/transformer-design-drawings/` 与 `.pi/runtime/thcad-workspace/`。
- THCAD 通过 side database 读取 DWG，不打开编辑器窗口，不改变活动图或视图。
- 记录覆盖 DBText、MText、块属性、属性定义、Dimension、MLeader、块名、`PC_MXB_BLOCK` 结构化 BOM 行及 `PC_TITLE_BLOCK` 标题栏。
- `.pi/runtime/thcad-bridge/text-index/manifest.json` 保存每图 SHA-256、size、mtime、记录数、标题元数据以及扫描时的 open/dirty 状态；正文按图写入 JSONL。
- build 对未变化 SHA 条目跳过 side-DB 扫描；缓存可删除重建，不进入 Git 或 Data Layer。
- 单图重扫失败时保留仍有 JSONL 的 last-good 条目并标为 stale；不得用部分成功的 manifest 把旧可用图从项目检索中静默删除。
- status 同时检查 manifest 条目、JSONL、默认扫描根中的新增 DWG；search 遇到单图 JSONL 不可用时返回 partial 覆盖账本，不让一图拖垮整次查询。
- search 默认做 Unicode NFKC、大小写折叠和空白折叠后的包含匹配；可显式 regex，并可按 source、layer、drawing 过滤。
- 结果按图分组且有全局上限；BOM 命中必须保留 `bom_item_number`、handle、位置和八列字段，不向模型灌入整库。

## 桥协议

- 程序集：`Shb.Thcad.AgentBridge.V4.dll`，版本 `0.4.0.0`。
- Modal 命令 `SHBTHCADAGENTV4` 认领 `status/extract_current/locate_handles/scan_texts`。
- Session 命令 `SHBTHCADAGENTV4APP` 认领 `open_document/activate_document/close_document/save_document_as/save_document`。
- 每次控制调用把 `request_id` 传给对应命令，Host 只认领这一份 pending；两类命令仍校验 operation 上下文，不跨类执行。控制失败只回收本次尚未认领的 pending，旧请求不会被后续命令发现重放。
- 控制脚本 stdout 保持有界；大响应由 Node 从 response 文件读取。

跨图 BOM 精读仍由父 Agent 按任务自由编排，不引入固定“法兰工作流”；从检索命中路由时可把 drawing 作为 `expected_document` 传给精读工具，宿主只负责在刷新/出图前核对活动图。

## 非目标

- 不修改 `harness/` 或 `pi/` 上游。
- 不把文字索引升级为客户知识库或训练集；它只是本机可重建路由缓存。
- 不提供实体新增、删除、改尺寸、去标注等图形编辑能力。
- 不自动关闭用户原先打开的 dirty 图纸，不自动重启 THCAD。
- 不把索引磁盘态覆盖当前 dirty 会话态；激活后仍以当前图 01–20 刷新结果为准。

## 验收

- V4 Release 构建、Pi 类型检查和既有 01–20 测试通过，`harness/`/`pi/` clean。
- 七张样图 side-DB 索引无失败；再次 build 全量命中增量跳过。
- “法兰”能命中对应图纸、BOM 行和序号。
- 真机完成客户图只读打开、图纸切换、显式丢弃关闭、磁盘态复制到工作区及工作区保存。
- 原活动图恢复，客户文件未写入，DBMOD 不因索引扫描改变。
