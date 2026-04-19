"""Lazy-loaded FunASR transcription service."""

from __future__ import annotations

from pathlib import Path
from threading import Lock

from app.contracts.voice import VoiceTranscriptionResponse, VoiceTranscriptionSegment

try:
    from funasr import AutoModel

    FUNASR_IMPORT_ERROR = None
except ImportError as exc:  # pragma: no cover - exercised through tests
    AutoModel = None  # type: ignore[assignment]
    FUNASR_IMPORT_ERROR = exc

DEFAULT_MODEL_ROOT = Path("/app/models/funasr")


def _clamp_confidence(value: float | int | None):
    if value is None:
        return None

    try:
        numeric = float(value)
    except (TypeError, ValueError):
        return None

    if numeric < 0 or numeric > 1:
        return None
    return numeric


class FunASRTranscriptionService:
    def __init__(self, *, model_root: Path | str = DEFAULT_MODEL_ROOT):
        self.model_root = Path(model_root)
        self._model = None
        self._lock = Lock()

    def _ensure_model(self):
        if self._model is not None:
            return self._model

        if FUNASR_IMPORT_ERROR is not None:
            raise RuntimeError("FunASR is not installed.") from FUNASR_IMPORT_ERROR

        with self._lock:
            if self._model is None:
                self._model = AutoModel(
                    model=str(self.model_root / "paraformer-zh"),
                    vad_model=str(self.model_root / "fsmn-vad"),
                    punc_model=str(self.model_root / "ct-punc"),
                    device="cpu",
                )
        return self._model

    def _extract_segments(self, payload: dict, duration_ms: int):
        raw_segments = (
            payload.get("sentence_info")
            or payload.get("sentences")
            or payload.get("segments")
            or []
        )
        segments: list[VoiceTranscriptionSegment] = []
        for raw_segment in raw_segments:
            if not isinstance(raw_segment, dict):
                continue
            text = str(raw_segment.get("text", "")).strip()
            if not text:
                continue

            start_ms = int(
                raw_segment.get("start_ms")
                or raw_segment.get("start")
                or raw_segment.get("begin_time")
                or 0
            )
            end_ms = int(
                raw_segment.get("end_ms")
                or raw_segment.get("end")
                or raw_segment.get("end_time")
                or duration_ms
            )
            confidence = _clamp_confidence(
                raw_segment.get("confidence") or raw_segment.get("score")
            )
            segments.append(
                VoiceTranscriptionSegment(
                    startMs=max(start_ms, 0),
                    endMs=max(end_ms, 0),
                    text=text,
                    confidence=confidence,
                )
            )

        return segments

    def _derive_confidence(self, payload: dict, segments: list[VoiceTranscriptionSegment], transcript: str):
        direct_confidence = _clamp_confidence(payload.get("confidence") or payload.get("score"))
        if direct_confidence is not None:
            return direct_confidence

        segment_confidences = [
            segment.confidence for segment in segments if segment.confidence is not None
        ]
        if segment_confidences:
            return round(sum(segment_confidences) / len(segment_confidences), 4)

        heuristic = min(0.74, 0.46 + min(len(transcript), 10) * 0.02)
        return round(max(0.0, min(1.0, heuristic)), 4)

    def transcribe(self, *, wav_path: Path, hotwords: list[str], duration_ms: int):
        model = self._ensure_model()
        raw_result = model.generate(
            input=str(wav_path),
            hotword=" ".join(hotwords) if hotwords else None,
        )
        payload = raw_result[0] if isinstance(raw_result, list) else raw_result
        if not isinstance(payload, dict):
            payload = {}

        transcript = " ".join(str(payload.get("text", "")).split()).strip()
        segments = self._extract_segments(payload, duration_ms=duration_ms)
        if not segments and transcript:
            segments = [
                VoiceTranscriptionSegment(
                    startMs=0,
                    endMs=duration_ms,
                    text=transcript,
                    confidence=None,
                )
            ]

        return VoiceTranscriptionResponse(
            transcript=transcript,
            durationMs=duration_ms,
            overallConfidence=self._derive_confidence(payload, segments, transcript),
            segments=segments,
        )


_service_singleton: FunASRTranscriptionService | None = None


def get_funasr_transcription_service(*, model_root: Path | str = DEFAULT_MODEL_ROOT):
    global _service_singleton
    if _service_singleton is None:
        _service_singleton = FunASRTranscriptionService(model_root=model_root)
    return _service_singleton


def reset_funasr_transcription_service():
    global _service_singleton
    _service_singleton = None
