"""ModelSpace 遍历"""


def iter_modelspace(doc):
    ms = doc.ModelSpace
    n = int(ms.Count)
    for i in range(n):
        yield ms.Item(i)
