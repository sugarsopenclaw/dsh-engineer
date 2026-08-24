from __future__ import annotations

from pathlib import Path
from typing import Annotated

from fastapi import APIRouter, Depends, File, UploadFile
from starlette.concurrency import run_in_threadpool

from app.api.dependencies import get_current_user_detached, get_qwen_asr_service
from app.core.config import Settings, get_settings
from app.core.errors import AppError
from app.models.common import ApiResponse
from app.models.speech import SpeechTranscriptionData
from app.models.user import CurrentUserData
from app.services.audio_format import (
    is_generic_binary_content_type,
    normalize_audio_format,
)
from app.services.speech_service import (
    QwenAsrConfigurationError,
    QwenAsrEmptyResultError,
    QwenAsrError,
    QwenAsrService,
)

router = APIRouter(prefix="/speech", tags=["speech"])


@router.post("/transcribe", response_model=ApiResponse[SpeechTranscriptionData])
async def transcribe_audio(
    audio: Annotated[UploadFile, File(...)],
    current_user: Annotated[CurrentUserData, Depends(get_current_user_detached)],
    asr_service: Annotated[QwenAsrService, Depends(get_qwen_asr_service)],
    settings: Annotated[Settings, Depends(get_settings)],
) -> ApiResponse[SpeechTranscriptionData]:
    del current_user

    max_file_size = max(1, int(settings.patient_asr_max_file_size_mb)) * 1024 * 1024
    allowed_extensions = {
        ext.lower() if ext.startswith(".") else f".{ext.lower()}"
        for ext in settings.patient_asr_allowed_extensions
        if ext.strip()
    }
    allowed_mime_types = {
        mime.strip().lower()
        for mime in settings.patient_asr_allowed_mime_types
        if mime.strip()
    }

    raw_content_type = (audio.content_type or "").split(";", 1)[0].strip().lower()
    raw_file_extension = Path(audio.filename or "").suffix.lower()

    body = await audio.read()
    size_bytes = len(body)

    if size_bytes == 0:
        raise AppError(400, "音频文件为空，无法识别。")

    if size_bytes > max_file_size:
        raise AppError(400, f"音频文件超过大小限制（最大 {max_file_size // (1024 * 1024)}MB）。")

    audio_format = normalize_audio_format(
        body=body,
        filename=audio.filename,
        content_type=audio.content_type,
    )

    if is_generic_binary_content_type(raw_content_type) and not (audio_format and audio_format.detected):
        raise AppError(400, "无法识别音频格式，请上传受支持的语音文件。")

    content_type = audio_format.mime_type if audio_format else raw_content_type
    file_extension = audio_format.extension if audio_format else raw_file_extension

    if (allowed_extensions or allowed_mime_types) and not (
        file_extension in allowed_extensions or content_type in allowed_mime_types
    ):
        supported = ", ".join(sorted(allowed_extensions)) if allowed_extensions else "(未配置)"
        raise AppError(400, f"音频类型不支持，支持扩展名: {supported}")

    if not (
        content_type.startswith("audio/")
        or content_type == "video/webm"
        or file_extension in allowed_extensions
    ):
        raise AppError(400, "上传文件不是有效音频类型。")

    try:
        asr_result = await run_in_threadpool(asr_service.transcribe, body, content_type)
    except QwenAsrConfigurationError as exc:
        raise AppError(500, str(exc), error_code="asr_configuration_error") from exc
    except QwenAsrEmptyResultError as exc:
        raise AppError(422, str(exc), error_code="asr_empty_result") from exc
    except QwenAsrError as exc:
        raise AppError(500, str(exc), error_code="asr_transcribe_error") from exc

    return ApiResponse(
        data=SpeechTranscriptionData(
            text=asr_result.get("text", ""),
            model=asr_result.get("model", ""),
            content_type=content_type or None,
            original_content_type=raw_content_type or None,
            detected_format=audio_format.format_name if audio_format and audio_format.detected else None,
            size_bytes=size_bytes,
        )
    )
