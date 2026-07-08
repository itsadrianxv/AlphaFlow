"""Refresh the local THS concept catalog snapshot."""

from __future__ import annotations

import argparse
from pathlib import Path
import sys

import pandas as pd

PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from app.services.ths_concept_catalog import (
    resolve_ths_concept_catalog_path,
    write_ths_concept_catalog_frame,
)
from app.providers.tushare.client import TushareProviderClient


def refresh_concept_catalog(output_path: str | None = None) -> Path:
    catalog = TushareProviderClient().get_concept_catalog()
    live_frame = pd.DataFrame(
        [
            {
                "name": item["conceptName"],
                "code": item["conceptCode"],
            }
            for item in catalog
        ]
    )
    if live_frame.empty:
        raise ValueError("TuShare THS concept catalog returned empty payload")

    return write_ths_concept_catalog_frame(live_frame, output_path=output_path)


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Refresh the local THS concept catalog snapshot",
    )
    parser.add_argument(
        "--output",
        default=None,
        help="Target CSV path. Defaults to the configured THS catalog file.",
    )
    args = parser.parse_args()

    target_path = resolve_ths_concept_catalog_path(args.output)
    written_path = refresh_concept_catalog(output_path=str(target_path))
    print(f"Refreshed THS concept catalog: {written_path}")


if __name__ == "__main__":
    main()
