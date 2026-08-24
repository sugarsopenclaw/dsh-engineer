"""COM 连接管理：GetActiveObject("AutoCAD.Application")"""

from typing import Any, Optional

import pythoncom
import win32com.client


def get_application():
    """获取已运行的 AutoCAD.Application 实例。"""
    return win32com.client.GetActiveObject("AutoCAD.Application")


def get_active_document(acad):
    """当前活动文档；无则抛错。"""
    doc = acad.ActiveDocument
    if doc is None:
        raise RuntimeError("no active document")
    return doc


def reconnect() -> Any:
    """强制重新获取 Application（用于恢复连接）。"""
    return get_application()


def connection_status(acad) -> str:
    try:
        _ = acad.Name
        return "connected"
    except Exception:
        return "disconnected"


def com_initialize():
    pythoncom.CoInitialize()
