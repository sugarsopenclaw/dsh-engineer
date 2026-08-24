"""纯 Python 几何：点到线段、射线法、线段交点、多边形质心等"""

from __future__ import annotations

import math
from typing import Any, Dict, List, Optional, Sequence, Tuple

from entity_serializer import representative_point


def distance_point_to_segment_sq(px: float, py: float, ax: float, ay: float, bx: float, by: float) -> float:
    abx, aby = bx - ax, by - ay
    apx, apy = px - ax, py - ay
    ab2 = abx * abx + aby * aby
    if ab2 <= 0:
        return apx * apx + apy * apy
    t = max(0.0, min(1.0, (apx * abx + apy * aby) / ab2))
    cx, cy = ax + t * abx, ay + t * aby
    dx, dy = px - cx, py - cy
    return dx * dx + dy * dy


def distance_point_to_segment(px: float, py: float, ax: float, ay: float, bx: float, by: float) -> float:
    return math.sqrt(distance_point_to_segment_sq(px, py, ax, ay, bx, by))


def point_in_polygon_xy(px: float, py: float, verts: Sequence[Sequence[float]]) -> bool:
    if len(verts) < 3:
        return False
    inside = False
    n = len(verts)
    j = n - 1
    for i in range(n):
        xi, yi = float(verts[i][0]), float(verts[i][1])
        xj, yj = float(verts[j][0]), float(verts[j][1])
        if ((yi > py) != (yj > py)) and (px < (xj - xi) * (py - yi) / (yj - yi + 1e-15) + xi):
            inside = not inside
        j = i
    return inside


def segment_intersection(
    ax: float, ay: float, bx: float, by: float, cx: float, cy: float, dx: float, dy: float
) -> Optional[Tuple[float, float]]:
    """线段 AB 与 CD 交点；无平行/无交返回 None"""
    r_x, r_y = bx - ax, by - ay
    s_x, s_y = dx - cx, dy - cy
    denom = r_x * s_y - r_y * s_x
    if abs(denom) < 1e-12:
        return None
    t = ((cx - ax) * s_y - (cy - ay) * s_x) / denom
    u = ((cx - ax) * r_y - (cy - ay) * r_x) / denom
    if 0 <= t <= 1 and 0 <= u <= 1:
        return (ax + t * r_x, ay + t * r_y)
    return None


def polygon_centroid_2d(verts: List[List[float]]) -> Tuple[float, float]:
    if len(verts) < 3:
        sx = sum(v[0] for v in verts)
        sy = sum(v[1] for v in verts)
        n = max(1, len(verts))
        return (sx / n, sy / n)
    a = 0.0
    cx = 0.0
    cy = 0.0
    for i in range(len(verts)):
        j = (i + 1) % len(verts)
        xi, yi = float(verts[i][0]), float(verts[i][1])
        xj, yj = float(verts[j][0]), float(verts[j][1])
        cross = xi * yj - xj * yi
        a += cross
        cx += (xi + xj) * cross
        cy += (yi + yj) * cross
    if abs(a) < 1e-12:
        sx = sum(v[0] for v in verts)
        sy = sum(v[1] for v in verts)
        n = len(verts)
        return (sx / n, sy / n)
    a *= 0.5
    return (cx / (6.0 * a), cy / (6.0 * a))


def sample_points_from_serialized(e: Dict[str, Any], max_pts: int = 64) -> List[Tuple[float, float]]:
    """从序列化实体取若干采样点用于距离实体"""
    pts: List[Tuple[float, float]] = []
    t = str(e.get("type", "")).lower()
    if "start" in e and "end" in e:
        s, e2 = e["start"], e["end"]
        pts.append((float(s[0]), float(s[1])))
        pts.append((float(e2[0]), float(e2[1])))
    if "center" in e:
        c = e["center"]
        pts.append((float(c[0]), float(c[1])))
    if "vertices" in e:
        for v in (e.get("vertices") or [])[: max_pts // 2]:
            pts.append((float(v[0]), float(v[1])))
    if "position" in e:
        p = e["position"]
        pts.append((float(p[0]), float(p[1])))
    if "insert_point" in e:
        p = e["insert_point"]
        pts.append((float(p[0]), float(p[1])))
    bbox = e.get("bbox")
    if bbox and "min" in bbox and "max" in bbox:
        mn, mx = bbox["min"], bbox["max"]
        pts.extend(
            [
                (float(mn[0]), float(mn[1])),
                (float(mx[0]), float(mn[1])),
                (float(mx[0]), float(mx[1])),
                (float(mn[0]), float(mx[1])),
                ((float(mn[0]) + float(mx[0])) / 2, (float(mn[1]) + float(mx[1])) / 2),
            ]
        )
    rp = representative_point(e)
    if rp is not None:
        pts.append((float(rp[0]), float(rp[1])))
    out: List[Tuple[float, float]] = []
    seen = set()
    for x, y in pts:
        key = (round(x, 4), round(y, 4))
        if key in seen:
            continue
        seen.add(key)
        out.append((x, y))
        if len(out) >= max_pts:
            break
    return out
