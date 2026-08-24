import sys
import unittest
from pathlib import Path


PYTHON_DIR = Path(__file__).resolve().parents[1]
if str(PYTHON_DIR) not in sys.path:
    sys.path.insert(0, str(PYTHON_DIR))

import cad_worker_billnova as worker  # noqa: E402


class FakeEntity:
    def __init__(self, object_name, handle, layer):
        self.ObjectName = object_name
        self.Handle = handle
        self.Layer = layer


class FakeModelSpace:
    def __init__(self, entities):
        self._entities = entities
        self.Count = len(entities)

    def Item(self, index):
        return self._entities[index]


class FakeDocument:
    def __init__(self, entities):
        self.ModelSpace = FakeModelSpace(entities)


class FakeApplication:
    def __init__(self, entities):
        self.ActiveDocument = FakeDocument(entities)


class ReadableIndexTest(unittest.TestCase):
    def test_readable_index_serializes_only_readable_entities(self):
        entities = [
            FakeEntity("AcDbLine", "L1", "轴线"),
            FakeEntity("AcDbPolyline", "P1", "轮廓"),
            FakeEntity("AcDbText", "T1", "说明"),
            FakeEntity("AcDbRotatedDimension", "D1", "标注"),
            FakeEntity("AcDbBlockReference", "B1", "轴号"),
        ]
        serialized_object_names = []

        def fake_get_application():
            return FakeApplication(entities)

        def fake_serialize_entity(ent):
            serialized_object_names.append(ent.ObjectName)
            if ent.ObjectName in {"AcDbLine", "AcDbPolyline"}:
                raise AssertionError("geometry-only entities must not be serialized")
            type_key = {
                "AcDbText": "text",
                "AcDbRotatedDimension": "dimension",
                "AcDbBlockReference": "block_reference",
            }[ent.ObjectName]
            return {
                "handle": ent.Handle,
                "type": type_key,
                "layer": ent.Layer,
                "content": "DJ1" if type_key == "text" else "",
            }

        original_get_application = worker._get_bridge_application
        original_serialize_entity = worker._serialize_entity
        original_try_active_doc_name = worker._try_active_doc_name
        try:
            worker._get_bridge_application = fake_get_application
            worker._serialize_entity = fake_serialize_entity
            worker._try_active_doc_name = lambda: "fixture.dwg"

            result = worker._handle_entities_read_readable_index({})
        finally:
            worker._get_bridge_application = original_get_application
            worker._serialize_entity = original_serialize_entity
            worker._try_active_doc_name = original_try_active_doc_name

        self.assertEqual(result["count"], 3)
        self.assertEqual(serialized_object_names, [
            "AcDbText",
            "AcDbRotatedDimension",
            "AcDbBlockReference",
        ])
        self.assertEqual(result["doc_name"], "fixture.dwg")

        summary = result["summary"]
        self.assertEqual(summary["profile"], "readable-index-v1")
        self.assertEqual(summary["source_entity_count"], 5)
        self.assertEqual(summary["indexed_entity_count"], 3)
        self.assertEqual(summary["omitted_geometry_count"], 2)
        self.assertEqual(summary["by_type"]["line"], 1)
        self.assertEqual(summary["by_type"]["lwpolyline"], 1)
        self.assertEqual(summary["by_type"]["dimension"], 1)
        self.assertEqual(summary["by_layer"]["轴线"], 1)
        self.assertEqual(summary["omitted_by_type"]["line"], 1)
        self.assertEqual(summary["omitted_by_type"]["lwpolyline"], 1)


if __name__ == "__main__":
    unittest.main()
