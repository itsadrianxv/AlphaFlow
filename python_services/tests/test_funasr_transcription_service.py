import wave
from pathlib import Path

from app.services import funasr_transcription_service as module


def write_wav(path: Path, duration_ms: int = 300):
    frame_rate = 16_000
    frame_count = int(frame_rate * duration_ms / 1000)
    with wave.open(str(path), "wb") as wav_file:
        wav_file.setnchannels(1)
        wav_file.setsampwidth(2)
        wav_file.setframerate(frame_rate)
        wav_file.writeframes(b"\x00\x00" * frame_count)


def test_funasr_service_lazy_loads_models_once_and_reuses_singleton(
    tmp_path: Path, monkeypatch
):
    wav_path = tmp_path / "smoke.wav"
    write_wav(wav_path)

    auto_model_calls = []

    class FakeAutoModel:
        def __init__(self, **kwargs):
            auto_model_calls.append(kwargs)

        def generate(self, **kwargs):
            return [
                {
                    "text": "贵州茅台利润改善",
                    "sentence_info": [
                        {
                            "start": 0,
                            "end": 300,
                            "text": "贵州茅台利润改善",
                            "confidence": 0.93,
                        }
                    ],
                    "confidence": 0.93,
                }
            ]

    monkeypatch.setattr(module, "AutoModel", FakeAutoModel)
    monkeypatch.setattr(module, "FUNASR_IMPORT_ERROR", None)
    module.reset_funasr_transcription_service()

    service = module.get_funasr_transcription_service(model_root=tmp_path)
    first = service.transcribe(wav_path=wav_path, hotwords=["贵州茅台"], duration_ms=300)
    second = service.transcribe(wav_path=wav_path, hotwords=["贵州茅台"], duration_ms=300)

    assert first.transcript == "贵州茅台利润改善"
    assert second.overallConfidence == 0.93
    assert len(auto_model_calls) == 1


def test_funasr_service_derives_conservative_confidence_without_model_scores(
    tmp_path: Path, monkeypatch
):
    wav_path = tmp_path / "smoke.wav"
    write_wav(wav_path, duration_ms=600)

    class FakeAutoModel:
        def __init__(self, **kwargs):
            pass

        def generate(self, **kwargs):
            return [{"text": "利润改善"}]

    monkeypatch.setattr(module, "AutoModel", FakeAutoModel)
    monkeypatch.setattr(module, "FUNASR_IMPORT_ERROR", None)
    module.reset_funasr_transcription_service()

    service = module.get_funasr_transcription_service(model_root=tmp_path)
    result = service.transcribe(wav_path=wav_path, hotwords=[], duration_ms=600)

    assert result.transcript == "利润改善"
    assert 0 <= result.overallConfidence <= 1
    assert result.overallConfidence < 0.75
    assert result.segments[0].text == "利润改善"
