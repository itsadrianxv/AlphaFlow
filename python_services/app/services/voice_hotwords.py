"""Build bounded voice ASR hotwords from page context and local catalogs."""

from __future__ import annotations

from pathlib import Path

from app.contracts.voice import VoiceDynamicHotwordContext

DEFAULT_CONCEPT_CATALOG_PATH = Path("data/ths_concept_catalog.csv")
DEFAULT_STOCK_CATALOG_PATH = Path("data/stock_codes.csv")


def _dedupe(items: list[str], limit: int):
    seen: set[str] = set()
    result: list[str] = []
    for item in items:
        normalized = item.strip()
        if not normalized:
            continue
        if normalized in seen:
            continue
        seen.add(normalized)
        result.append(normalized)
        if len(result) >= limit:
            break
    return result


def _read_catalog_names(csv_path: Path):
    if not csv_path.exists():
        return []

    lines = csv_path.read_text(encoding="utf-8").splitlines()
    names: list[str] = []
    for index, raw_line in enumerate(lines):
        line = raw_line.strip()
        if not line:
            continue
        if index == 0 and line.lower() == "name,code":
            continue

        name = line.split(",", 1)[0].strip()
        if name:
            names.append(name)

    return names


def _read_stock_rows(csv_path: Path):
    if not csv_path.exists():
        return []

    lines = csv_path.read_text(encoding="utf-8").splitlines()
    rows: list[tuple[str, str]] = []
    for index, raw_line in enumerate(lines):
        line = raw_line.strip()
        if not line:
            continue
        if index == 0 and line.lower() == "name,code":
            continue

        parts = [item.strip() for item in line.split(",", 1)]
        if len(parts) != 2:
            continue
        name, code = parts
        if name and code:
            rows.append((name, code))
    return rows


def build_voice_hotwords(
    *,
    page_kind: str,
    dynamic_context: VoiceDynamicHotwordContext,
    starter_examples: list[str],
    concept_catalog_path: Path | None = None,
    stock_catalog_path: Path | None = None,
    limit: int = 128,
):
    del page_kind

    seed_terms = [
        dynamic_context.query or "",
        dynamic_context.keyQuestion or "",
        dynamic_context.companyName or "",
        dynamic_context.stockCode or "",
        dynamic_context.researchGoal or "",
        *dynamic_context.focusConcepts,
        *dynamic_context.mustAnswerQuestions,
        *dynamic_context.preferredSources,
        *starter_examples,
    ]

    hotwords = _dedupe(seed_terms, limit=limit)

    concept_names = _read_catalog_names(concept_catalog_path or DEFAULT_CONCEPT_CATALOG_PATH)
    concept_matches: list[str] = []
    for concept_name in concept_names:
        lowered_name = concept_name.lower()
        if any(
            seed and (seed.lower() in lowered_name or lowered_name in seed.lower())
            for seed in dynamic_context.focusConcepts + starter_examples
        ):
            concept_matches.append(concept_name)

    hotwords.extend(_dedupe(concept_matches, limit=limit))

    if dynamic_context.companyName or dynamic_context.stockCode:
        stock_rows = _read_stock_rows(stock_catalog_path or DEFAULT_STOCK_CATALOG_PATH)
        shortlist: list[str] = []
        company_keyword = (dynamic_context.companyName or "").lower()
        code_keyword = dynamic_context.stockCode or ""
        for stock_name, stock_code in stock_rows:
            if company_keyword and company_keyword in stock_name.lower():
                shortlist.extend([stock_name, stock_code])
            elif code_keyword and code_keyword in stock_code:
                shortlist.extend([stock_name, stock_code])

            if len(shortlist) >= 12:
                break

        hotwords.extend(shortlist)

    return _dedupe(hotwords, limit=limit)


__all__ = ["VoiceDynamicHotwordContext", "build_voice_hotwords"]
