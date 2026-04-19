"""Download the deterministic FunASR model set used by voice intake."""

from __future__ import annotations

import argparse
import shutil
from pathlib import Path

from modelscope.hub.snapshot_download import snapshot_download

MODEL_SPECS = {
    "paraformer-zh": "iic/speech_paraformer-large-vad-punc_asr_nat-zh-cn-16k-common-vocab8404-pytorch",
    "fsmn-vad": "iic/speech_fsmn_vad_zh-cn-16k-common-pytorch",
    "ct-punc": "iic/punc_ct-transformer_zh-cn-common-vocab272727-pytorch",
}


def download_models(output_dir: Path):
    output_dir.mkdir(parents=True, exist_ok=True)
    cache_dir = output_dir / "_cache"
    cache_dir.mkdir(parents=True, exist_ok=True)

    for alias, model_id in MODEL_SPECS.items():
        downloaded_path = Path(
            snapshot_download(model_id=model_id, cache_dir=str(cache_dir))
        )
        target_dir = output_dir / alias
        if target_dir.exists():
            shutil.rmtree(target_dir)
        shutil.copytree(downloaded_path, target_dir)

    shutil.rmtree(cache_dir, ignore_errors=True)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument(
      "--output-dir",
      default="python_services/models/funasr",
      help="Directory where the deterministic FunASR model set will be copied.",
    )
    args = parser.parse_args()
    download_models(Path(args.output_dir))


if __name__ == "__main__":
    main()
