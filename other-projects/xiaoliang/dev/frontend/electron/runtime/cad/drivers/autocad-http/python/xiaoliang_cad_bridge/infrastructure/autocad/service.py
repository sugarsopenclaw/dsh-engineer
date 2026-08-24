"""AutoCAD read, extraction and deterministic capture operations.

COM application、document 与 entity 引用只保存在创建本类的 STA 线程中；
响应只包含 JSON 标量和集合，不返回 COM proxy。
"""

from __future__ import annotations

import hashlib
import json
import math
import os
import re
import subprocess
import time
import uuid
from collections.abc import Callable, Iterable, Mapping
from pathlib import Path

try:
    import winreg
except ModuleNotFoundError:
    winreg = None

try:
    import win32com.client
except ModuleNotFoundError:
    win32com = None

try:
    import win32process
except ModuleNotFoundError:
    win32process = None

from xiaoliang_cad_bridge.domain.geometry import detail_window, normalize_bbox, point2, quadrant_bbox
from xiaoliang_cad_bridge.errors import (
    RPC_E_CALL_REJECTED,
    BridgeError,
    error_hresult,
    raise_if_call_rejected,
)
from xiaoliang_cad_bridge.infrastructure.autocad.extract import ExtractFilters, extract_records, write_extraction
from xiaoliang_cad_bridge.infrastructure.autocad.frames import contains_frame_hint, detect_frames
from xiaoliang_cad_bridge.infrastructure.autocad.plot import (
    inspect_plot_environment,
    plot_window,
    variant_point,
)
from xiaoliang_cad_bridge.infrastructure.autocad.serializer import object_type, serialize_entity
from xiaoliang_cad_bridge.paths import (
    drawing_artifact_directory,
    ensure_within_project,
    preview_capture_directory,
    preview_detail_directory,
    project_relative,
    resolved_project_root,
    staging_artifact_directory,
)


NOT_RUNNING_HRESULTS = {-2147221021, -2147221005}
HANDLE_PATTERN = re.compile(r"^(?:0[xX])?[0-9A-Fa-f]{1,64}$")
PUBLIC_OPERATIONS = frozenset(
    {
        "app.status",
        "app.doctor",
        "app.start",
        "app.restart",
        "doc.list",
        "doc.open",
        "doc.switch",
        "extract.run",
        "extract.read",
        "capture.detect_frames",
        "capture.plot",
        "capture.detail",
    }
)


def as_mapping(value: object) -> Mapping[str, object]:
    if not isinstance(value, dict):
        raise BridgeError("INVALID_ARGUMENT", "params must be a JSON object")
    return value


def safe_attr(value: object, name: str, default: object = None) -> object:
    try:
        return getattr(value, name)
    except Exception as error:
        raise_if_call_rejected(error)
        return default


def collection_items(collection: object) -> Iterable[object]:
    if isinstance(collection, (list, tuple)):
        yield from collection
        return
    try:
        count = int(getattr(collection, "Count"))
    except Exception as error:
        raise_if_call_rejected(error)
        count = 0
    for index in range(count):
        try:
            yield collection.Item(index)
        except Exception as error:
            raise_if_call_rejected(error)


def optional_index(value: object) -> int | None:
    if value is None:
        return None
    if isinstance(value, bool) or not isinstance(value, int) or value < 0:
        raise BridgeError("INVALID_ARGUMENT", "document index must be a non-negative integer")
    return value


def optional_artifact_run_id(value: object) -> str | None:
    if value is None:
        return None
    if not isinstance(value, str):
        raise BridgeError("INVALID_ARGUMENT", "artifact_run_id must be a string")
    # staging_artifact_directory performs strict UUID validation.
    return value


def string_patterns(value: object, name: str) -> tuple[str, ...]:
    if value is None:
        return ()
    if (
        not isinstance(value, list)
        or len(value) > 100
        or not all(isinstance(item, str) and 0 < len(item) <= 512 for item in value)
    ):
        raise BridgeError("INVALID_ARGUMENT", f"{name} must be an array of bounded non-empty strings")
    return tuple(value)


def _registry_key_exists(root: object, key_path: str) -> bool:
    if winreg is None:
        return False
    views = [winreg.KEY_READ]
    for view_name in ("KEY_WOW64_64KEY", "KEY_WOW64_32KEY"):
        view = getattr(winreg, view_name, 0)
        if view:
            views.append(winreg.KEY_READ | view)
    for access in views:
        try:
            with winreg.OpenKey(root, key_path, 0, access):
                return True
        except OSError:
            continue
    return False


def autocad_installation_status() -> dict[str, bool | None]:
    """Return bounded registry facts; never expose installation paths or registry values."""
    if winreg is None:
        return {"full_installed": None, "lt_installed": None, "com_registered": None}
    full_installed = _registry_key_exists(winreg.HKEY_LOCAL_MACHINE, r"SOFTWARE\Autodesk\AutoCAD")
    lt_installed = _registry_key_exists(winreg.HKEY_LOCAL_MACHINE, r"SOFTWARE\Autodesk\AutoCAD LT")
    com_registered = _registry_key_exists(winreg.HKEY_CLASSES_ROOT, r"AutoCAD.Application\CLSID")
    return {
        "full_installed": full_installed,
        "lt_installed": lt_installed,
        "com_registered": com_registered,
    }


class AutoCadOperations:
    def __init__(
        self,
        project_root: str | os.PathLike[str],
        *,
        get_active_application: Callable[[], object | None] | None = None,
        create_application: Callable[[], object] | None = None,
        kill_process: Callable[[int | None], None] | None = None,
    ) -> None:
        self.project_root = resolved_project_root(project_root)
        self.application: object | None = None
        self._application_pid: int | None = None
        self._get_active_application = get_active_application
        self._create_application = create_application
        self._kill_process = kill_process or self._default_kill_process

    def execute(self, operation: str, params: dict[str, object]) -> dict[str, object]:
        if operation not in PUBLIC_OPERATIONS:
            raise BridgeError("OPERATION_NOT_FOUND", "Requested CAD operation is not available", status_code=404)
        handlers = {
            "app.status": self.app_status,
            "app.doctor": self.app_doctor,
            "app.start": self.app_start,
            "app.restart": self.app_restart,
            "doc.list": self.doc_list,
            "doc.open": self.doc_open,
            "doc.switch": self.doc_switch,
            "extract.run": self.extract_run,
            "extract.read": self.extract_read,
            "capture.detect_frames": self.capture_detect_frames,
            "capture.plot": self.capture_plot,
            "capture.detail": self.capture_detail,
        }
        return handlers[operation](as_mapping(params))

    @staticmethod
    def _require_com() -> None:
        if win32com is None:
            raise BridgeError("PYWIN32_UNAVAILABLE", "pywin32 is required for AutoCAD operations", status_code=503)

    def _default_get_active(self) -> object:
        self._require_com()
        return win32com.client.GetActiveObject("AutoCAD.Application")

    def _default_create(self) -> object:
        self._require_com()
        return win32com.client.Dispatch("AutoCAD.Application")

    @staticmethod
    def _default_kill_process(pid: int | None) -> None:
        command = (
            ["taskkill", "/PID", str(pid), "/F", "/T"]
            if pid is not None
            else ["taskkill", "/IM", "acad.exe", "/F"]
        )
        try:
            subprocess.run(
                command,
                check=True,
                stdin=subprocess.DEVNULL,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
                timeout=15,
            )
        except (OSError, subprocess.SubprocessError) as error:
            raise BridgeError(
                "CAD_RESTART_KILL_FAILED",
                "AutoCAD could not be terminated for restart",
                status_code=503,
                retryable=False,
            ) from error

    @staticmethod
    def _process_is_running(pid: int) -> bool:
        """Query a Windows process without sending it a signal."""
        if os.name != "nt":
            return False
        try:
            import ctypes
            from ctypes import wintypes

            synchronize = 0x00100000
            wait_timeout = 0x00000102
            kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
            kernel32.OpenProcess.argtypes = [wintypes.DWORD, wintypes.BOOL, wintypes.DWORD]
            kernel32.OpenProcess.restype = wintypes.HANDLE
            kernel32.WaitForSingleObject.argtypes = [wintypes.HANDLE, wintypes.DWORD]
            kernel32.WaitForSingleObject.restype = wintypes.DWORD
            kernel32.CloseHandle.argtypes = [wintypes.HANDLE]
            kernel32.CloseHandle.restype = wintypes.BOOL
            handle = kernel32.OpenProcess(synchronize, False, pid)
            if not handle:
                # ERROR_INVALID_PARAMETER is what OpenProcess reports after the
                # process is gone. Access denied or an unknown failure is not
                # proof of exit, so keep waiting instead of launching a duplicate.
                return ctypes.get_last_error() != 87
            try:
                return kernel32.WaitForSingleObject(handle, 0) == wait_timeout
            finally:
                kernel32.CloseHandle(handle)
        except Exception:
            # A failed bounded probe must not be interpreted as proof that it is safe
            # to launch a second AutoCAD process.
            return True

    def _cache_application_pid(self, application: object) -> None:
        self._application_pid = None
        if win32process is None:
            return
        try:
            hwnd = int(getattr(application, "HWND"))
            _thread_id, pid = win32process.GetWindowThreadProcessId(hwnd)
            if isinstance(pid, int) and pid > 0:
                self._application_pid = pid
        except Exception:
            # PID is a recovery aid. Failure to obtain it must not break normal reads;
            # an explicit force restart can still use the bounded acad.exe fallback.
            self._application_pid = None

    def _clear_application(self) -> None:
        self.application = None
        self._application_pid = None

    def _attach(self) -> object | None:
        if self.application is not None:
            try:
                _ = self.application.Version
                return self.application
            except Exception as error:
                raise_if_call_rejected(error)
                self._clear_application()
        try:
            application = (self._get_active_application or self._default_get_active)()
        except Exception as error:
            if error_hresult(error) in NOT_RUNNING_HRESULTS:
                self._clear_application()
                return None
            raise
        self.application = application
        self._cache_application_pid(application)
        return application

    def _require_application(self) -> object:
        application = self._attach()
        if application is None:
            raise BridgeError("CAD_NOT_RUNNING", "AutoCAD is not running", status_code=503, retryable=True)
        self._assert_supported(application)
        return application

    @staticmethod
    def _assert_supported(application: object) -> None:
        identity = " ".join(
            str(safe_attr(application, name, "") or "") for name in ("Name", "Caption", "FullName")
        ).casefold()
        if "autocad lt" in identity or "acadlt" in identity:
            raise BridgeError("UNSUPPORTED_LT", "AutoCAD LT does not expose the required COM automation surface")

    @staticmethod
    def _documents(application: object) -> list[object]:
        return list(collection_items(application.Documents))

    @staticmethod
    def _same_document(left: object | None, right: object | None) -> bool:
        if left is None or right is None:
            return False
        if left is right:
            return True
        left_dispatch = safe_attr(left, "_oleobj_")
        right_dispatch = safe_attr(right, "_oleobj_")
        return left_dispatch is not None and right_dispatch is not None and left_dispatch == right_dispatch

    @staticmethod
    def _document_saved(document: object) -> bool:
        return bool(safe_attr(document, "Saved", True))

    @staticmethod
    def _document_dbmod(document: object) -> int | None:
        try:
            return int(document.GetVariable("DBMOD"))
        except AttributeError:
            return None
        except Exception as error:
            raise_if_call_rejected(error)
            return None

    def _document_info(self, document: object, index: int, active: object | None) -> dict[str, object]:
        name = str(safe_attr(document, "Name", "") or "")[:512]
        full_name = str(safe_attr(document, "FullName", "") or "")
        relative_path: str | None = None
        if full_name:
            try:
                relative_path = project_relative(self.project_root, full_name)
            except BridgeError:
                pass
        return {
            "index": index,
            "name": name or Path(full_name).name[:512],
            "project_relative_path": relative_path,
            "active": self._same_document(document, active),
            "saved": self._document_saved(document),
            "dbmod": self._document_dbmod(document),
        }
    def _select_document(
        self,
        application: object,
        params: Mapping[str, object],
        *,
        active_default: bool = True,
    ) -> object:
        name = params.get("name")
        index = optional_index(params.get("index"))
        documents = self._documents(application)
        if name is not None and (not isinstance(name, str) or not name.strip() or len(name) > 512):
            raise BridgeError("INVALID_ARGUMENT", "document name must be a non-empty bounded string")
        if name is not None and index is not None:
            raise BridgeError("INVALID_ARGUMENT", "select a document by name or index, not both")
        if index is not None:
            if index >= len(documents):
                raise BridgeError("DOCUMENT_NOT_FOUND", "document index was not found", status_code=404)
            return documents[index]
        if isinstance(name, str):
            requested = name.casefold()
            for document in documents:
                document_name = str(safe_attr(document, "Name", "") or "")
                full_name = str(safe_attr(document, "FullName", "") or "")
                if requested in {document_name.casefold(), Path(full_name).name.casefold()}:
                    return document
            raise BridgeError("DOCUMENT_NOT_FOUND", "Requested document was not found", status_code=404)
        if active_default:
            active = safe_attr(application, "ActiveDocument")
            if active is not None:
                return active
            raise BridgeError("NO_ACTIVE_DOCUMENT", "AutoCAD has no active document", status_code=409)
        raise BridgeError("INVALID_ARGUMENT", "document name or index is required")

    def app_status(self, _params: Mapping[str, object]) -> dict[str, object]:
        application = self._attach()
        if application is None:
            return {"running": False, "supported": True, "document_count": 0, "documents": []}
        self._assert_supported(application)
        documents = self._documents(application)
        active = safe_attr(application, "ActiveDocument")
        return {
            "running": True,
            "supported": True,
            "visible": bool(safe_attr(application, "Visible", False)),
            "version": str(safe_attr(application, "Version", "") or "")[:128],
            "document_count": len(documents),
            "documents": [self._document_info(document, index, active) for index, document in enumerate(documents)],
        }

    def app_doctor(self, _params: Mapping[str, object]) -> dict[str, object]:
        """Return bounded connection and plot readiness without mutating app/document state."""
        application_status = self.app_status({})
        application = self.application if application_status["running"] else None
        return {
            "application": application_status,
            "installation": autocad_installation_status(),
            "plot": inspect_plot_environment(application),
        }

    @staticmethod
    def _start_timeout_seconds(params: Mapping[str, object]) -> float:
        timeout_value = params.get("timeout_seconds", 60)
        if isinstance(timeout_value, bool) or not isinstance(timeout_value, (int, float)):
            raise BridgeError("INVALID_ARGUMENT", "timeout_seconds must be a number")
        if not math.isfinite(float(timeout_value)):
            raise BridgeError("INVALID_ARGUMENT", "timeout_seconds must be finite")
        return max(1.0, min(float(timeout_value), 60.0))

    def app_start(self, params: Mapping[str, object]) -> dict[str, object]:
        timeout_seconds = self._start_timeout_seconds(params)
        application = self._attach()
        attached = application is not None
        if application is None:
            application = (self._create_application or self._default_create)()
            self.application = application
        try:
            application.Visible = True
        except Exception as error:
            raise_if_call_rejected(error)
        deadline = time.monotonic() + timeout_seconds
        while True:
            try:
                self._assert_supported(application)
                _ = application.Version
                _ = application.Documents
                break
            except BridgeError:
                raise
            except Exception as error:
                raise_if_call_rejected(error)
                if time.monotonic() >= deadline:
                    raise BridgeError(
                        "CAD_START_TIMEOUT",
                        "AutoCAD did not become ready before its deadline",
                        status_code=504,
                        retryable=True,
                    ) from None
                time.sleep(0.5)
        self._cache_application_pid(application)
        return {**self.app_status({}), "attached": attached}

    @staticmethod
    def _dirty_document_names(application: object) -> list[str]:
        dirty: list[str] = []
        for document in AutoCadOperations._documents(application):
            try:
                saved = bool(document.Saved)
                dbmod = int(document.GetVariable("DBMOD"))
            except Exception as error:
                raise_if_call_rejected(error)
                raise
            if saved and dbmod == 0:
                continue
            name = str(safe_attr(document, "Name", "") or "")[:512]
            dirty.append(name or "unnamed drawing")
        return dirty

    def _wait_for_application_exit(self, pid: int | None, timeout_seconds: float = 10.0) -> bool:
        deadline = time.monotonic() + timeout_seconds
        while True:
            if pid is not None:
                running = self._process_is_running(pid)
            else:
                try:
                    running = (self._get_active_application or self._default_get_active)() is not None
                except Exception as error:
                    hresult = error_hresult(error)
                    if hresult in NOT_RUNNING_HRESULTS:
                        running = False
                    elif hresult == RPC_E_CALL_REJECTED:
                        running = True
                    else:
                        raise
            if not running:
                return True
            if time.monotonic() >= deadline:
                return False
            time.sleep(0.25)

    @staticmethod
    def _restart_needs_force() -> BridgeError:
        return BridgeError(
            "CAD_RESTART_NEEDS_FORCE",
            "AutoCAD document state is unavailable; restart requires force=true to avoid silently losing work",
            status_code=409,
            retryable=False,
        )

    def app_restart(self, params: Mapping[str, object]) -> dict[str, object]:
        force = params.get("force", False)
        if not isinstance(force, bool):
            raise BridgeError("INVALID_ARGUMENT", "force must be a boolean")
        timeout_seconds = self._start_timeout_seconds(params)

        application: object | None = None
        state_readable = True
        try:
            application = self._attach()
        except Exception:
            state_readable = False

        dirty_documents: list[str] = []
        if application is not None and state_readable:
            try:
                dirty_documents = self._dirty_document_names(application)
            except Exception:
                state_readable = False

        if not state_readable and not force:
            raise self._restart_needs_force()
        if dirty_documents and not force:
            visible_names = ", ".join(dirty_documents[:10])
            if len(dirty_documents) > 10:
                visible_names += f", and {len(dirty_documents) - 10} more"
            raise BridgeError(
                "CAD_RESTART_BLOCKED_UNSAVED",
                f"AutoCAD restart was blocked because drawings have unsaved changes: {visible_names}",
                status_code=409,
                retryable=False,
                details={"documents": dirty_documents[:64]},
            )

        forced = False
        quit_mode = "not_running"
        previous_pid = self._application_pid
        if application is not None or not state_readable:
            if force:
                self._kill_process(previous_pid)
                forced = True
                quit_mode = "forced_pid" if previous_pid is not None else "forced_image"
                self._clear_application()
            else:
                try:
                    application.Quit()
                except Exception as error:
                    if error_hresult(error) == RPC_E_CALL_REJECTED:
                        raise self._restart_needs_force() from error
                    raise BridgeError(
                        "CAD_RESTART_QUIT_FAILED",
                        "AutoCAD did not accept the graceful restart request",
                        status_code=503,
                        retryable=False,
                    ) from error
                self._clear_application()
                quit_mode = "graceful"
                if not self._wait_for_application_exit(previous_pid):
                    raise BridgeError(
                        "CAD_RESTART_TIMEOUT",
                        "AutoCAD did not exit before the restart deadline",
                        status_code=504,
                        retryable=False,
                    )

        self.app_start({"timeout_seconds": timeout_seconds})
        return {
            **self.app_status({}),
            "restarted": True,
            "forced": forced,
            "quit_mode": quit_mode,
        }

    def doc_list(self, _params: Mapping[str, object]) -> dict[str, object]:
        application = self._require_application()
        documents = self._documents(application)
        active = safe_attr(application, "ActiveDocument")
        return {
            "documents": [self._document_info(document, index, active) for index, document in enumerate(documents)]
        }

    def doc_open(self, params: Mapping[str, object]) -> dict[str, object]:
        application = self._require_application()
        raw_path = params.get("path")
        if not isinstance(raw_path, str) or not raw_path.strip() or len(raw_path) > 4096:
            raise BridgeError("INVALID_ARGUMENT", "path is required")
        drawing_path = ensure_within_project(self.project_root, raw_path, must_exist=True)
        if not drawing_path.is_file() or drawing_path.suffix.casefold() != ".dwg":
            raise BridgeError("INVALID_ARGUMENT", "path must identify a DWG file inside the project")
        documents = self._documents(application)
        requested = os.path.normcase(os.path.realpath(drawing_path))
        for index, existing in enumerate(documents):
            full_name = str(safe_attr(existing, "FullName", "") or "")
            if full_name and os.path.normcase(os.path.realpath(full_name)) == requested:
                existing.Activate()
                return {"document": self._document_info(existing, index, existing), "reused": True}
        document = application.Documents.Open(str(drawing_path))
        current_documents = self._documents(application)
        return {
            "document": self._document_info(document, max(0, len(current_documents) - 1), document),
            "reused": False,
        }

    def doc_switch(self, params: Mapping[str, object]) -> dict[str, object]:
        application = self._require_application()
        document = self._select_document(application, params, active_default=False)
        document.Activate()
        documents = self._documents(application)
        index = next((position for position, item in enumerate(documents) if self._same_document(item, document)), 0)
        return {"document": self._document_info(document, index, document)}

    @staticmethod
    def _normalize_handles(value: object, *, maximum: int = 100) -> list[str]:
        if not isinstance(value, list) or not 1 <= len(value) <= maximum:
            raise BridgeError("INVALID_ARGUMENT", f"handles must contain between 1 and {maximum} items")
        handles: list[str] = []
        for item in value:
            if not isinstance(item, str) or not HANDLE_PATTERN.fullmatch(item):
                raise BridgeError("INVALID_ARGUMENT", "handle must be hexadecimal")
            normalized = item.removeprefix("0x").removeprefix("0X").upper()
            if normalized not in handles:
                handles.append(normalized)
        return handles

    @staticmethod
    def _document_extents(document: object) -> dict[str, list[float]] | None:
        try:
            minimum = point2(document.GetVariable("EXTMIN"))
            maximum = point2(document.GetVariable("EXTMAX"))
        except Exception as error:
            raise_if_call_rejected(error)
            return None
        return normalize_bbox({"min": minimum, "max": maximum})

    def _window_entities(self, document: object, window: object) -> Iterable[object]:
        if window is None:
            yield from collection_items(document.ModelSpace)
            return
        bbox = normalize_bbox(window)
        if bbox is None:
            raise BridgeError("INVALID_ARGUMENT", "window must contain non-empty min/max coordinates")
        selection_name = f"XIAOLIANG_CAD_{uuid.uuid4().hex[:12]}"
        try:
            selection = document.SelectionSets.Add(selection_name)
        except Exception as error:
            raise_if_call_rejected(error)
            raise BridgeError("SELECTION_CREATE_FAILED", "AutoCAD could not create a temporary selection") from error
        try:
            minimum = variant_point((bbox["min"][0], bbox["min"][1], 0.0))
            maximum = variant_point((bbox["max"][0], bbox["max"][1], 0.0))
            selection.Select(0, minimum, maximum)
            yield from collection_items(selection)
        finally:
            try:
                selection.Delete()
            except Exception as error:
                raise_if_call_rejected(error)

    def _drawing_data(self, document: object) -> dict[str, object]:
        name = str(safe_attr(document, "Name", "") or "drawing.dwg")[:512]
        full_name = str(safe_attr(document, "FullName", "") or "")
        relative_path: str | None = None
        if full_name:
            try:
                relative_path = project_relative(self.project_root, full_name)
            except BridgeError:
                pass
        return {
            "name": name,
            "project_relative_path": relative_path,
            "saved": self._document_saved(document),
            "dbmod": self._document_dbmod(document),
        }

    def extract_run(self, params: Mapping[str, object]) -> dict[str, object]:
        application = self._require_application()
        document = self._select_document(application, as_mapping(params.get("document", {})))
        text_pattern = params.get("text_pattern")
        if text_pattern is not None and (not isinstance(text_pattern, str) or len(text_pattern) > 2_048):
            raise BridgeError("INVALID_ARGUMENT", "text_pattern must be a string no longer than 2048 characters")
        include_geometry = params.get("include_geometry", False)
        if not isinstance(include_geometry, bool):
            raise BridgeError("INVALID_ARGUMENT", "include_geometry must be a boolean")
        filters = ExtractFilters(
            layers=string_patterns(params.get("layers"), "layers"),
            types=string_patterns(params.get("types"), "types"),
            text_pattern=text_pattern,
            include_geometry=include_geometry,
        )
        extracted = extract_records(self._window_entities(document, params.get("window")), filters)
        drawing = self._drawing_data(document)
        drawing_relative_path = drawing["project_relative_path"]
        if not isinstance(drawing_relative_path, str):
            raise BridgeError(
                "PATH_OUTSIDE_PROJECT",
                "The selected drawing must be saved inside the trusted project before extraction",
            )
        artifact_run_id = optional_artifact_run_id(params.get("artifact_run_id"))
        output_directory = (
            staging_artifact_directory(self.project_root, artifact_run_id, "entities")
            if artifact_run_id
            else drawing_artifact_directory(
                self.project_root,
                str(drawing["name"]),
                drawing_relative_path,
            )
            / "entities"
        )
        written = write_extraction(
            self.project_root,
            str(drawing["name"]),
            extracted,
            drawing_relative_path=drawing_relative_path,
            output_directory=output_directory,
        )
        return {"drawing": drawing, "summary": written, "warnings": extracted.warnings}

    def extract_read(self, params: Mapping[str, object]) -> dict[str, object]:
        application = self._require_application()
        document = self._select_document(application, as_mapping(params.get("document", {})))
        handles = self._normalize_handles(params.get("handles"))
        entities: list[dict[str, object]] = []
        failures: list[dict[str, object]] = []
        warnings: list[str] = []
        for handle in handles:
            try:
                entity = document.HandleToObject(handle)
                entities.append(serialize_entity(entity, include_geometry=True))
            except Exception as error:
                raise_if_call_rejected(error)
                failures.append({"handle": handle, "code": "ENTITY_READ_FAILED"})
                warnings.append(f"handle {handle} could not be read: {type(error).__name__}")
        documents = self._documents(application)
        index = next((position for position, item in enumerate(documents) if self._same_document(item, document)), 0)
        return {
            "document": self._document_info(document, index, safe_attr(application, "ActiveDocument")),
            "entities": entities,
            "errors": failures,
            "warnings": warnings,
        }

    def _frame_records(self, document: object) -> tuple[list[dict[str, object]], list[str]]:
        records: list[dict[str, object]] = []
        warnings: list[str] = []
        for index, entity in enumerate(collection_items(document.ModelSpace), 1):
            try:
                _object_name, type_name = object_type(entity)
                layer = str(safe_attr(entity, "Layer", "") or "")
                if type_name not in {"lwpolyline", "block_reference"} and not contains_frame_hint(layer):
                    continue
                record = serialize_entity(entity, include_geometry=True)
                if record.get("visible", True) and str(record.get("layer", "")).casefold() != "defpoints":
                    records.append(record)
            except Exception as error:
                raise_if_call_rejected(error)
                warnings.append(f"frame candidate {index} could not be read: {type(error).__name__}")
        return records, warnings[:200]

    def capture_detect_frames(self, params: Mapping[str, object]) -> dict[str, object]:
        application = self._require_application()
        document = self._select_document(application, as_mapping(params.get("document", {})))
        records, warnings = self._frame_records(document)
        extents = self._document_extents(document)
        frames = detect_frames(records, extents)
        if not frames:
            raise BridgeError(
                "NO_DRAWING_EXTENTS",
                "No frame candidate or usable drawing extents were found",
                status_code=422,
            )
        return {
            "drawing": self._drawing_data(document),
            "frames": frames,
            # Callers sanity-check a candidate frame against the drawing extents before they
            # index it, and fall back to the extents when the candidate is clearly not a sheet.
            "extents": extents,
            "warnings": warnings,
        }

    def capture_plot(self, params: Mapping[str, object]) -> dict[str, object]:
        application = self._require_application()
        document_selector = as_mapping(params.get("document", {}))
        document = self._select_document(application, document_selector)
        raw_bbox = params.get("bbox")
        frame_id = params.get("frame_id")
        if frame_id is not None and (
            not isinstance(frame_id, str) or re.fullmatch(r"frame-(?:[0-9]{2}|custom)", frame_id) is None
        ):
            raise BridgeError("INVALID_ARGUMENT", "frame_id must be a detected frame identifier")
        if raw_bbox is None:
            detected = self.capture_detect_frames({"document": dict(document_selector)})["frames"]
            assert isinstance(detected, list)
            selected = next(
                (
                    frame
                    for frame in detected
                    if isinstance(frame, dict) and frame.get("frame_id") == (frame_id or "frame-01")
                ),
                None,
            )
            if selected is None:
                raise BridgeError("FRAME_NOT_FOUND", "frame_id was not found", status_code=404)
            raw_bbox = selected["bbox"]
            frame_id = str(selected["frame_id"])
        else:
            frame_id = frame_id or "frame-custom"
        bbox = normalize_bbox(raw_bbox)
        if bbox is None:
            raise BridgeError("INVALID_ARGUMENT", "bbox must contain non-empty min/max coordinates")
        quadrant = params.get("quadrant")
        if quadrant is not None and not isinstance(quadrant, str):
            raise BridgeError("INVALID_ARGUMENT", "quadrant must be a string")
        try:
            plotted_bbox = quadrant_bbox(bbox, quadrant)
        except ValueError as error:
            raise BridgeError("INVALID_ARGUMENT", str(error)) from None
        drawing = self._drawing_data(document)
        drawing_relative_path = drawing["project_relative_path"]
        if not isinstance(drawing_relative_path, str):
            raise BridgeError(
                "PATH_OUTSIDE_PROJECT",
                "The selected drawing must be saved inside the trusted project before plotting",
            )
        artifact_run_id = optional_artifact_run_id(params.get("artifact_run_id"))
        capture_directory = (
            staging_artifact_directory(self.project_root, artifact_run_id, "visual") / "captures" / frame_id
            if artifact_run_id
            else preview_capture_directory(
                self.project_root,
                str(drawing["name"]),
                drawing_relative_path,
                frame_id,
            )
        )
        filename = "full.png" if not quadrant else f"{quadrant.casefold().replace('/', '-')}.png"
        output = ensure_within_project(self.project_root, capture_directory / filename)
        result = plot_window(application, document, plotted_bbox, output)
        return {
            "drawing": drawing,
            "frame_id": frame_id,
            "quadrant": quadrant.casefold() if isinstance(quadrant, str) else None,
            "bbox": plotted_bbox,
            "image_path": project_relative(self.project_root, output),
            **result,
        }

    def capture_detail(self, params: Mapping[str, object]) -> dict[str, object]:
        raw_handles = params.get("handles")
        raw_window = params.get("window")
        if raw_handles is None and raw_window is None:
            raise BridgeError("INVALID_ARGUMENT", "capture.detail requires handles or window")
        handles = [] if raw_handles is None else self._normalize_handles(raw_handles, maximum=8)
        explicit_window: dict[str, list[float]] | None = None
        if raw_window is not None:
            if not isinstance(raw_window, dict):
                raise BridgeError("INVALID_ARGUMENT", "window must contain finite min/max coordinates")
            first = point2(raw_window.get("min"))
            second = point2(raw_window.get("max"))
            if first is None or second is None:
                raise BridgeError("INVALID_ARGUMENT", "window must contain finite min/max coordinates")
            explicit_window = {
                "min": [min(first[0], second[0]), min(first[1], second[1])],
                "max": [max(first[0], second[0]), max(first[1], second[1])],
            }
        raw_padding_ratio = params.get("padding_ratio", 0.15)
        if (
            isinstance(raw_padding_ratio, bool)
            or not isinstance(raw_padding_ratio, (int, float))
            or not math.isfinite(float(raw_padding_ratio))
            or not 0 <= float(raw_padding_ratio) <= 0.5
        ):
            raise BridgeError("INVALID_ARGUMENT", "padding_ratio must be a number between 0 and 0.5")
        padding_ratio = float(raw_padding_ratio)

        application = self._require_application()
        document = self._select_document(application, as_mapping(params.get("document", {})))
        anchors: list[dict[str, object]] = []
        missing_handles: list[str] = []
        warnings: list[str] = []
        for handle in handles:
            try:
                minimum, maximum = document.HandleToObject(handle).GetBoundingBox()
                first = point2(minimum)
                second = point2(maximum)
                if first is None or second is None:
                    raise ValueError("invalid bounding box")
                bbox = {
                    "min": [min(first[0], second[0]), min(first[1], second[1])],
                    "max": [max(first[0], second[0]), max(first[1], second[1])],
                }
                anchors.append({"handle": handle, "bbox": bbox})
            except Exception as error:
                raise_if_call_rejected(error)
                missing_handles.append(handle)
                warnings.append(f"handle {handle} bbox could not be read: {type(error).__name__}")
        if not anchors and explicit_window is None:
            raise BridgeError(
                "ENTITY_NOT_FOUND",
                "No usable detail anchor could be resolved",
                status_code=404,
                details={"missing_handles": missing_handles},
            )
        try:
            plotted_window = detail_window(
                [anchor["bbox"] for anchor in anchors],
                explicit_window,
                padding_ratio,
            )
        except ValueError as error:
            raise BridgeError("INVALID_ARGUMENT", str(error)) from None

        drawing = self._drawing_data(document)
        drawing_relative_path = drawing["project_relative_path"]
        if not isinstance(drawing_relative_path, str):
            raise BridgeError(
                "PATH_OUTSIDE_PROJECT",
                "The selected drawing must be saved inside the trusted project before plotting",
            )
        parameter_summary = {
            "handles": handles,
            "padding_ratio": padding_ratio,
            "window": explicit_window,
        }
        digest = hashlib.sha256(
            json.dumps(parameter_summary, ensure_ascii=False, separators=(",", ":"), sort_keys=True).encode("utf-8")
        ).hexdigest()[:10]
        artifact_run_id = optional_artifact_run_id(params.get("artifact_run_id"))
        detail_directory = (
            staging_artifact_directory(self.project_root, artifact_run_id, "visual") / "details"
            if artifact_run_id
            else preview_detail_directory(
                self.project_root,
                str(drawing["name"]),
                drawing_relative_path,
            )
        )
        output = ensure_within_project(self.project_root, detail_directory / f"detail-{digest}.png")
        result = plot_window(application, document, plotted_window, output)
        plot_warnings = result.get("warnings", [])
        return {
            "drawing": drawing,
            "window": plotted_window,
            "anchors": anchors,
            "missing_handles": missing_handles,
            "image_path": project_relative(self.project_root, output),
            **{key: value for key, value in result.items() if key != "warnings"},
            "warnings": [*warnings, *(plot_warnings if isinstance(plot_warnings, list) else [])],
        }
