from __future__ import annotations

import unittest

from app.services.audio_format import detect_audio_format, normalize_audio_format


class AudioFormatTests(unittest.TestCase):
    def test_detects_ogg_opus_from_file_header(self) -> None:
        body = b"OggS" + (b"\x00" * 32) + b"OpusHead" + (b"\x00" * 32)

        result = detect_audio_format(body)

        self.assertIsNotNone(result)
        assert result is not None
        self.assertEqual(result.mime_type, "audio/ogg")
        self.assertEqual(result.extension, ".ogg")
        self.assertEqual(result.format_name, "ogg_opus")
        self.assertTrue(result.detected)

    def test_normalizes_audio_opus_mime_to_ogg_container(self) -> None:
        result = normalize_audio_format(
            body=b"not-enough-header",
            filename="voice.opus",
            content_type="audio/opus",
        )

        self.assertIsNotNone(result)
        assert result is not None
        self.assertEqual(result.mime_type, "audio/ogg")
        self.assertEqual(result.extension, ".opus")
        self.assertFalse(result.detected)

    def test_returns_none_for_unknown_binary(self) -> None:
        result = normalize_audio_format(
            body=b"plain-binary",
            filename="voice.bin",
            content_type="application/octet-stream",
        )

        self.assertIsNone(result)


if __name__ == "__main__":
    unittest.main()
