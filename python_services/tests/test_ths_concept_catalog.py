import os
from pathlib import Path
import time
from unittest.mock import patch

import pandas as pd
import pytest

from app.services.ths_concept_catalog import (
    clear_ths_concept_catalog_cache,
    load_ths_concept_catalog_frame,
)
from scripts.refresh_concept_catalog import refresh_concept_catalog


@pytest.fixture(autouse=True)
def clear_catalog_cache():
    clear_ths_concept_catalog_cache()
    yield
    clear_ths_concept_catalog_cache()


def test_load_ths_concept_catalog_frame_reads_standard_csv(tmp_path: Path):
    catalog_path = tmp_path / "ths_concept_catalog.csv"
    catalog_path.write_text("name,code\nAI,309121\n机器人概念,300816\n", encoding="utf-8")

    frame = load_ths_concept_catalog_frame(catalog_path)

    assert list(frame.columns) == ["name", "code"]
    assert frame.to_dict("records") == [
        {"name": "AI", "code": "309121"},
        {"name": "机器人概念", "code": "300816"},
    ]


def test_load_ths_concept_catalog_frame_reloads_after_file_change(tmp_path: Path):
    catalog_path = tmp_path / "ths_concept_catalog.csv"
    catalog_path.write_text("name,code\nAI,309121\n", encoding="utf-8")

    first = load_ths_concept_catalog_frame(catalog_path)
    time.sleep(0.01)
    catalog_path.write_text("name,code\n人形机器人,309119\n", encoding="utf-8")
    second = load_ths_concept_catalog_frame(catalog_path)

    assert first.to_dict("records") == [{"name": "AI", "code": "309121"}]
    assert second.to_dict("records") == [{"name": "人形机器人", "code": "309119"}]


def test_load_ths_concept_catalog_frame_raises_for_missing_file(tmp_path: Path):
    missing_path = tmp_path / "missing.csv"

    with pytest.raises(FileNotFoundError, match="THS concept catalog file not found"):
        load_ths_concept_catalog_frame(missing_path)


def test_load_ths_concept_catalog_frame_raises_for_missing_columns(tmp_path: Path):
    catalog_path = tmp_path / "ths_concept_catalog.csv"
    catalog_path.write_text("concept,code\nAI,309121\n", encoding="utf-8")

    with pytest.raises(ValueError, match="missing required columns"):
        load_ths_concept_catalog_frame(catalog_path)


def test_load_ths_concept_catalog_frame_raises_for_empty_file(tmp_path: Path):
    catalog_path = tmp_path / "ths_concept_catalog.csv"
    catalog_path.write_text("", encoding="utf-8")

    with pytest.raises(ValueError, match="is empty"):
        load_ths_concept_catalog_frame(catalog_path)


def test_load_ths_concept_catalog_frame_raises_for_duplicate_names(tmp_path: Path):
    catalog_path = tmp_path / "ths_concept_catalog.csv"
    catalog_path.write_text(
        "name,code\nAI,309121\nAI,309164\n",
        encoding="utf-8",
    )

    with pytest.raises(ValueError, match="duplicate name values"):
        load_ths_concept_catalog_frame(catalog_path)


def test_load_ths_concept_catalog_frame_uses_local_snapshot(tmp_path: Path):
    catalog_path = tmp_path / "ths_concept_catalog.csv"
    catalog_path.write_text("name,code\nAI,309121\n", encoding="utf-8")

    with patch.dict(
        os.environ,
        {"INTELLIGENCE_CONCEPT_CATALOG_FILE": str(catalog_path)},
        clear=False,
    ):
        frame = load_ths_concept_catalog_frame()

    assert frame.to_dict("records") == [{"name": "AI", "code": "309121"}]


@patch("scripts.refresh_concept_catalog.TushareProviderClient.get_concept_catalog")
def test_refresh_concept_catalog_writes_standard_snapshot(mock_catalog, tmp_path: Path):
    mock_catalog.return_value = [
        {"conceptName": "AI", "conceptCode": "309121"},
        {"conceptName": "AI", "conceptCode": "309121"},
        {"conceptName": "人形机器人", "conceptCode": "309119"},
    ]
    output_path = tmp_path / "ths_concept_catalog.csv"

    written_path = refresh_concept_catalog(str(output_path))

    written_frame = pd.read_csv(output_path, dtype=str)
    assert written_path == output_path
    assert list(written_frame.columns) == ["name", "code"]
    assert written_frame.to_dict("records") == [
        {"name": "AI", "code": "309121"},
        {"name": "人形机器人", "code": "309119"},
    ]
