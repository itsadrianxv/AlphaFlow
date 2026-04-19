from pathlib import Path

from app.services.voice_hotwords import (
    VoiceDynamicHotwordContext,
    build_voice_hotwords,
)


def write_csv(path: Path, rows: list[str]):
    path.write_text("\n".join(rows), encoding="utf-8")


def test_build_voice_hotwords_merges_dynamic_context_examples_and_catalogs(tmp_path: Path):
    concept_catalog_path = tmp_path / "ths_concept_catalog.csv"
    stock_catalog_path = tmp_path / "stock_codes.csv"
    write_csv(
        concept_catalog_path,
        [
            "name,code",
            "高端白酒,301001",
            "AI算力,301002",
        ],
    )
    write_csv(
        stock_catalog_path,
        [
            "name,code",
            "贵州茅台,600519",
            "五粮液,000858",
        ],
    )

    hotwords = build_voice_hotwords(
        page_kind="company_research",
        dynamic_context=VoiceDynamicHotwordContext(
            companyName="贵州茅台",
            stockCode="600519",
            focusConcepts=["高端白酒"],
            researchGoal="确认利润修复持续性",
            mustAnswerQuestions=["库存是否健康"],
            preferredSources=["公告"],
        ),
        starter_examples=["贵州茅台利润改善是否可持续"],
        concept_catalog_path=concept_catalog_path,
        stock_catalog_path=stock_catalog_path,
        limit=32,
    )

    assert "贵州茅台" in hotwords
    assert "600519" in hotwords
    assert "高端白酒" in hotwords
    assert "确认利润修复持续性" in hotwords
    assert "库存是否健康" in hotwords
    assert "公告" in hotwords


def test_build_voice_hotwords_avoids_full_stock_catalog_injection(tmp_path: Path):
    concept_catalog_path = tmp_path / "ths_concept_catalog.csv"
    stock_catalog_path = tmp_path / "stock_codes.csv"
    write_csv(
        concept_catalog_path,
        [
            "name,code",
            "高端白酒,301001",
            "AI算力,301002",
        ],
    )
    write_csv(
        stock_catalog_path,
        [
            "name,code",
            "贵州茅台,600519",
            "五粮液,000858",
        ],
    )

    hotwords = build_voice_hotwords(
        page_kind="quick_research",
        dynamic_context=VoiceDynamicHotwordContext(
            query="白酒行业未来一年的核心矛盾",
            focusConcepts=["高端白酒"],
        ),
        starter_examples=["白酒行业研究模板"],
        concept_catalog_path=concept_catalog_path,
        stock_catalog_path=stock_catalog_path,
        limit=16,
    )

    assert "高端白酒" in hotwords
    assert "贵州茅台" not in hotwords
    assert "五粮液" not in hotwords
    assert len(hotwords) <= 16
