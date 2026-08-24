---
name: frustum-box-foundation
description: 计算由下部矩形体与上部矩形截头体组成的锥形独立基础；当证据包含 DJ/DJP、截头体、棱台、截锥或 h1/h2 尺寸时使用。
---

# 截头体+底座独立基础算量

## 适用边界

满足以下条件时可直接套用：

1. 形态为“下部方箱 + 上部矩形截头体”。
2. 截头体上下底面平行，且与高度方向正交。
3. 尺寸数据可提取出 `bottom_length/bottom_width/top_length/top_width/h1/h2`。

# ⚠ 截图几何描述（必须先做！）

在提取 CAD 数据后、生成代码前，**必须先用自然语言描述**你从截图中看到的几何形状：

1. **确认层数和顺序**：从下到上依次是什么形状？（方箱在下还是在上？截头体在下还是在上？）
2. **确认每层尺寸的含义**：文本 "300/700" 中，300 对应哪一层？700 对应哪一层？
3. **确认底面尺寸**：底面是正方形还是矩形？长和宽分别是多少？
4. **确认顶面尺寸**：截头体的上底面（小面）尺寸是多少？注意区分"柱截面"和"截头体顶面"
5. **尺寸交叉验证**：分段尺寸之和应等于总尺寸（如 2250+75+850+75+2250=5500）

描述示例：
> 从截图看，这是一个两层独立基础：
> - 下层：方箱（棱柱），底面 5500×2300 mm，高度 300 mm
> - 上层：截头体（棱台），底面 5500×2300 mm，顶面 850×750 mm，高度 700 mm
> - 文本 "300/700" 表示 h_box=300, h_frustum=700
> - 尺寸验证：长度方向 2250+75+850+75+2250=5500 ✓

# 参数映射

1. `bottom_length` / `bottom_width`：底面长宽。
2. `top_length` / `top_width`：截头体顶面长宽。
3. `h1`：底部方箱高度（文本 "h1/h2" 中的第一个数字）。
4. `h2`：截头体高度（文本 "h1/h2" 中的第二个数字）。

# ⚠ 常见混淆点

1. **上下层搞反**：造价师说"下部方箱+上部截头体"，但 CAD 数据中多段线面积从大到小排列，最大的是底面，不一定代表"下部"的形状。
2. **底面 ≠ 最大多段线**：最大闭合多段线的面积可能是整个基础的外轮廓（如 5500×5500），但实际计算底面可能是 5500×2300（矩形基础不是正方形）。
3. **顶面 ≠ 柱截面**：截头体的顶面（上底面）和立在上面的柱截面是两个不同的尺寸。顶面通常比柱截面大。
4. **分段尺寸**：标注中的 2250、2300 等可能是"从中心到边缘"或"从柱边到基础边"的距离，不是总尺寸。必须验证分段之和。
5. **h1/h2 顺序**：文本 "300/700" 中 300 是方箱高度（通常较小），700 是截头体高度（通常较大）。但不同图纸约定可能不同，**必须对照截图确认**。

# 参数词典（造价口径）

1. 底板尺寸：可计入垫层以上的基础底面净尺寸。
2. 顶面尺寸：指截头体与方箱交界面尺寸，不是柱截面尺寸。
3. 分层高度：以构件做法标注为准，常见写法 `h1/h2` 或 `h2+h1`。
4. 单位默认 mm，最终体积统一到 m³。

# 计算公式

1. 底面面积：`S_bottom = bottom_length * bottom_width`
2. 顶面面积：`S_top = top_length * top_width`
3. 截头体体积：
   `V_frustum = (h2 / 3) * (S_bottom + S_top + sqrt(S_bottom * S_top))`
4. 方箱体积：
   `V_box = bottom_length * bottom_width * h1`
5. 总体积：
   `V_total_mm3 = V_frustum + V_box`
6. 单位换算：
   `V_total_m3 = V_total_mm3 / 1e9`

# 算法伪代码（用于生成 calc）

```python
def calc(data: dict) -> dict:
    dims = data.get("dimensions", [])
    texts = data.get("texts", [])
    polys = data.get("polylines", [])

    # A. 参数识别
    bottom_L, bottom_W = infer_bottom_dims(dims, polys)
    top_L, top_W = infer_top_dims(dims)
    h1, h2 = infer_heights(texts)

    # B. 合规校核
    if top_L > bottom_L or top_W > bottom_W:
        raise ValueError("顶面尺寸不应大于底面尺寸，需人工复核")

    # C. 分体计算
    s_bottom = bottom_L * bottom_W
    s_top = top_L * top_W
    v_frustum = (h2 / 3.0) * (s_bottom + s_top + (s_bottom * s_top) ** 0.5)
    v_box = bottom_L * bottom_W * h1
    v_m3 = (v_frustum + v_box) / 1e9

    return {
        "result": round(v_m3, 3),
        "unit": "m³",
        "steps": [
            f"S_bottom={s_bottom} mm2",
            f"S_top={s_top} mm2",
            f"V_frustum={v_frustum} mm3",
            f"V_box={v_box} mm3",
        ],
    }
```

# 尺寸交叉验证（必须执行）

生成代码前，用以下规则验证参数提取是否正确：

1. **分段求和验证**：如果标注中有 2250、75、850、75、2250，验证 2250+75+850+75+2250 是否等于 bottom_length。
2. **面积对照**：`bottom_length × bottom_width` 应与最大闭合多段线的面积一致（或合理接近）。
3. **截头体上下面关系**：`top_length < bottom_length` 且 `top_width < bottom_width`，否则几何不成立。
4. **高度总和**：`h1 + h2` 应等于基础总高度。

# 实现约束

1. 保留中间量并写入 steps，便于核对。
2. 如果 `top_length > bottom_length` 或 `top_width > bottom_width`，标记为异常并提示人工复核。
3. 结果建议保留 2~4 位小数，默认 2 位。

# 与其它亚型区分

1. 若存在 3 阶及以上明显台阶，优先切换到“阶梯台体亚型”技能。
2. 若顶面为圆形，切换到“圆台或圆柱亚型”技能。
