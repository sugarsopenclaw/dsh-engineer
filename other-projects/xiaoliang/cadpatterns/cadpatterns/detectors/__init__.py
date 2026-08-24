from cadpatterns.detectors.enclosure import (
    DCEL_FACE_SPEC,
    GAP_BRIDGED_SPEC,
    MERGED_FACE_SPEC,
    detect_dcel_faces,
    detect_gap_bridged,
    detect_merged_faces,
)
from cadpatterns.detectors.motif import (
    BLOCK_INSTANCE_SPEC,
    GEOMETRY_SIGNATURE_SPEC,
    detect_block_instances,
    detect_geometry_signatures,
    geometry_signature,
)
from cadpatterns.detectors.network import PATH_NETWORK_SPEC, detect_path_networks
from cadpatterns.detectors.table_grid import STRICT_GRID_SPEC, detect_strict_grids
from cadpatterns.detectors.text_block import TEXT_BLOCK_SPEC, detect_text_blocks
from cadpatterns.detectors.sheet_boundary import SHEET_BOUNDARY_SPEC, detect_sheet_boundaries

__all__ = [
    "BLOCK_INSTANCE_SPEC",
    "DCEL_FACE_SPEC",
    "GAP_BRIDGED_SPEC",
    "GEOMETRY_SIGNATURE_SPEC",
    "MERGED_FACE_SPEC",
    "PATH_NETWORK_SPEC",
    "STRICT_GRID_SPEC",
    "SHEET_BOUNDARY_SPEC",
    "TEXT_BLOCK_SPEC",
    "detect_block_instances",
    "detect_dcel_faces",
    "detect_gap_bridged",
    "detect_geometry_signatures",
    "detect_merged_faces",
    "detect_path_networks",
    "detect_strict_grids",
    "detect_sheet_boundaries",
    "detect_text_blocks",
    "geometry_signature",
]
