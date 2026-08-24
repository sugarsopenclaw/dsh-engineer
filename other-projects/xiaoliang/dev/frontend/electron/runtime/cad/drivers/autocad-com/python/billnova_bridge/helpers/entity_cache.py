"""实体缓存：nearby/nearest 使用缓存，避免每次遍历 ModelSpace（规范）"""


class EntityCache:
    """缓存当前文档的实体数据，文档变化时失效"""

    _cache = None
    _doc_name = None

    @classmethod
    def get_all(cls, doc, loader):
        """
        loader: callable(doc) -> list[dict] 序列化后的实体列表
        """
        if cls._doc_name != doc.Name or cls._cache is None:
            cls._cache = loader(doc)
            cls._doc_name = doc.Name
        return cls._cache

    @classmethod
    def invalidate(cls):
        cls._cache = None
        cls._doc_name = None

    @classmethod
    def set_from_read_all(cls, doc, entities):
        """entity.read_all 填充缓存"""
        cls._cache = entities
        cls._doc_name = doc.Name
