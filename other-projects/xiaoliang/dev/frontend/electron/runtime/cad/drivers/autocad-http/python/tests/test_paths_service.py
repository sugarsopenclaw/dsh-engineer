from __future__ import annotations

import hashlib
from pathlib import Path

import pytest

from xiaoliang_cad_bridge.errors import BridgeError, safe_error_details
from xiaoliang_cad_bridge.infrastructure.autocad.service import AutoCadOperations
from xiaoliang_cad_bridge.paths import drawing_artifact_directory, drawing_artifact_key, ensure_within_project


class FakeEntity:
    Handle = "A1"
    ObjectName = "AcDbDimension"
    Layer = "S-DIM"
    TextString = "200"
    Measurement = 200.0
    InsertionPoint = (5.0, 6.0, 0.0)

    @staticmethod
    def GetBoundingBox():
        return (0.0, 1.0, 0.0), (10.0, 11.0, 0.0)


class FakeDocument:
    Saved = True

    def __init__(self, file_path: Path) -> None:
        self.Name = file_path.name
        self.FullName = str(file_path)
        self.activated = False

    def Activate(self) -> None:
        self.activated = True

    @staticmethod
    def GetVariable(name: str) -> int:
        assert name == "DBMOD"
        return 0

    @staticmethod
    def HandleToObject(handle: str):
        if handle == "A1":
            return FakeEntity()
        raise KeyError(handle)


class FakeDocuments:
    def __init__(self, documents: list[FakeDocument]) -> None:
        self.documents = documents

    @property
    def Count(self) -> int:
        return len(self.documents)

    def Item(self, index: int) -> FakeDocument:
        return self.documents[index]

    def Open(self, file_path: str) -> FakeDocument:
        document = FakeDocument(Path(file_path))
        self.documents.append(document)
        return document


class FakeApplication:
    Name = "AutoCAD"
    Caption = "Autodesk AutoCAD 2024"
    FullName = "acad.exe"
    Version = "24.3"
    Visible = True

    def __init__(self, documents: list[FakeDocument]) -> None:
        self.Documents = FakeDocuments(documents)
        self.ActiveDocument = documents[0] if documents else None


def test_artifact_key_is_project_relative_and_uses_xiaoliang_root(tmp_path: Path) -> None:
    relative_path = "nested/sample.dwg"
    digest = hashlib.sha256(relative_path.encode()).hexdigest()[:12]
    assert drawing_artifact_key("sample.dwg", relative_path) == f"sample--{digest}"
    assert drawing_artifact_directory(tmp_path, "sample.dwg", relative_path) == (
        tmp_path / ".xiaoliang" / "cad" / "drawings" / f"sample--{digest}"
    )
    with pytest.raises(BridgeError):
        ensure_within_project(tmp_path, "../escape.dwg")
    details = safe_error_details({
        "documents": [r"C:\private\drawing.dwg"],
        "token": "token=must-not-escape",
    })
    assert "C:\\private" not in str(details)
    assert "must-not-escape" not in str(details)


def test_readonly_autocad_port_binds_paths_and_serializes_no_com_objects(tmp_path: Path) -> None:
    drawing = tmp_path / "结构" / "地下室.dwg"
    drawing.parent.mkdir()
    drawing.write_bytes(b"fixture")
    outside = FakeDocument(tmp_path.parent / "private-outside.dwg")
    inside = FakeDocument(drawing)
    application = FakeApplication([inside, outside])
    operations = AutoCadOperations(tmp_path, get_active_application=lambda: application)

    status = operations.execute("app.status", {})
    assert status["running"] is True
    assert status["documents"][0]["project_relative_path"] == "结构/地下室.dwg"
    assert status["documents"][1]["project_relative_path"] is None
    assert str(tmp_path.parent) not in str(status)

    doctor = operations.execute("app.doctor", {})
    assert doctor["application"] == status
    assert doctor["installation"].keys() == {"full_installed", "lt_installed", "com_registered"}
    assert doctor["plot"]["ready"] is False
    assert doctor["plot"]["dependencies"].keys() == {"pywin32", "pillow", "pdfium"}
    assert doctor["plot"]["configurations"] == {"pdf": False, "png": False}
    assert "PLOT_CONFIG_UNAVAILABLE" in doctor["plot"]["warnings"]

    extracted = operations.execute("extract.read", {"handles": ["a1", "FF"]})
    assert len(extracted["entities"]) == 1
    entity = extracted["entities"][0]
    assert entity["handle"] == "A1"
    assert entity["type"] == "dimension"
    assert entity["object_name"] == "AcDbDimension"
    assert entity["layer"] == "S-DIM"
    assert entity["measurement"] == 200
    assert entity["bbox"] == {"min": [0, 1], "max": [10, 11]}
    assert extracted["errors"] == [{"handle": "FF", "code": "ENTITY_READ_FAILED"}]

    with pytest.raises(BridgeError) as outside_error:
        operations.execute("doc.open", {"path": "../outside.dwg"})
    assert outside_error.value.code == "PATH_OUTSIDE_PROJECT"
    with pytest.raises(BridgeError) as unknown_error:
        operations.execute("doc.close", {})
    assert unknown_error.value.code == "OPERATION_NOT_FOUND"
