"""SelectionSet 生命周期（规范）"""


def get_selection_set(doc, name="BN_TEMP"):
    try:
        ss = doc.SelectionSets.Item(name)
        ss.Delete()
    except Exception:
        pass
    return doc.SelectionSets.Add(name)
