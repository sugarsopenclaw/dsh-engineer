#!/usr/bin/env python3
"""
BillNova CAD Bridge — stdin/stdout JSON-RPC 2.0，COM 控制 AutoCAD。
启动：CoInitialize → 输出 ready\\n → 逐行处理 JSON-RPC。
"""

from __future__ import annotations

import json
import sys
import traceback
from typing import Any, Callable, Dict

from cad_connection import com_initialize, get_application

from modules import annotate as annotate_mod
from modules import block as block_mod
from modules import composite as composite_mod
from modules import doc as doc_mod
from modules import entity as entity_mod
from modules import entity_extended as entity_x
from modules import geometry as geometry_mod
from modules import layer as layer_mod
from modules import layout as layout_mod
from modules import selection as selection_mod
from modules import utility as utility_mod
from modules import view as view_mod


class JsonRpcError(Exception):
    def __init__(self, code: int, message: str, data: Any = None):
        self.code = code
        self.message = message
        self.data = data


def _rpc_server_ping(_acad, _params) -> Dict[str, Any]:
    return {"ok": True}


def _rpc_server_info(acad, _params) -> Dict[str, Any]:
    try:
        ver = str(acad.Version)
    except Exception:
        ver = ""
    return {
        "autocad_version": ver,
        "python_version": sys.version.split()[0],
        "connection": "connected",
    }


Handler = Callable[[Any, Any], Any]

HANDLERS: Dict[str, Handler] = {
    "server.ping": _rpc_server_ping,
    "server.info": _rpc_server_info,
    "doc.active": doc_mod.rpc_doc_active,
    "doc.open": doc_mod.rpc_doc_open,
    "doc.send_command": doc_mod.rpc_doc_send_command,
    "doc.list": doc_mod.rpc_doc_list,
    "doc.close": doc_mod.rpc_doc_close,
    "doc.switch": doc_mod.rpc_doc_switch,
    "doc.get_variable": doc_mod.rpc_doc_get_variable,
    "doc.save": doc_mod.rpc_doc_save,
    "doc.set_variable": doc_mod.rpc_doc_set_variable,
    "doc.purge": doc_mod.rpc_doc_purge,
    "doc.new": doc_mod.rpc_doc_new,
    "doc.import_file": doc_mod.rpc_doc_import_file,
    "doc.export_file": doc_mod.rpc_doc_export_file,
    "doc.text_styles": doc_mod.rpc_doc_text_styles,
    "doc.dim_styles": doc_mod.rpc_doc_dim_styles,
    "doc.linetypes": doc_mod.rpc_doc_linetypes,
    "doc.plot_to_pdf": doc_mod.rpc_doc_plot_to_pdf,
    "entity.read_all": entity_mod.rpc_entity_read_all,
    "entity.read_by_handle": entity_mod.rpc_entity_read_by_handle,
    "entity.read_by_handles": entity_mod.rpc_entity_read_by_handles,
    "entity.read_by_window": entity_mod.rpc_entity_read_by_window,
    "entity.read_by_crossing": entity_mod.rpc_entity_read_by_crossing,
    "entity.read_by_polygon": entity_x.rpc_entity_read_by_polygon,
    "entity.read_by_filter": entity_x.rpc_entity_read_by_filter,
    "entity.create": entity_x.rpc_entity_create,
    "entity.modify": entity_x.rpc_entity_modify,
    "entity.delete": entity_x.rpc_entity_delete,
    "entity.copy": entity_x.rpc_entity_copy,
    "entity.move": entity_x.rpc_entity_move,
    "entity.intersect_with": entity_x.rpc_entity_intersect_with,
    "entity.set_xdata": entity_x.rpc_entity_set_xdata,
    "entity.get_xdata": entity_x.rpc_entity_get_xdata,
    "entity.offset": entity_x.rpc_entity_offset,
    "entity.mirror": entity_x.rpc_entity_mirror,
    "entity.rotate": entity_x.rpc_entity_rotate,
    "entity.scale": entity_x.rpc_entity_scale,
    "entity.explode": entity_x.rpc_entity_explode,
    "entity.array_rect": entity_x.rpc_entity_array_rect,
    "entity.array_polar": entity_x.rpc_entity_array_polar,
    "entity.highlight": entity_x.rpc_entity_highlight,
    "entity.color_detail": entity_x.rpc_entity_color_detail,
    "entity.count": entity_mod.rpc_entity_count,
    "entity.get_extents": entity_mod.rpc_entity_get_extents,
    "entity.extract_selection": entity_mod.rpc_entity_extract_selection,
    "entity.select_by_handle": entity_mod.rpc_entity_select_by_handle,
    "entity.clear_selection": entity_mod.rpc_entity_clear_selection,
    "layer.list": layer_mod.rpc_layer_list,
    "layer.on": layer_mod.rpc_layer_on,
    "layer.off": layer_mod.rpc_layer_off,
    "layer.freeze": layer_mod.rpc_layer_freeze,
    "layer.thaw": layer_mod.rpc_layer_thaw,
    "layer.create": layer_mod.rpc_layer_create,
    "layer.lock": layer_mod.rpc_layer_lock,
    "layer.unlock": layer_mod.rpc_layer_unlock,
    "layer.isolate": layer_mod.rpc_layer_isolate,
    "layer.restore": layer_mod.rpc_layer_restore,
    "view.zoom_window": view_mod.rpc_view_zoom_window,
    "view.zoom_extents": view_mod.rpc_view_zoom_extents,
    "view.zoom_center": view_mod.rpc_view_zoom_center,
    "view.zoom_object": view_mod.rpc_view_zoom_object,
    "view.pan": view_mod.rpc_view_pan,
    "view.get_current": view_mod.rpc_view_get_current,
    "view.screenshot": view_mod.rpc_view_screenshot,
    "view.screenshot_region": view_mod.rpc_view_screenshot_region,
    "view.plot_region": view_mod.rpc_view_plot_region,
    "view.ensure_model_space": view_mod.rpc_view_ensure_model_space,
    "view.regen": view_mod.rpc_view_regen,
    "geometry.distance_pp": geometry_mod.rpc_geometry_distance_pp,
    "geometry.area": geometry_mod.rpc_geometry_area,
    "geometry.length": geometry_mod.rpc_geometry_length,
    "geometry.bounding_box": geometry_mod.rpc_geometry_bounding_box,
    "geometry.distance_pl": geometry_mod.rpc_geometry_distance_pl,
    "geometry.distance_entities": geometry_mod.rpc_geometry_distance_entities,
    "geometry.area_composite": geometry_mod.rpc_geometry_area_composite,
    "geometry.centroid": geometry_mod.rpc_geometry_centroid,
    "geometry.point_inside": geometry_mod.rpc_geometry_point_inside,
    "geometry.intersection": geometry_mod.rpc_geometry_intersection,
    "geometry.offset_curve": geometry_mod.rpc_geometry_offset_curve,
    "selection.nearby": selection_mod.rpc_selection_nearby,
    "selection.nearest": selection_mod.rpc_selection_nearest,
    "selection.touching": selection_mod.rpc_selection_touching,
    "selection.inside": selection_mod.rpc_selection_inside,
    "selection.between": selection_mod.rpc_selection_between,
    "selection.along": selection_mod.rpc_selection_along,
    "selection.by_dxf_filter": selection_mod.rpc_selection_by_dxf_filter,
    "block.list": block_mod.rpc_block_list,
    "block.get_references": block_mod.rpc_block_get_references,
    "block.read_attributes": block_mod.rpc_block_read_attributes,
    "block.get_definition": block_mod.rpc_block_get_definition,
    "block.explode": block_mod.rpc_block_explode,
    "annotate.read_all_text": annotate_mod.rpc_annotate_read_all_text,
    "annotate.read_all_dims": annotate_mod.rpc_annotate_read_all_dims,
    "annotate.read_all_tables": annotate_mod.rpc_annotate_read_all_tables,
    "annotate.find_text": annotate_mod.rpc_annotate_find_text,
    "annotate.find_text_plus": annotate_mod.rpc_annotate_find_text_plus,
    "annotate.read_all_leaders": annotate_mod.rpc_annotate_read_all_leaders,
    "annotate.create_text": annotate_mod.rpc_annotate_create_text,
    "composite.scan_drawing": composite_mod.rpc_composite_scan_drawing,
    "composite.region_extract": composite_mod.rpc_composite_region_extract,
    "composite.batch_read": composite_mod.rpc_composite_batch_read,
    "composite.layer_isolate_extract": composite_mod.rpc_composite_layer_isolate_extract,
    "utility.prompt": utility_mod.rpc_utility_prompt,
    "utility.translate_coords": utility_mod.rpc_utility_translate_coords,
    "utility.polar_point": utility_mod.rpc_utility_polar_point,
    "utility.angle_from_x": utility_mod.rpc_utility_angle_from_x,
    "utility.distance": utility_mod.rpc_utility_distance,
    "layout.list": layout_mod.rpc_layout_list,
    "layout.switch": layout_mod.rpc_layout_switch,
    "layout.get_viewports": layout_mod.rpc_layout_get_viewports,
}


def _rpc_server_capabilities(_acad, _params) -> Dict[str, Any]:
    return {"methods": sorted(HANDLERS.keys())}


HANDLERS["server.capabilities"] = _rpc_server_capabilities


def _error_response(req_id: Any, code: int, message: str, data: Any = None) -> Dict[str, Any]:
    err: Dict[str, Any] = {"code": code, "message": message}
    if data is not None:
        err["data"] = data
    return {"jsonrpc": "2.0", "id": req_id, "error": err}


def _success_response(req_id: Any, result: Any) -> Dict[str, Any]:
    return {"jsonrpc": "2.0", "id": req_id, "result": result}


def _dispatch_one(req: Dict[str, Any]) -> Dict[str, Any]:
    req_id = req.get("id")
    if req.get("jsonrpc") != "2.0":
        return _error_response(req_id, -32600, "Invalid Request")

    method = req.get("method")
    if not isinstance(method, str):
        return _error_response(req_id, -32600, "Invalid Request")

    fn = HANDLERS.get(method)
    if fn is None:
        return _error_response(req_id, -32601, "Method not found")

    params = req.get("params")
    try:
        if method in ("server.ping", "server.capabilities"):
            result = fn(None, params)
        else:
            acad = get_application()
            result = fn(acad, params)
        return _success_response(req_id, result)
    except JsonRpcError as e:
        return _error_response(req_id, e.code, e.message, e.data)
    except Exception as e:
        tb = traceback.format_exc()
        return _error_response(req_id, -32603, str(e), {"traceback": tb})


def main() -> None:
    com_initialize()
    sys.stdout.write("ready\n")
    sys.stdout.flush()

    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            req = json.loads(line)
        except json.JSONDecodeError as e:
            sys.stdout.write(json.dumps(_error_response(None, -32700, f"Parse error: {e}"), ensure_ascii=False) + "\n")
            sys.stdout.flush()
            continue

        if isinstance(req, list):
            res = [_dispatch_one(r) for r in req if isinstance(r, dict)]
            sys.stdout.write(json.dumps(res, ensure_ascii=False) + "\n")
            sys.stdout.flush()
            continue

        if not isinstance(req, dict):
            sys.stdout.write(json.dumps(_error_response(None, -32600, "Invalid Request"), ensure_ascii=False) + "\n")
            sys.stdout.flush()
            continue

        out = _dispatch_one(req)
        sys.stdout.write(json.dumps(out, ensure_ascii=False) + "\n")
        sys.stdout.flush()


if __name__ == "__main__":
    main()
