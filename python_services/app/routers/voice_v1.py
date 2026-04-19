"""Voice transcription route for research intake."""

from __future__ import annotations

import json
import logging
import os

from fastapi import APIRouter, File, Form, HTTPException, Request, UploadFile

from app.contracts.voice import (
    VoiceDynamicHotwordContext,
    VoiceTranscriptionResponse,
)
from app.services.audio_transcoding import VoiceInputError, transcode_upload_to_wav
from app.services.funasr_transcription_service import get_funasr_transcription_service
from app.services.voice_hotwords import build_voice_hotwords

router = APIRouter(prefix="/api/v1/voice")
LOGGER = logging.getLogger(__name__)

VOICE_ACCEPTED_MIME_TYPES = {
    "audio/webm",
    "audio/webm;codecs=opus",
    "audio/wav",
    "audio/x-wav",
    "audio/mpeg",
    "audio/mp4",
}


def _parse_starter_examples(raw_value: str | None):
    if not raw_value:
        return []

    parsed = json.loads(raw_value)
    if not isinstance(parsed, list):
        raise ValueError("starterExamples must be a JSON array.")

    return [str(item).strip() for item in parsed if str(item).strip()]


@router.post("/transcribe", response_model=VoiceTranscriptionResponse)
def transcribe_voice(
    request: Request,
    audio: UploadFile = File(...),
    pageKind: str = Form(...),
    dynamicHotwords: str = Form("{}"),
    starterExamples: str = Form("[]"),
):
    prepared_audio = None
    request_id = getattr(request.state, "request_id", "unknown")

    try:
        if pageKind not in {"quick_research", "company_research"}:
            raise HTTPException(
                status_code=400,
                detail={
                    "code": "voice_invalid_page_kind",
                    "message": f"Unsupported voice page kind: {pageKind}",
                },
            )

        dynamic_context = VoiceDynamicHotwordContext.model_validate_json(dynamicHotwords)
        starter_examples = _parse_starter_examples(starterExamples)
        prepared_audio = transcode_upload_to_wav(
            upload=audio,
            accepted_mime_types=VOICE_ACCEPTED_MIME_TYPES,
            max_upload_bytes=int(os.getenv("VOICE_MAX_UPLOAD_BYTES", "10485760")),
            max_duration_seconds=int(os.getenv("VOICE_MAX_DURATION_SECONDS", "90")),
        )
        hotwords = build_voice_hotwords(
            page_kind=pageKind,
            dynamic_context=dynamic_context,
            starter_examples=starter_examples,
            limit=int(os.getenv("VOICE_HOTWORD_LIMIT", "128")),
        )
        transcription = get_funasr_transcription_service().transcribe(
            wav_path=prepared_audio.wav_path,
            hotwords=hotwords,
            duration_ms=prepared_audio.duration_ms,
        )
        result = VoiceTranscriptionResponse.model_validate(transcription)
        LOGGER.info(
            "voice transcription completed",
            extra={
                "request_id": request_id,
                "duration_ms": result.durationMs,
                "overall_confidence": result.overallConfidence,
            },
        )
        return result
    except VoiceInputError as exc:
        LOGGER.warning(
            "voice transcription rejected",
            extra={"request_id": request_id, "error_code": exc.code},
        )
        raise HTTPException(
            status_code=exc.status_code,
            detail={"code": exc.code, "message": exc.message},
        ) from exc
    except HTTPException:
        raise
    except (ValueError, json.JSONDecodeError) as exc:
        LOGGER.warning(
            "voice transcription invalid form",
            extra={"request_id": request_id, "error_code": "voice_invalid_form"},
        )
        raise HTTPException(
            status_code=400,
            detail={"code": "voice_invalid_form", "message": str(exc)},
        ) from exc
    except Exception as exc:  # pragma: no cover - exercised through tests and runtime
        LOGGER.exception(
            "voice transcription failed",
            extra={"request_id": request_id, "error_code": "voice_transcription_failed"},
        )
        raise HTTPException(
            status_code=500,
            detail={
                "code": "voice_transcription_failed",
                "message": "Voice transcription failed.",
            },
        ) from exc
    finally:
        if prepared_audio is not None:
            prepared_audio.cleanup()
