from __future__ import annotations

import gzip
import io
import json
from collections.abc import Iterable
from typing import Any

from shenbian_api.domain.cad_capabilities import capability_graph_scope_key

GRAPH_ATOM_KEYS = (
    "atom_id",
    "surface",
    "atom_kind",
    "observed_host_ids",
    "member_name",
    "declaring_symbol_full_name",
    "classification_status",
    "operation_kinds",
    "domain_tags",
)


def graph_snapshot_scopes(
    manifest: dict[str, Any],
    inventories: list[dict[str, Any]],
) -> list[tuple[str | None, str | None]]:
    surfaces = sorted(manifest["counts"]["by_surface"])
    hosts = sorted({inventory["observed_host_id"] for inventory in inventories})
    return [
        (None, None),
        *((surface, None) for surface in surfaces),
        *((None, host) for host in hosts),
        *((surface, host) for host in hosts for surface in surfaces),
    ]


def graph_atom_projection(row: dict[str, Any]) -> dict[str, Any]:
    return {key: row[key] for key in GRAPH_ATOM_KEYS}


def encode_graph_snapshot_gzip(atoms: Iterable[dict[str, Any]]) -> bytes:
    buffer = io.BytesIO()
    with gzip.GzipFile(
        filename="",
        mode="wb",
        compresslevel=6,
        fileobj=buffer,
        mtime=0,
    ) as compressed:
        for atom in atoms:
            line = json.dumps(
                graph_atom_projection(atom),
                ensure_ascii=False,
                separators=(",", ":"),
            )
            compressed.write(f"{line}\n".encode())
    return buffer.getvalue()


def snapshot_scope_key(surface: str | None, observed_host_id: str | None) -> str:
    return capability_graph_scope_key(surface, observed_host_id)
