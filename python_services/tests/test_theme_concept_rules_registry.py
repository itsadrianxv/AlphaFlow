"""Theme concept rules registry tests."""

import json
from pathlib import Path

from app.services.theme_concept_rules_registry import ThemeConceptRulesRegistry


def _write_rules(path: Path, items: list[dict]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps({"version": 1, "items": items}, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )


def test_bootstraps_seed_when_target_file_is_missing(tmp_path: Path):
    target_path = tmp_path / "runtime" / "theme_concept_rules.json"
    seed_path = tmp_path / "seed" / "theme_concept_rules.seed.json"
    _write_rules(
        seed_path,
        [
            {
                "theme": "算力",
                "whitelist": ["东数西算(算力)"],
                "blacklist": [],
                "aliases": ["ai算力基础设施"],
                "updatedAt": "2026-03-18T00:00:00+00:00",
            }
        ],
    )

    registry = ThemeConceptRulesRegistry(
        file_path=str(target_path),
        seed_path=str(seed_path),
    )

    matched = registry.get_rules("AI 算力基础设施的盈利兑现节奏，应该看哪些领先指标？")

    assert target_path.exists()
    assert matched["theme"] == "算力"
    assert matched["whitelist"] == ["东数西算(算力)"]


def test_bootstraps_seed_when_target_file_has_empty_items(tmp_path: Path):
    target_path = tmp_path / "runtime" / "theme_concept_rules.json"
    seed_path = tmp_path / "seed" / "theme_concept_rules.seed.json"
    _write_rules(target_path, [])
    _write_rules(
        seed_path,
        [
            {
                "theme": "机器人",
                "whitelist": ["机器人概念"],
                "blacklist": [],
                "aliases": ["机器人产业链"],
                "updatedAt": "2026-03-18T00:00:00+00:00",
            }
        ],
    )

    registry = ThemeConceptRulesRegistry(
        file_path=str(target_path),
        seed_path=str(seed_path),
    )

    matched = registry.get_rules("机器人产业链还有没有贝塔？")

    assert matched["theme"] == "机器人"
    saved = json.loads(target_path.read_text(encoding="utf-8"))
    assert saved["items"][0]["theme"] == "机器人"


def test_existing_non_empty_rules_are_not_overwritten(tmp_path: Path):
    target_path = tmp_path / "runtime" / "theme_concept_rules.json"
    seed_path = tmp_path / "seed" / "theme_concept_rules.seed.json"
    original_items = [
        {
            "theme": "自定义主题",
            "whitelist": ["自定义概念"],
            "blacklist": [],
            "aliases": ["自定义别名"],
            "updatedAt": "2026-03-18T00:00:00+00:00",
        }
    ]
    _write_rules(target_path, original_items)
    _write_rules(
        seed_path,
        [
            {
                "theme": "算力",
                "whitelist": ["东数西算(算力)"],
                "blacklist": [],
                "aliases": ["ai算力基础设施"],
                "updatedAt": "2026-03-18T00:00:00+00:00",
            }
        ],
    )

    registry = ThemeConceptRulesRegistry(
        file_path=str(target_path),
        seed_path=str(seed_path),
    )

    matched = registry.get_rules("自定义别名")

    assert matched["theme"] == "自定义主题"
    saved = json.loads(target_path.read_text(encoding="utf-8"))
    assert saved["items"] == original_items


def test_prefers_longest_contains_match(tmp_path: Path):
    target_path = tmp_path / "runtime" / "theme_concept_rules.json"
    _write_rules(
        target_path,
        [
            {
                "theme": "AI",
                "whitelist": ["AI PC"],
                "blacklist": [],
                "aliases": [],
                "updatedAt": "2026-03-18T00:00:00+00:00",
            },
            {
                "theme": "算力",
                "whitelist": ["东数西算(算力)"],
                "blacklist": [],
                "aliases": ["ai算力基础设施"],
                "updatedAt": "2026-03-18T00:00:00+00:00",
            },
        ],
    )

    registry = ThemeConceptRulesRegistry(file_path=str(target_path))

    matched = registry.get_rules("AI 算力基础设施的盈利兑现节奏，应该看哪些领先指标？")

    assert matched["theme"] == "算力"
