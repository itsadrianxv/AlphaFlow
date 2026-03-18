"""Theme concept rules registry backed by local JSON file."""

from __future__ import annotations

from datetime import UTC, datetime
import json
import os
from pathlib import Path
import re
import threading
from typing import Any

_DEFAULT_RULES_FILENAME = "theme_concept_rules.json"
_DEFAULT_RULES_SEED_FILENAME = "theme_concept_rules.seed.json"


class ThemeConceptRulesRegistry:
    """Store and query theme -> concept rule records."""

    def __init__(
        self,
        file_path: str | None = None,
        *,
        seed_path: str | None = None,
    ) -> None:
        env_path = os.getenv("INTELLIGENCE_THEME_CONCEPT_RULES_FILE", "").strip()
        data_dir = Path(__file__).resolve().parent / "data"
        default_path = data_dir / _DEFAULT_RULES_FILENAME
        target_path = file_path or env_path or str(default_path)
        self.file_path = Path(target_path)
        self.seed_path = Path(seed_path) if seed_path else data_dir / _DEFAULT_RULES_SEED_FILENAME
        self._lock = threading.Lock()

    def get_rules(self, theme: str) -> dict:
        normalized_theme = _normalize_theme(theme)
        if not normalized_theme:
            return _empty_rule(theme="")

        records = self._load_records()
        matched = self._find_record(records, normalized_theme)
        if not matched:
            return _empty_rule(theme=theme.strip())

        return _sanitize_record(matched)

    def upsert_rules(
        self,
        theme: str,
        whitelist: list[str] | None = None,
        blacklist: list[str] | None = None,
        aliases: list[str] | None = None,
    ) -> dict:
        normalized_theme = _normalize_theme(theme)
        if not normalized_theme:
            raise ValueError("theme 不能为空")

        cleaned_whitelist = _clean_name_list(whitelist)
        cleaned_blacklist = _clean_name_list(blacklist)
        cleaned_aliases = [
            alias
            for alias in _clean_name_list(aliases)
            if _normalize_theme(alias) != normalized_theme
        ]

        with self._lock:
            records = self._load_records_unlocked()
            record = self._find_record(records, normalized_theme)
            now = datetime.now(UTC).isoformat()

            if record is None:
                record = {
                    "theme": theme.strip(),
                    "whitelist": cleaned_whitelist,
                    "blacklist": cleaned_blacklist,
                    "aliases": cleaned_aliases,
                    "updatedAt": now,
                }
                records.append(record)
            else:
                record["theme"] = theme.strip() or record.get("theme", "")
                record["whitelist"] = cleaned_whitelist
                record["blacklist"] = cleaned_blacklist
                record["aliases"] = cleaned_aliases
                record["updatedAt"] = now

            self._save_records_unlocked(records)
            return _sanitize_record(record)

    def _find_record(self, records: list[dict], normalized_theme: str) -> dict | None:
        best_matched_record: dict | None = None
        best_matched_length = -1

        for record in records:
            normalized_terms = _collect_record_terms(record)
            if normalized_theme in normalized_terms:
                return record

            matched_lengths = [
                len(term)
                for term in normalized_terms
                if term and term in normalized_theme
            ]
            if not matched_lengths:
                continue

            current_best_length = max(matched_lengths)
            if current_best_length > best_matched_length:
                best_matched_length = current_best_length
                best_matched_record = record

        return best_matched_record

    def _load_records(self) -> list[dict]:
        with self._lock:
            return self._load_records_unlocked()

    def _load_records_unlocked(self) -> list[dict]:
        records = self._read_records_from_path(self.file_path)
        if records:
            return records

        seed_records = self._read_records_from_path(self.seed_path)
        if seed_records:
            self._save_records_to_path_unlocked(self.file_path, seed_records)
            return self._read_records_from_path(self.file_path)

        return []

    def _save_records_unlocked(self, records: list[dict]) -> None:
        self._save_records_to_path_unlocked(self.file_path, records)

    def _save_records_to_path_unlocked(
        self,
        file_path: Path,
        records: list[dict],
    ) -> None:
        file_path.parent.mkdir(parents=True, exist_ok=True)
        payload = {
            "version": 1,
            "items": [_sanitize_record(record) for record in records if record],
        }
        tmp_path = file_path.with_suffix(".tmp")
        tmp_path.write_text(
            json.dumps(payload, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
        tmp_path.replace(file_path)

    def _read_records_from_path(self, file_path: Path) -> list[dict]:
        if not file_path.exists():
            return []

        try:
            payload = json.loads(file_path.read_text(encoding="utf-8"))
        except Exception:  # noqa: BLE001
            return []

        items = payload.get("items") if isinstance(payload, dict) else None
        if not isinstance(items, list):
            return []

        normalized_items: list[dict] = []
        for item in items:
            if not isinstance(item, dict):
                continue
            sanitized = _sanitize_record(item)
            if sanitized["theme"]:
                normalized_items.append(sanitized)

        return normalized_items


def _empty_rule(theme: str) -> dict:
    return {
        "theme": theme,
        "whitelist": [],
        "blacklist": [],
        "aliases": [],
        "updatedAt": None,
    }


def _sanitize_record(record: dict[str, Any]) -> dict:
    theme = str(record.get("theme") or "").strip()
    return {
        "theme": theme,
        "whitelist": _clean_name_list(record.get("whitelist")),
        "blacklist": _clean_name_list(record.get("blacklist")),
        "aliases": _clean_name_list(record.get("aliases")),
        "updatedAt": str(record.get("updatedAt") or "").strip() or None,
    }


def _clean_name_list(raw_value: Any) -> list[str]:
    if raw_value is None:
        return []

    if isinstance(raw_value, str):
        source_items = [raw_value]
    elif isinstance(raw_value, list):
        source_items = [str(item) for item in raw_value]
    else:
        return []

    cleaned: list[str] = []
    seen: set[str] = set()
    for raw_item in source_items:
        text = str(raw_item).strip()
        if not text:
            continue
        normalized = _normalize_theme(text)
        if not normalized or normalized in seen:
            continue
        seen.add(normalized)
        cleaned.append(text)

    return cleaned


def _collect_record_terms(record: dict[str, Any]) -> set[str]:
    normalized_terms = {_normalize_theme(record.get("theme"))}
    aliases = record.get("aliases")
    if isinstance(aliases, list):
        normalized_terms.update(_normalize_theme(alias) for alias in aliases)
    return {term for term in normalized_terms if term}


def _normalize_theme(text: Any) -> str:
    if text is None:
        return ""
    lowered = str(text).strip().casefold()
    return re.sub(r"[^\w\u4e00-\u9fff]+", "", lowered)
