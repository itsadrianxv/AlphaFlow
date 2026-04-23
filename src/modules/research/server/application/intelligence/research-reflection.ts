import type {
  ResearchReflectionResult,
  ResearchTaskContract,
} from "~/modules/research/server/domain/workflow/research";
import type {
  CompanyResearchResultDto,
  QuickResearchResultDto,
} from "~/modules/research/server/domain/workflow/types";

function coverageRatio(hitCount: number, totalCount: number) {
  if (totalCount <= 0) {
    return 1;
  }

  return Math.max(0, Math.min(1, hitCount / totalCount));
}

function uniqueStrings(items: Array<string | undefined>, limit = 16) {
  return [
    ...new Set(items.map((item) => item?.trim()).filter(Boolean) as string[]),
  ].slice(0, limit);
}

function sectionCoverage(
  requiredSections: string[],
  availableSections: string[],
) {
  const available = new Set(availableSections);
  const missing = requiredSections.filter((section) => !available.has(section));
  return {
    missing,
    coverage: coverageRatio(
      requiredSections.length - missing.length,
      requiredSections.length,
    ),
  };
}

function toStatus(
  score: number,
  flagCount: number,
): ResearchReflectionResult["status"] {
  if (score >= 85 && flagCount === 0) {
    return "pass";
  }
  if (score >= 60) {
    return "warn";
  }
  return "fail";
}

export function reflectQuickResearch(params: {
  taskContract: ResearchTaskContract;
  result: QuickResearchResultDto;
}) {
  const availableSections = [
    "research_spec",
    "trend_analysis",
    "candidate_screening",
    "competition",
    params.result.topPicks.length > 0 ? "top_picks" : undefined,
  ].filter((item): item is string => Boolean(item));
  const sectionResult = sectionCoverage(
    params.taskContract.requiredSections,
    availableSections,
  );
  const unansweredQuestions =
    params.result.compressedFindings?.openQuestions ?? [];
  const answeredQuestionCoverage = coverageRatio(
    Math.max(
      0,
      (params.result.brief?.mustAnswerQuestions.length ?? 0) -
        unansweredQuestions.length,
    ),
    params.result.brief?.mustAnswerQuestions.length ?? 0,
  );
  const citationCoverage = params.taskContract.citationRequired
    ? 0
    : params.result.credibility.length > 0
      ? 0.4
      : 0;
  const firstPartyRatio = 0;
  const qualityFlags = uniqueStrings([
    sectionResult.missing.length > 0 ? "missing_required_sections" : undefined,
    unansweredQuestions.length > 0 ? "open_questions_remaining" : undefined,
    params.taskContract.citationRequired ? "citation_coverage_low" : undefined,
  ]);
  const contractScore = Math.round(
    sectionResult.coverage * 35 +
      answeredQuestionCoverage * 35 +
      citationCoverage * 20 +
      firstPartyRatio * 10,
  );
  const missingRequirements = uniqueStrings([
    ...sectionResult.missing.map((section) => `missing_section:${section}`),
    ...(params.taskContract.citationRequired
      ? ["citation_coverage_below_target"]
      : []),
  ]);

  return {
    status: toStatus(contractScore, qualityFlags.length),
    summary:
      qualityFlags.length > 0
        ? "Quick research completed with quality warnings that should be reviewed before reuse."
        : "Quick research satisfies the default contract checks.",
    contractScore,
    citationCoverage,
    firstPartyRatio,
    answeredQuestionCoverage,
    missingRequirements,
    unansweredQuestions,
    qualityFlags,
    suggestedFixes: uniqueStrings([
      unansweredQuestions.length > 0
        ? "Run a focused follow-up on the remaining open questions."
        : undefined,
      params.taskContract.citationRequired
        ? "Add external evidence with traceable citations before external sharing."
        : undefined,
    ]),
  } satisfies ResearchReflectionResult;
}

export function reflectCompanyResearch(params: {
  taskContract: ResearchTaskContract;
  result: CompanyResearchResultDto;
}) {
  const availableSections = [
    "research_brief",
    "evidence_summary",
    params.result.findings.length > 0 ? "findings" : undefined,
    params.result.verdict.summary ? "verdict" : undefined,
    params.result.verdict.bearPoints.length > 0 ? "risks" : undefined,
  ].filter((item): item is string => Boolean(item));
  const sectionResult = sectionCoverage(
    params.taskContract.requiredSections,
    availableSections,
  );
  const unansweredQuestions = uniqueStrings(
    params.result.findings
      .filter((item) => item.gaps.length > 0)
      .map((item) => item.question),
  );
  const answeredQuestionCoverage = coverageRatio(
    params.result.findings.filter((item) => item.gaps.length === 0).length,
    params.result.findings.length,
  );
  const citationCoverage = coverageRatio(
    params.result.findings.filter((item) => item.referenceIds.length > 0)
      .length,
    params.result.findings.length,
  );
  const firstPartyRatio = coverageRatio(
    params.result.collectionSummary.totalFirstPartyCount,
    params.result.collectionSummary.totalReferenceCount,
  );
  const qualityFlags = uniqueStrings([
    sectionResult.missing.length > 0 ? "missing_required_sections" : undefined,
    citationCoverage < 0.6 ? "citation_coverage_low" : undefined,
    firstPartyRatio < 0.25 ? "first_party_ratio_low" : undefined,
    unansweredQuestions.length > 0 ? "open_questions_remaining" : undefined,
  ]);
  const contractScore = Math.round(
    sectionResult.coverage * 30 +
      answeredQuestionCoverage * 25 +
      citationCoverage * 25 +
      firstPartyRatio * 20,
  );
  const missingRequirements = uniqueStrings([
    ...sectionResult.missing.map((section) => `missing_section:${section}`),
    citationCoverage < 0.6 ? "citation_coverage_below_target" : undefined,
    firstPartyRatio < 0.25 ? "first_party_ratio_below_target" : undefined,
  ]);

  return {
    status: toStatus(contractScore, qualityFlags.length),
    summary:
      qualityFlags.length > 0
        ? "Company research completed with quality warnings around coverage or sourcing."
        : "Company research satisfies the default contract checks.",
    contractScore,
    citationCoverage,
    firstPartyRatio,
    answeredQuestionCoverage,
    missingRequirements,
    unansweredQuestions,
    qualityFlags,
    suggestedFixes: uniqueStrings([
      unansweredQuestions.length > 0
        ? "Run a focused follow-up on unanswered company questions."
        : undefined,
      citationCoverage < 0.6
        ? "Add references for unsupported findings before external sharing."
        : undefined,
      firstPartyRatio < 0.25
        ? "Collect more first-party evidence from official disclosures or IR pages."
        : undefined,
    ]),
  } satisfies ResearchReflectionResult;
}
