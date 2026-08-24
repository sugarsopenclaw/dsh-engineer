from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path


GENERIC_BINARY_MIME_TYPES = {"application/octet-stream", "binary/octet-stream"}


@dataclass(frozen=True)
class AudioFormatInfo:
    extension: str
    mime_type: str
    format_name: str
    detected: bool


_EXTENSION_MIME_TYPES: dict[str, tuple[str, str]] = {
    ".aac": ("audio/aac", "aac"),
    ".amr": ("audio/amr", "amr"),
    ".flac": ("audio/flac", "flac"),
    ".m4a": ("audio/mp4", "m4a"),
    ".mp3": ("audio/mpeg", "mp3"),
    ".ogg": ("audio/ogg", "ogg"),
    ".opus": ("audio/ogg", "ogg_opus"),
    ".wav": ("audio/wav", "wav"),
    ".webm": ("audio/webm", "webm"),
}

_MIME_TYPE_ALIASES: dict[str, tuple[str, str, str]] = {
    "audio/aac": (".aac", "audio/aac", "aac"),
    "audio/amr": (".amr", "audio/amr", "amr"),
    "audio/flac": (".flac", "audio/flac", "flac"),
    "audio/mp3": (".mp3", "audio/mpeg", "mp3"),
    "audio/mpeg": (".mp3", "audio/mpeg", "mp3"),
    "audio/mp4": (".m4a", "audio/mp4", "m4a"),
    "audio/ogg": (".ogg", "audio/ogg", "ogg"),
    "audio/opus": (".opus", "audio/ogg", "ogg_opus"),
    "audio/wav": (".wav", "audio/wav", "wav"),
    "audio/wave": (".wav", "audio/wav", "wav"),
    "audio/webm": (".webm", "audio/webm", "webm"),
    "audio/x-m4a": (".m4a", "audio/mp4", "m4a"),
    "audio/x-wav": (".wav", "audio/wav", "wav"),
    "video/webm": (".webm", "audio/webm", "webm"),
}


def detect_audio_format(body: bytes) -> AudioFormatInfo | None:
    head = body[:4096]
    if len(body) >= 12 and body[:4] == b"RIFF" and body[8:12] == b"WAVE":
        return AudioFormatInfo(".wav", "audio/wav", "wav", True)
    if head.startswith(b"OggS"):
        format_name = "ogg_opus" if b"OpusHead" in head else "ogg"
        return AudioFormatInfo(".ogg", "audio/ogg", format_name, True)
    if head.startswith(b"fLaC"):
        return AudioFormatInfo(".flac", "audio/flac", "flac", True)
    if head.startswith(b"ID3") or _looks_like_mp3_frame(head):
        return AudioFormatInfo(".mp3", "audio/mpeg", "mp3", True)
    if head.startswith(b"\x1a\x45\xdf\xa3"):
        return AudioFormatInfo(".webm", "audio/webm", "webm", True)
    if len(body) >= 12 and body[4:8] == b"ftyp":
        return AudioFormatInfo(".m4a", "audio/mp4", "m4a", True)
    if head.startswith(b"#!AMR-WB\n") or head.startswith(b"#!AMR\n"):
        return AudioFormatInfo(".amr", "audio/amr", "amr", True)
    if _looks_like_aac_adts(head):
        return AudioFormatInfo(".aac", "audio/aac", "aac", True)
    return None


def normalize_audio_format(
    *,
    body: bytes,
    filename: str | None,
    content_type: str | None,
) -> AudioFormatInfo | None:
    detected = detect_audio_format(body)
    if detected:
        return detected

    normalized_content_type = (content_type or "").split(";", 1)[0].strip().lower()
    if normalized_content_type in _MIME_TYPE_ALIASES:
        extension, mime_type, format_name = _MIME_TYPE_ALIASES[normalized_content_type]
        return AudioFormatInfo(extension, mime_type, format_name, False)

    extension = Path(filename or "").suffix.lower()
    if extension in _EXTENSION_MIME_TYPES:
        mime_type, format_name = _EXTENSION_MIME_TYPES[extension]
        return AudioFormatInfo(extension, mime_type, format_name, False)

    return None


def is_generic_binary_content_type(content_type: str | None) -> bool:
    normalized = (content_type or "").split(";", 1)[0].strip().lower()
    return normalized in GENERIC_BINARY_MIME_TYPES


def _looks_like_mp3_frame(head: bytes) -> bool:
    return len(head) >= 2 and head[0] == 0xFF and (head[1] & 0xE0) == 0xE0


def _looks_like_aac_adts(head: bytes) -> bool:
    return len(head) >= 2 and head[0] == 0xFF and (head[1] & 0xF0) == 0xF0
