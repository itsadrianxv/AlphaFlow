"""Audio validation and transcoding for voice intake."""

from __future__ import annotations

import shutil
import subprocess
import tempfile
import wave
from dataclasses import dataclass
from pathlib import Path

from fastapi import UploadFile


class VoiceInputError(Exception):
    def __init__(self, code: str, message: str, status_code: int):
        super().__init__(message)
        self.code = code
        self.message = message
        self.status_code = status_code


@dataclass(slots=True)
class PreparedAudio:
    temp_dir: Path
    wav_path: Path
    duration_ms: int

    def cleanup(self):
        shutil.rmtree(self.temp_dir, ignore_errors=True)


def _normalize_content_type(content_type: str | None):
    if not content_type:
        return ""

    return content_type.strip().lower()


def _read_upload_bytes(upload: UploadFile, max_upload_bytes: int):
    upload.file.seek(0)
    payload = upload.file.read(max_upload_bytes + 1)
    if len(payload) > max_upload_bytes:
        raise VoiceInputError(
            code="voice_payload_too_large",
            message="Voice upload exceeds the configured size limit.",
            status_code=413,
        )

    if not payload:
        raise VoiceInputError(
            code="voice_empty_upload",
            message="Voice upload is empty.",
            status_code=400,
        )

    return payload


def _get_duration_ms(wav_path: Path):
    with wave.open(str(wav_path), "rb") as wav_file:
        frame_rate = wav_file.getframerate() or 0
        frame_count = wav_file.getnframes()
        if frame_rate <= 0:
            return 0
        return int(frame_count * 1000 / frame_rate)


def transcode_upload_to_wav(
    *,
    upload: UploadFile,
    accepted_mime_types: set[str],
    max_upload_bytes: int,
    max_duration_seconds: int,
):
    content_type = _normalize_content_type(upload.content_type)
    normalized_mime = content_type.split(";", 1)[0]
    if content_type not in accepted_mime_types and normalized_mime not in accepted_mime_types:
        raise VoiceInputError(
            code="voice_unsupported_mime",
            message=f"Unsupported voice mime type: {content_type or 'unknown'}",
            status_code=415,
        )

    payload = _read_upload_bytes(upload, max_upload_bytes=max_upload_bytes)
    temp_dir = Path(tempfile.mkdtemp(prefix="voice-upload-"))
    input_suffix = Path(upload.filename or "voice-upload").suffix or ".bin"
    source_path = temp_dir / f"source{input_suffix}"
    wav_path = temp_dir / "normalized.wav"
    source_path.write_bytes(payload)

    try:
        if normalized_mime in {"audio/wav", "audio/x-wav"}:
            wav_path.write_bytes(payload)
        else:
            completed = subprocess.run(
                [
                    "ffmpeg",
                    "-y",
                    "-i",
                    str(source_path),
                    "-ac",
                    "1",
                    "-ar",
                    "16000",
                    str(wav_path),
                ],
                capture_output=True,
                text=True,
                check=False,
            )
            if completed.returncode != 0:
                raise VoiceInputError(
                    code="voice_transcode_failed",
                    message="Failed to transcode voice upload to wav.",
                    status_code=400,
                )

        duration_ms = _get_duration_ms(wav_path)
        if duration_ms > max_duration_seconds * 1000:
            raise VoiceInputError(
                code="voice_duration_exceeded",
                message="Voice upload exceeds the configured duration limit.",
                status_code=413,
            )

        return PreparedAudio(temp_dir=temp_dir, wav_path=wav_path, duration_ms=duration_ms)
    except Exception:
        shutil.rmtree(temp_dir, ignore_errors=True)
        raise
