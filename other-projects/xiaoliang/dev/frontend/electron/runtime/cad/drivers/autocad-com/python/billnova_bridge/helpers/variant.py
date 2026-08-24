"""VARIANT 点坐标封装（规范原文）"""

import pythoncom
from win32com.client import VARIANT


def make_point(x, y, z=0.0):
    return VARIANT(pythoncom.VT_ARRAY | pythoncom.VT_R8, (x, y, z))


def round_point(pt):
    """坐标保留 2 位小数（规范）"""
    if pt is None:
        return [0.0, 0.0]
    try:
        return [round(float(pt[0]), 2), round(float(pt[1]), 2)]
    except Exception:
        return [0.0, 0.0]


def round_point3(pt):
    if pt is None:
        return [0.0, 0.0, 0.0]
    try:
        return [round(float(pt[0]), 2), round(float(pt[1]), 2), round(float(pt[2]), 2)]
    except Exception:
        return [0.0, 0.0, 0.0]


def variant_flat_to_xy_pairs(flat):
    """VARIANT 展平数组 → [[x,y], ...]"""
    if flat is None:
        return []
    try:
        lst = list(flat)
    except Exception:
        return []
    out = []
    for i in range(0, len(lst) - 1, 2):
        out.append([round(float(lst[i]), 2), round(float(lst[i + 1]), 2)])
    return out


def make_polygon_points_flat(points_2d):
    """多边形顶点 [[x,y],...] → VARIANT 展平 (x,y,z)*"""
    flat = []
    for p in points_2d or []:
        flat.extend([float(p[0]), float(p[1]), 0.0])
    return VARIANT(pythoncom.VT_ARRAY | pythoncom.VT_R8, tuple(flat))


def make_short_array_i2(codes):
    return VARIANT(pythoncom.VT_ARRAY | pythoncom.VT_I2, tuple(int(c) for c in codes))


def variant_flat_to_xyz_triples(flat):
    if flat is None:
        return []
    try:
        lst = list(flat)
    except Exception:
        return []
    out = []
    for i in range(0, len(lst) - 2, 3):
        out.append(
            [round(float(lst[i]), 2), round(float(lst[i + 1]), 2), round(float(lst[i + 2]), 2)]
        )
    return out
