from __future__ import annotations

from pathlib import Path

import pytest

from xiaoliang_cad_bridge.errors import BridgeError, RPC_E_CALL_REJECTED
from xiaoliang_cad_bridge.infrastructure.autocad import service as service_module
from xiaoliang_cad_bridge.infrastructure.autocad.service import AutoCadOperations


class ComError(Exception):
    def __init__(self, hresult: int) -> None:
        super().__init__(hresult)
        self.hresult = hresult


class FakeDocument:
    def __init__(self, name: str, *, saved: bool = True, dbmod: int = 0) -> None:
        self.Name = name
        self.FullName = name
        self.Saved = saved
        self._dbmod = dbmod

    def GetVariable(self, name: str) -> int:
        assert name == "DBMOD"
        return self._dbmod


class FakeDocuments:
    def __init__(self, documents: list[FakeDocument]) -> None:
        self._documents = documents

    @property
    def Count(self) -> int:
        return len(self._documents)

    def Item(self, index: int) -> FakeDocument:
        return self._documents[index]


class FakeApplication:
    Name = "AutoCAD"
    Caption = "Autodesk AutoCAD 2024"
    FullName = "acad.exe"
    Version = "24.3"
    Visible = True
    HWND = 1001

    def __init__(self, documents: list[FakeDocument] | None = None) -> None:
        self.Documents = FakeDocuments(documents or [])
        self.ActiveDocument = documents[0] if documents else None
        self.quit_called = False
        self.on_quit = lambda: None

    def Quit(self) -> None:
        self.quit_called = True
        self.on_quit()


class ZombieApplication:
    Name = "AutoCAD"
    Caption = "Autodesk AutoCAD 2024"
    FullName = "acad.exe"
    Version = "24.3"

    @property
    def Documents(self) -> object:
        raise ComError(RPC_E_CALL_REJECTED)


def not_running() -> object:
    raise ComError(-2147221021)


def test_restart_blocks_dirty_documents_without_force(tmp_path: Path) -> None:
    application = FakeApplication([
        FakeDocument("saved.dwg"),
        FakeDocument("dirty-a.dwg", saved=False),
        FakeDocument("dirty-b.dwg", dbmod=1),
    ])
    operations = AutoCadOperations(tmp_path, get_active_application=lambda: application)

    with pytest.raises(BridgeError) as caught:
        operations.execute("app.restart", {})

    assert caught.value.code == "CAD_RESTART_BLOCKED_UNSAVED"
    assert caught.value.status_code == 409
    assert caught.value.retryable is False
    assert caught.value.details == {"documents": ["dirty-a.dwg", "dirty-b.dwg"]}
    assert application.quit_called is False


def test_fresh_attach_caches_autocad_pid(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    application = FakeApplication()

    class FakeWin32Process:
        @staticmethod
        def GetWindowThreadProcessId(hwnd: int) -> tuple[int, int]:
            assert hwnd == 1001
            return 77, 4242

    monkeypatch.setattr(service_module, "win32process", FakeWin32Process)
    operations = AutoCadOperations(tmp_path, get_active_application=lambda: application)

    assert operations.execute("app.status", {})["running"] is True
    assert operations._application_pid == 4242


def test_restart_requires_force_when_document_state_is_unreadable(tmp_path: Path) -> None:
    zombie = ZombieApplication()
    operations = AutoCadOperations(tmp_path, get_active_application=lambda: zombie)

    with pytest.raises(BridgeError) as caught:
        operations.execute("app.restart", {})

    assert caught.value.code == "CAD_RESTART_NEEDS_FORCE"
    assert caught.value.status_code == 409
    assert caught.value.retryable is False


def test_restart_quits_clean_application_then_starts_a_fresh_one(tmp_path: Path) -> None:
    running = {"value": True}
    current = FakeApplication([FakeDocument("clean.dwg")])
    current.on_quit = lambda: running.__setitem__("value", False)
    replacement = FakeApplication()

    def get_active() -> object:
        if running["value"]:
            return current
        return not_running()

    operations = AutoCadOperations(
        tmp_path,
        get_active_application=get_active,
        create_application=lambda: replacement,
    )
    result = operations.execute("app.restart", {})

    assert current.quit_called is True
    assert operations.application is replacement
    assert result["running"] is True
    assert result["restarted"] is True
    assert result["forced"] is False
    assert result["quit_mode"] == "graceful"


def test_force_restart_kills_cached_pid_and_starts_a_fresh_application(tmp_path: Path) -> None:
    running = {"value": True}
    killed: list[int | None] = []
    zombie = ZombieApplication()
    replacement = FakeApplication()

    def get_active() -> object:
        if running["value"]:
            return zombie
        return not_running()

    def kill_process(pid: int | None) -> None:
        killed.append(pid)
        running["value"] = False

    operations = AutoCadOperations(
        tmp_path,
        get_active_application=get_active,
        create_application=lambda: replacement,
        kill_process=kill_process,
    )
    operations.application = zombie
    operations._application_pid = 4242

    result = operations.execute("app.restart", {"force": True})

    assert killed == [4242]
    assert operations.application is replacement
    assert result["running"] is True
    assert result["restarted"] is True
    assert result["forced"] is True
    assert result["quit_mode"] == "forced_pid"
