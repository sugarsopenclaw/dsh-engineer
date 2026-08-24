# 真实项目双通道实体数据

这里保存由用户明确选定的真实 CAD 项目的采集结果，用于比较 AutoCAD COM 与
MLightCAD 对同一份图纸的实体理解。真实图纸和采集结果默认只保留在本机，不提交
到 Git。

## 目录约定

每张图纸使用一个稳定的 case 目录：

```text
projects/<project>/<drawing>-<source-sha256-prefix>/
  source/
    manifest.json              # 原文件位置、哈希、大小；默认不复制 DWG
  channels/
    autocad-com/
      entities.raw.jsonl       # AutoCAD 当前内存数据库的只读采集
      entities.readable.md
      summary.json
      provenance.json
    mlightcad/
      entities.raw.jsonl       # MLightCAD 对磁盘 DWG 的只读解析
      entities.readable.md
      summary.json
      provenance.json
  comparison/
    report.json
    report.md
  run/
    manifest.json
    logs/
```

原始通道输出不可手工修饰；归一化、匹配和差分属于 `comparison/` 下的派生证据。
每个通道都必须明确记录采集范围。`database_authored_entities` 表示遍历模型空间、
图纸空间及所有块定义中的原生实体；`drawing_file_graph_authored_entities` 还包括已
单独解析并映射回宿主命名空间的外参文件。二者都不是块参照展开后的“场景实例”，
也不宣称能够读取代理对象、OLE 内嵌内容或缺失外部参照的内部几何。

## 隐私与可复现性

- `projects/*` 被本目录的 `.gitignore` 忽略，防止真实项目数据误提交。
- 默认只记录源 DWG 的绝对路径与 SHA-256，不复制源文件。
- AutoCAD 通道会分别记录磁盘文件哈希和活动文档的 `Saved`/`DBMOD` 状态。若文档
  有未保存修改，两个通道并非严格读取同一字节快照，报告必须显式降级该比较证据。
- 若要把真实案例沉淀为公开回归样本，应先脱敏并单独审核授权，不能直接移动本目录
  的原始输出。

## 采集命令

AutoCAD 已打开目标图纸时：

```powershell
python cadkernel/scripts/capture_autocad_com.py `
  --expect-path "C:\path\drawing.dwg" `
  --output "cadkernel\real-projects\projects\project\case\channels\autocad-com"
```

MLightCAD 从磁盘读取同一 DWG：

```powershell
Set-Location dev/frontend
npm run extract:mlight-dual -- `
  --drawing="C:\path\drawing.dwg" `
  --output="C:\path\case\channels\mlightcad" `
  --autocad-provenance="C:\path\case\channels\autocad-com\provenance.json"
```

传入 AutoCAD provenance 后，驱动会读取其中的外参块和路径。MLightCAD 当前不会原生
绑定 DWG 外参，因此驱动会对可用的外参文件逐一做独立只读解析，再按 AutoCAD 的
`xrefAlias|name` 命名空间规则合并。原始文件图谱、各文件哈希和这一步投影会写入
MLightCAD provenance；找不到的外参会保留为 `missing`，不会把不完整结果伪装成全量。
