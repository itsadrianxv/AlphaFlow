"""Confidence analysis service backed by RefChecker with heuristic fallback."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime
import importlib
import os
import re
import time
from typing import Any

from app.contracts.intelligence import (
    ConfidenceAnalysis,
    ConfidenceCheckRequest,
    ConfidenceClaimAnalysis,
    ConfidenceReferenceItem,
)
from app.infrastructure.metrics.recorder import metrics_recorder

_NEGATIVE_MARKERS = (
    "not",
    "never",
    "no ",
    "none",
    "without",
    "down",
    "decline",
    "drop",
    "fall",
    "decrease",
)
_POSITIVE_MARKERS = (
    "increase",
    "improved",
    "growth",
    "up",
    "gain",
    "rose",
    "higher",
)
_REFCHECKER_ENABLED = os.getenv("REFCHECKER_ENABLED", "false").lower() in {
    "1",
    "true",
    "yes",
    "on",
}
_REFCHECKER_MODEL = os.getenv("REFCHECKER_MODEL", "").strip()
_REFCHECKER_API_BASE = os.getenv("REFCHECKER_API_BASE", "").strip() or None
_REFCHECKER_TIMEOUT_SECONDS = max(
    int(os.getenv("REFCHECKER_TIMEOUT_SECONDS", "20")),
    1,
)
_REFCHECKER_BATCH_SIZE = max(int(os.getenv("REFCHECKER_BATCH_SIZE", "4")), 1)


@dataclass
class _ExtractedClaim:
    claim_id: str
    text: str
    sentence_ids: list[str]
    triplet: tuple[str, str, str] | None = None


def _clamp(value: float, minimum: float, maximum: float) -> float:
    return min(maximum, max(minimum, value))


def _safe_parse_datetime(value: str | None) -> datetime | None:
    if not value:
        return None

    try:
        normalized = value.replace("Z", "+00:00")
        parsed = datetime.fromisoformat(normalized)
        if parsed.tzinfo is None:
            return parsed.replace(tzinfo=UTC)
        return parsed.astimezone(UTC)
    except ValueError:
        return None


def _normalize_text(value: str) -> str:
    value = value.lower()
    value = re.sub(r"\s+", "", value)
    return re.sub(r"[^\w\u4e00-\u9fff]", "", value)


def _tokenize(value: str) -> list[str]:
    english_tokens = re.findall(r"[a-z0-9]+", value.lower())
    chinese_tokens = re.findall(r"[\u4e00-\u9fff]", value)
    return english_tokens + chinese_tokens


def _jaccard_similarity(left: str, right: str) -> float:
    left_tokens = set(_tokenize(left))
    right_tokens = set(_tokenize(right))
    if not left_tokens or not right_tokens:
        return 0.0

    intersection = left_tokens & right_tokens
    union = left_tokens | right_tokens
    return len(intersection) / max(1, len(union))


def _split_sentences(text: str) -> list[str]:
    parts = re.split(r"(?<=[。！？!?；;\.\n])\s*", text)
    return [part.strip() for part in parts if part and part.strip()]


def _extract_numbers(text: str) -> list[str]:
    return re.findall(r"\d+(?:\.\d+)?%?", text)


def _contains_any(text: str, markers: tuple[str, ...]) -> bool:
    lowered = text.lower()
    return any(marker in lowered for marker in markers)


def _build_refchecker_runtime() -> tuple[Any | None, Any | None]:
    if not _REFCHECKER_ENABLED or not _REFCHECKER_MODEL:
        return None, None

    try:
        refchecker = importlib.import_module("refchecker")
        extractor = refchecker.LLMExtractor(
            model=_REFCHECKER_MODEL,
            batch_size=_REFCHECKER_BATCH_SIZE,
            api_base=_REFCHECKER_API_BASE,
        )
        checker = refchecker.LLMChecker(
            model=_REFCHECKER_MODEL,
            batch_size=_REFCHECKER_BATCH_SIZE,
            api_base=_REFCHECKER_API_BASE,
        )
        return extractor, checker
    except Exception:
        return None, None


class ConfidenceAnalysisService:
    def __init__(self) -> None:
        self._extractor, self._checker = _build_refchecker_runtime()

    def check(self, request: ConfidenceCheckRequest) -> ConfidenceAnalysis:
        started_at = time.perf_counter()
        metrics_recorder.increment(
            "confidence_check_total",
            labels={"module": request.module},
        )

        try:
            if not request.referenceItems:
                return self._build_unavailable(
                    "No reference items were provided.",
                )

            if self._extractor is not None and self._checker is not None:
                analysis = self._run_refchecker(request)
            else:
                analysis = self._run_heuristic(request, partial=True)

            metrics_recorder.increment(
                "confidence_claims_total",
                value=analysis.claimCount,
                labels={"module": request.module},
            )
            for claim in analysis.claims:
                metrics_recorder.increment(
                    "confidence_label_total",
                    labels={"module": request.module, "label": claim.label},
                )

            return analysis
        except Exception as exc:  # noqa: BLE001
            metrics_recorder.increment(
                "confidence_check_failed_total",
                labels={"module": request.module},
            )
            return self._build_unavailable(
                f"Confidence analysis failed: {exc}",
            )
        finally:
            metrics_recorder.observe(
                "confidence_check_latency_ms",
                (time.perf_counter() - started_at) * 1000,
                labels={"module": request.module},
            )

    def check_batch(
        self,
        requests: list[ConfidenceCheckRequest],
    ) -> list[ConfidenceAnalysis]:
        return [self.check(request) for request in requests]

    def _run_refchecker(self, request: ConfidenceCheckRequest) -> ConfidenceAnalysis:
        try:
            extraction_results = self._extractor.extract(  # type: ignore[union-attr]
                batch_responses=[request.responseText],
                batch_questions=[request.question or ""],
                max_new_tokens=1000,
            )
            raw_claims = extraction_results[0].claims if extraction_results else []
        except Exception:
            return self._run_heuristic(request, partial=True)

        claims = [
            _ExtractedClaim(
                claim_id=f"claim-{index + 1}",
                text=(
                    claim.get_content()
                    if hasattr(claim, "get_content")
                    else str(claim)
                ),
                sentence_ids=list(getattr(claim, "attributed_sent_ids", [])),
                triplet=(
                    tuple(claim.content)
                    if getattr(claim, "format", None) == "triplet"
                    else None
                ),
            )
            for index, claim in enumerate(raw_claims)
        ]

        if not claims:
            return self._run_heuristic(request, partial=True)

        try:
            labels = self._checker.check(  # type: ignore[union-attr]
                batch_claims=[
                    [list(claim.triplet) if claim.triplet else claim.text for claim in claims]
                ],
                batch_references=[
                    "\n\n".join(item.excerpt for item in request.referenceItems)
                ],
                max_reference_segment_length=0,
            )[0]
        except Exception:
            return self._run_heuristic(request, partial=True)

        normalized_labels = []
        for label in labels:
            if label == "Entailment":
                normalized_labels.append("supported")
            elif label == "Contradiction":
                normalized_labels.append("contradicted")
            elif label == "Abstain":
                normalized_labels.append("abstain")
            else:
                normalized_labels.append("insufficient")

        return self._build_analysis(
            request=request,
            claims=claims,
            labels=normalized_labels,
            status="COMPLETE",
            notes=["RefChecker LLM pipeline was used."],
        )

    def _run_heuristic(
        self,
        request: ConfidenceCheckRequest,
        *,
        partial: bool,
    ) -> ConfidenceAnalysis:
        claims = [
            _ExtractedClaim(
                claim_id=f"claim-{index + 1}",
                text=sentence,
                sentence_ids=[str(index + 1)],
            )
            for index, sentence in enumerate(_split_sentences(request.responseText))
        ]

        if not claims:
            claims = [
                _ExtractedClaim(
                    claim_id="claim-1",
                    text=request.responseText.strip() or "No analyzable claim",
                    sentence_ids=[],
                )
            ]
            labels = ["abstain"]
        else:
            labels = [
                self._heuristic_label_for_claim(claim.text, request.referenceItems)
                for claim in claims
            ]

        return self._build_analysis(
            request=request,
            claims=claims,
            labels=labels,
            status="PARTIAL" if partial else "COMPLETE",
            notes=["Heuristic fallback was used."],
        )

    def _heuristic_label_for_claim(
        self,
        claim_text: str,
        reference_items: list[ConfidenceReferenceItem],
    ) -> str:
        normalized_claim = _normalize_text(claim_text)
        if not normalized_claim:
            return "abstain"

        best_overlap = 0.0
        best_reference: ConfidenceReferenceItem | None = None

        for item in reference_items:
            overlap = _jaccard_similarity(claim_text, item.excerpt)
            if normalized_claim in _normalize_text(item.excerpt):
                return "supported"
            if overlap > best_overlap:
                best_overlap = overlap
                best_reference = item

        if best_reference is None or best_overlap < 0.12:
            return "insufficient"

        if self._looks_contradicted(claim_text, best_reference.excerpt):
            return "contradicted"

        if best_overlap >= 0.45:
            return "supported"

        return "insufficient"

    def _looks_contradicted(self, claim_text: str, reference_text: str) -> bool:
        claim_numbers = _extract_numbers(claim_text)
        reference_numbers = _extract_numbers(reference_text)
        if (
            claim_numbers
            and reference_numbers
            and not set(claim_numbers) & set(reference_numbers)
        ):
            return True

        claim_negative = _contains_any(claim_text, _NEGATIVE_MARKERS)
        reference_negative = _contains_any(reference_text, _NEGATIVE_MARKERS)
        claim_positive = _contains_any(claim_text, _POSITIVE_MARKERS)
        reference_positive = _contains_any(reference_text, _POSITIVE_MARKERS)

        if claim_negative and reference_positive:
            return True
        if claim_positive and reference_negative:
            return True
        return False

    def _build_analysis(
        self,
        *,
        request: ConfidenceCheckRequest,
        claims: list[_ExtractedClaim],
        labels: list[str],
        status: str,
        notes: list[str],
    ) -> ConfidenceAnalysis:
        claim_analyses: list[ConfidenceClaimAnalysis] = []
        supported_count = 0
        insufficient_count = 0
        contradicted_count = 0
        abstain_count = 0

        for claim, label in zip(claims, labels, strict=False):
            matched_reference_ids = self._match_reference_ids(
                claim.text,
                request.referenceItems,
            )
            claim_analyses.append(
                ConfidenceClaimAnalysis(
                    claimId=claim.claim_id,
                    claimText=claim.text,
                    triplet=claim.triplet,
                    attributedSentenceIds=claim.sentence_ids,
                    matchedReferenceIds=matched_reference_ids,
                    label=label,
                    explanation=self._build_explanation(
                        label,
                        matched_reference_ids,
                    ),
                )
            )

            if label == "supported":
                supported_count += 1
            elif label == "contradicted":
                contradicted_count += 1
            elif label == "abstain":
                abstain_count += 1
            else:
                insufficient_count += 1

        claim_count = max(len(claims), 1)
        support_rate = supported_count / claim_count
        insufficient_rate = insufficient_count / claim_count
        contradiction_rate = contradicted_count / claim_count
        abstain_rate = abstain_count / claim_count

        freshness_adjust, freshness_score, freshness_note = (
            self._calculate_freshness(request.referenceItems)
        )
        source_adjust, source_diversity_score, source_note = (
            self._calculate_source_diversity(request.referenceItems)
        )

        base_score = (
            support_rate * 100
            - contradiction_rate * 60
            - insufficient_rate * 25
        )
        final_score = int(
            _clamp(round(base_score + freshness_adjust + source_adjust), 0, 100)
        )
        level = (
            "high"
            if final_score >= 75
            else "medium"
            if final_score >= 50
            else "low"
        )
        evidence_coverage_score = int(
            round(_clamp(support_rate * 100, 0, 100))
        )

        merged_notes = [*notes]
        if freshness_note:
            merged_notes.append(freshness_note)
        if source_note:
            merged_notes.append(source_note)

        return ConfidenceAnalysis(
            status=status,  # type: ignore[arg-type]
            finalScore=final_score,
            level=level,  # type: ignore[arg-type]
            claimCount=claim_count,
            supportedCount=supported_count,
            insufficientCount=insufficient_count,
            contradictedCount=contradicted_count,
            abstainCount=abstain_count,
            supportRate=round(support_rate, 4),
            insufficientRate=round(insufficient_rate, 4),
            contradictionRate=round(contradiction_rate, 4),
            abstainRate=round(abstain_rate, 4),
            evidenceCoverageScore=evidence_coverage_score,
            freshnessScore=freshness_score,
            sourceDiversityScore=source_diversity_score,
            notes=merged_notes,
            claims=claim_analyses,
        )

    def _match_reference_ids(
        self,
        claim_text: str,
        reference_items: list[ConfidenceReferenceItem],
    ) -> list[str]:
        ranked = sorted(
            (
                (item.id, _jaccard_similarity(claim_text, item.excerpt))
                for item in reference_items
            ),
            key=lambda item: item[1],
            reverse=True,
        )
        return [
            reference_id
            for reference_id, score in ranked[:2]
            if score >= 0.15
        ]

    def _build_explanation(
        self,
        label: str,
        matched_reference_ids: list[str],
    ) -> str:
        if label == "supported":
            return (
                f"Supported by references: {', '.join(matched_reference_ids)}"
                if matched_reference_ids
                else "Supported by the provided references."
            )
        if label == "contradicted":
            return "The claim conflicts with the strongest matching reference."
        if label == "abstain":
            return "No analyzable claim content was extracted."
        return "The provided references are insufficient to verify this claim."

    def _calculate_freshness(
        self,
        reference_items: list[ConfidenceReferenceItem],
    ) -> tuple[int, int, str | None]:
        dates = [
            parsed
            for parsed in (
                _safe_parse_datetime(item.publishedAt) for item in reference_items
            )
            if parsed is not None
        ]
        if not dates:
            return 0, 0, "Freshness could not be evaluated from the references."

        now = datetime.now(UTC)
        ages = [(now - item).days for item in dates]
        within_30 = sum(1 for age in ages if age <= 30)
        older_than_90 = sum(1 for age in ages if age > 90)
        total = len(ages)

        if within_30 / total >= 0.7:
            return 5, 100, "Most evidence is within 30 days."
        if older_than_90 / total >= 0.5:
            return -5, 30, "A large share of evidence is older than 90 days."
        return 0, 70, "Evidence freshness is mixed."

    def _calculate_source_diversity(
        self,
        reference_items: list[ConfidenceReferenceItem],
    ) -> tuple[int, int, str | None]:
        source_names = {
            item.sourceName.strip()
            for item in reference_items
            if item.sourceName.strip()
        }
        has_official = any(
            (item.sourceType or "").lower()
            in {"official", "announcement", "exchange"}
            or "official" in (item.sourceName or "").lower()
            for item in reference_items
        )

        if len(source_names) >= 2 and has_official:
            return 5, 100, "Multiple sources include at least one official source."
        if len(source_names) <= 1:
            return -5, 30, "Only a single source was available."
        return 0, 70, "Multiple sources were available without a clear official source."

    def _build_unavailable(self, note: str) -> ConfidenceAnalysis:
        return ConfidenceAnalysis(
            status="UNAVAILABLE",
            finalScore=None,
            level="unknown",
            claimCount=0,
            supportedCount=0,
            insufficientCount=0,
            contradictedCount=0,
            abstainCount=0,
            supportRate=0,
            insufficientRate=0,
            contradictionRate=0,
            abstainRate=0,
            evidenceCoverageScore=0,
            freshnessScore=0,
            sourceDiversityScore=0,
            notes=[note],
            claims=[],
        )
