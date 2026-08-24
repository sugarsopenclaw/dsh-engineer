from __future__ import annotations

import base64
import tempfile
import unittest
from pathlib import Path

from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
from cryptography.hazmat.primitives.serialization import Encoding, NoEncryption, PrivateFormat

from app.services.skill_pack_signing import sign_skill_pack_checksum, signature_message


class SkillPackSigningTests(unittest.TestCase):
    def test_signs_canonical_checksum_with_ed25519(self) -> None:
        private_key = Ed25519PrivateKey.generate()
        with tempfile.TemporaryDirectory() as tempdir:
            key_path = Path(tempdir) / "skill-pack-ed25519.pem"
            key_path.write_bytes(
                private_key.private_bytes(Encoding.PEM, PrivateFormat.PKCS8, NoEncryption())
            )
            checksum = "a" * 64
            envelope = sign_skill_pack_checksum(
                checksum=checksum,
                private_key_path=key_path,
                key_id="primary-v1",
            )

        self.assertEqual(envelope["algorithm"], "Ed25519")
        self.assertEqual(envelope["key_id"], "primary-v1")
        private_key.public_key().verify(
            base64.b64decode(envelope["value"], validate=True),
            signature_message(checksum),
        )

    def test_rejects_noncanonical_checksum(self) -> None:
        with self.assertRaisesRegex(ValueError, "checksum"):
            signature_message("not-a-checksum")


if __name__ == "__main__":
    unittest.main()
