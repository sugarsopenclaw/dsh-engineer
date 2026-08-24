from __future__ import annotations

import base64
import re
from pathlib import Path

from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
from cryptography.hazmat.primitives.serialization import load_pem_private_key


SIGNATURE_ALGORITHM = "Ed25519"
SIGNATURE_CONTEXT = b"xiaoliang-skill-pack-checksum-v1\0"
CHECKSUM_PATTERN = re.compile(r"^[0-9a-f]{64}$")
KEY_ID_PATTERN = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$")


def signature_message(checksum: str) -> bytes:
    normalized = checksum.strip().lower()
    if not CHECKSUM_PATTERN.fullmatch(normalized):
        raise ValueError("skill pack checksum must be 64 lowercase hex characters")
    return SIGNATURE_CONTEXT + normalized.encode("ascii")


def sign_skill_pack_checksum(
    *,
    checksum: str,
    private_key_path: Path,
    key_id: str,
) -> dict[str, str]:
    normalized_key_id = key_id.strip()
    if not KEY_ID_PATTERN.fullmatch(normalized_key_id):
        raise ValueError("skill pack signing key id is invalid")
    loaded = load_pem_private_key(private_key_path.read_bytes(), password=None)
    if not isinstance(loaded, Ed25519PrivateKey):
        raise ValueError("skill pack signing key must be an Ed25519 private key")
    signature = loaded.sign(signature_message(checksum))
    return {
        "algorithm": SIGNATURE_ALGORITHM,
        "key_id": normalized_key_id,
        "value": base64.b64encode(signature).decode("ascii"),
    }
