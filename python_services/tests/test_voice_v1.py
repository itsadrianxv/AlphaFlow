import io
import logging
import wave
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from starlette.datastructures import Headers, UploadFile

from app.main import app
from app.services.audio_transcoding import VoiceInputError, transcode_upload_to_wav

client = TestClient(app)


def build_wav_bytes(duration_ms: int = 300):
    frame_rate = 16_000
    frame_count = int(frame_rate * duration_ms / 1000)
    output = io.BytesIO()
    with wave.open(output, "wb") as wav_file:
        wav_file.setnchannels(1)
        wav_file.setsampwidth(2)
        wav_file.setframerate(frame_rate)
        wav_file.writeframes(b"\x00\x00" * frame_count)
    return output.getvalue()


def test_voice_v1_returns_structured_transcription_response(monkeypatch):
    class PreparedAudio:
        wav_path = Path("tests/fixtures/voice_smoke_zh.wav")
        duration_ms = 320

        def cleanup(self):
            return None

    monkeypatch.setattr(
        "app.routers.voice_v1.transcode_upload_to_wav",
        lambda **kwargs: PreparedAudio(),
    )
    monkeypatch.setattr(
        "app.routers.voice_v1.build_voice_hotwords",
        lambda **kwargs: ["贵州茅台"],
    )

    class FakeService:
        def transcribe(self, **kwargs):
            return {
                "transcript": "贵州茅台利润改善",
                "durationMs": 320,
                "overallConfidence": 0.92,
                "segments": [
                    {
                        "startMs": 0,
                        "endMs": 320,
                        "text": "贵州茅台利润改善",
                        "confidence": 0.92,
                    }
                ],
            }

    monkeypatch.setattr(
        "app.routers.voice_v1.get_funasr_transcription_service",
        lambda: FakeService(),
    )

    response = client.post(
        "/api/v1/voice/transcribe",
        files={"audio": ("voice.wav", build_wav_bytes(), "audio/wav")},
        data={
            "pageKind": "quick_research",
            "dynamicHotwords": "{}",
            "starterExamples": "[]",
        },
    )

    assert response.status_code == 200
    body = response.json()
    assert body["transcript"] == "贵州茅台利润改善"
    assert body["durationMs"] == 320
    assert body["overallConfidence"] == 0.92


def test_voice_v1_rejects_unsupported_mime():
    response = client.post(
        "/api/v1/voice/transcribe",
        files={"audio": ("voice.txt", b"plain-text", "text/plain")},
        data={
            "pageKind": "quick_research",
            "dynamicHotwords": "{}",
            "starterExamples": "[]",
        },
    )

    assert response.status_code == 415
    assert response.json()["detail"]["code"] == "voice_unsupported_mime"


def test_voice_v1_rejects_oversized_payload():
    oversized = b"0" * (10_485_760 + 1)
    response = client.post(
        "/api/v1/voice/transcribe",
        files={"audio": ("voice.wav", oversized, "audio/wav")},
        data={
            "pageKind": "quick_research",
            "dynamicHotwords": "{}",
            "starterExamples": "[]",
        },
    )

    assert response.status_code == 413
    assert response.json()["detail"]["code"] == "voice_payload_too_large"


def test_transcode_upload_to_wav_rejects_duration_over_limit(tmp_path: Path):
    upload = UploadFile(
        file=io.BytesIO(build_wav_bytes(duration_ms=91_000)),
        filename="too-long.wav",
        headers=Headers({"content-type": "audio/wav"}),
    )

    with pytest.raises(VoiceInputError) as exc_info:
        transcode_upload_to_wav(
            upload=upload,
            accepted_mime_types={"audio/wav"},
            max_upload_bytes=10_485_760,
            max_duration_seconds=90,
        )

    assert exc_info.value.code == "voice_duration_exceeded"


def test_voice_v1_does_not_log_transcript_text(monkeypatch, caplog):
    class PreparedAudio:
        wav_path = Path("tests/fixtures/voice_smoke_zh.wav")
        duration_ms = 320

        def cleanup(self):
            return None

    monkeypatch.setattr(
        "app.routers.voice_v1.transcode_upload_to_wav",
        lambda **kwargs: PreparedAudio(),
    )
    monkeypatch.setattr(
        "app.routers.voice_v1.build_voice_hotwords",
        lambda **kwargs: ["贵州茅台"],
    )

    class FakeService:
        def transcribe(self, **kwargs):
            return {
                "transcript": "SECRET TRANSCRIPT SHOULD NOT APPEAR",
                "durationMs": 320,
                "overallConfidence": 0.92,
                "segments": [],
            }

    monkeypatch.setattr(
        "app.routers.voice_v1.get_funasr_transcription_service",
        lambda: FakeService(),
    )

    with caplog.at_level(logging.INFO, logger="app.routers.voice_v1"):
        response = client.post(
            "/api/v1/voice/transcribe",
            files={"audio": ("voice.wav", build_wav_bytes(), "audio/wav")},
            data={
                "pageKind": "quick_research",
                "dynamicHotwords": "{}",
                "starterExamples": "[]",
            },
        )

    assert response.status_code == 200
    assert "SECRET TRANSCRIPT SHOULD NOT APPEAR" not in caplog.text
