# 19 · 版本与阶段语义差分

19 把 04/05/08/11/13/16/17/18 已经形成的作者证据和确定性派生结果投影成稳定语义快照，再比较初设、评审、生产或不同修订版。它比较的是图纸身份、结构几何、标注、BOM、技术要求、制造轮廓、接口和尺寸绑定，不把 DWG handle 的变化直接当设计变更，也不把两张无关图的全部内容误报为新增/删除。

## 两层产物

- `SemanticDrawingSnapshotBuilder`：从当前分析链生成 `semantic-drawing-snapshot.json/.md`。每个元素保留 domain/kind、稳定键、结构回配签名、平移不变几何签名、包围盒、语义值、数值、样式、关系、源 ID/handle、状态和预算诊断；标题栏中的图样代号、页码、改版标记和阶段作为身份证据，不从几何猜版本。
- `SemanticDrawingDiffAnalyzer`：先过图纸身份门，再用至少三条稳定未变锚点估计全图平移；随后按唯一稳定键精确匹配，并只对剩余元素做“同 domain/kind/结构签名 + 对齐后近接”的保守回配。等距或竞争候选显式保留为多解。

差异分类彼此独立：`geometry_changed`、`moved`、`semantic_value_changed`、`association_changed`、`evidence_status_changed`、`style_only_changed`、`added_candidate`、`removed_candidate`。尺寸值与绑定结构只有一侧变化时生成同步复核候选；稳定 issue key 形成 `new_candidate / persisting / closed_or_not_reproduced_candidate` 生命周期；有空间范围的变化再聚成复核区域。

## 安全边界

1. 图样代号冲突、同图号页码冲突或身份未建立时，默认直接 `not_comparable`，不会批量生成新增/删除。
2. 全图配准仅允许平移，不用任意仿射变换“抹掉”实体移动；配准证据不足或冲突会变成 `ambiguous`，并停止把未匹配元素分类为新增/删除。
3. 稳定键重复、空间等距、候选预算截断和快照截断都阻止过度匹配或“缺失即删除”结论。
4. `added/removed`、尺寸同步和 issue 关闭都只是候选，不等同于设计意图、漏改、问题关闭或规范判定。
5. 算法只读；它生成派生 JSON/Markdown，不修改、删除、移动或保存 DWG 实体。

## 使用

整图 THCAD 抽取会生成当前版本的 `semantic-drawing-snapshot.json/.md`。拿到两次抽取的快照后离线比较：

```powershell
.\local-dev\cad\core\19-semantic-drawing-diff\compare-semantic-drawing-snapshots.ps1 `
  -BaselinePath <旧版\semantic-drawing-snapshot.json> `
  -CurrentPath <新版\semantic-drawing-snapshot.json> `
  -OutputDirectory <差分输出目录>
```

输出为 `semantic-drawing-diff.json/.md`。只有调用方明确接受无验证身份风险时才使用 `-AllowUnverifiedIdentity`。

合成回归：

```powershell
.\local-dev\cad\core\19-semantic-drawing-diff\test-semantic-drawing-diff.ps1
```

2026-08-29 七张保存事实回归生成 130,732 个语义元素：59,569 个世界坐标几何 occurrence、125 个区域、25,349 个制造轮廓/内嵌边界、6,083 个接口特征、7,485 个接口模式、31,409 条邻接证据和 712 个尺寸绑定；每图自差分均为“全部匹配、变化/新增/删除/多解为 0”。最大图的快照投影约 2.68 秒，自差分约 0.59 秒。另把同图号 `5TBC.709.A110050.1` 的第 1 页与第 2 页交叉比较，结果为 `different_sheet_proven / not_comparable`，变化、新增和删除均为 0，证明身份门没有把跨页内容制造成整图差异。这些仍不是跨版本准确率验证：当前七张样本没有成对的真实修订版，必须取得同一图号/页码的前后版本后才能评价真实变更召回率和误报率。
