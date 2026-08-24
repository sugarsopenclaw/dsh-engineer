from __future__ import annotations

from pydantic import BaseModel, ConfigDict


class SpeechTranscriptionData(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    text: str
    model: str
    content_type: str | None = None
    original_content_type: str | None = None
    detected_format: str | None = None
    size_bytes: int
