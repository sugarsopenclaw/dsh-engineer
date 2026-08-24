"""MText 格式码清洗（规范原文）"""

import re


def clean_mtext(raw: str) -> str:
    t = raw
    t = re.sub(r"\\P", "\n", t, flags=re.IGNORECASE)  # 换行
    t = re.sub(r"\\[fF][^;]*;", "", t)  # 字体
    t = re.sub(r"\\[ACcHhQqTtWwLlOoKk][^;]*;", "", t)  # 格式控制
    t = re.sub(r"\\S([^;]*);", r"\1", t)  # 堆叠文字
    t = t.replace("\\~", " ")  # 不间断空格
    t = re.sub(r"[{}]", "", t)  # 花括号
    t = t.replace("\\\\", "")  # 转义反斜杠
    return t.strip()
