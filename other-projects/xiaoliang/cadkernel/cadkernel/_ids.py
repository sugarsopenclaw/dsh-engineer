"""Stable content identifiers used across snapshots and derived artifacts."""

from __future__ import annotations

import hashlib
import struct
from collections.abc import Iterable

import numpy as np

from cadkernel._serialization import stable_json_dumps


def _primitive_identity_part(value: object) -> bool:
    if value is None or isinstance(value, (str, bool, int, float)):
        return True
    if isinstance(value, (tuple, list)):
        return all(_primitive_identity_part(item) for item in value)
    return False


def _update_primitive_identity(digest: "hashlib._Hash", value: object) -> None:
    if value is None:
        digest.update(b"n")
    elif isinstance(value, bool):
        digest.update(b"b1" if value else b"b0")
    elif isinstance(value, int):
        payload = str(value).encode("ascii")
        digest.update(b"i" + len(payload).to_bytes(8, "big") + payload)
    elif isinstance(value, float):
        digest.update(b"f" + struct.pack(">d", value))
    elif isinstance(value, str):
        payload = value.encode("utf-8")
        digest.update(b"s" + len(payload).to_bytes(8, "big") + payload)
    elif isinstance(value, (tuple, list)):
        digest.update(b"t" if isinstance(value, tuple) else b"l")
        digest.update(len(value).to_bytes(8, "big"))
        for item in value:
            _update_primitive_identity(digest, item)
    else:  # pragma: no cover - guarded by _primitive_identity_part
        raise TypeError(type(value).__qualname__)


def stable_id(namespace: str, *parts: object, length: int = 32) -> str:
    """Return a deterministic, namespaced SHA-256 identifier.

    Length defaults to 128 bits of printable digest. Primitive identity paths use a
    compact type-tagged encoding; complex values use canonical JSON. Both avoid Python
    hash randomization and locale differences.
    """

    values = (namespace, *parts)
    if all(_primitive_identity_part(value) for value in values):
        digest = hashlib.sha256(b"cadkernel-id-v2\x00")
        for value in values:
            _update_primitive_identity(digest, value)
        return digest.hexdigest()[:length]
    payload = stable_json_dumps(values).encode("utf-8")
    return hashlib.sha256(payload).hexdigest()[:length]


def stable_text_id(namespace: str, *parts: str, length: int = 32) -> str:
    """Fast deterministic ID for already-normalized text identity components."""

    digest = hashlib.sha256(b"cadkernel-text-id-v1\x00")
    for value in (namespace, *parts):
        if not isinstance(value, str):
            raise TypeError("stable_text_id accepts only str components")
        encoded = value.encode("utf-8")
        digest.update(len(encoded).to_bytes(8, "big"))
        digest.update(encoded)
    return digest.hexdigest()[:length]


def sha256_file(path: str, *, chunk_size: int = 1024 * 1024) -> str:
    digest = hashlib.sha256()
    with open(path, "rb") as stream:
        for chunk in iter(lambda: stream.read(chunk_size), b""):
            digest.update(chunk)
    return digest.hexdigest()


def digest_strings(values: Iterable[str]) -> str:
    digest = hashlib.sha256()
    for value in values:
        encoded = value.encode("utf-8")
        digest.update(len(encoded).to_bytes(8, "big"))
        digest.update(encoded)
    return digest.hexdigest()


def digest_arrays(*values: np.ndarray) -> str:
    """Hash large columnar arrays without expanding them into canonical JSON lists."""

    digest = hashlib.sha256()
    for value in values:
        array = np.ascontiguousarray(value)
        dtype = array.dtype.str.encode("ascii")
        shape = repr(tuple(int(item) for item in array.shape)).encode("ascii")
        digest.update(len(dtype).to_bytes(4, "big"))
        digest.update(dtype)
        digest.update(len(shape).to_bytes(4, "big"))
        digest.update(shape)
        if array.size:
            digest.update(memoryview(array).cast("B"))
    return digest.hexdigest()
