import type {
  CompressedFindings,
  ResearchBriefV2,
  ResearchClarificationRequest,
  ResearchGapAnalysis,
  ResearchPreferenceInput,
  ResearchRuntimeConfig,
  ResearchTaskContract,
  ResearchUnitCapability,
  ResearchUnitPlan,
} from "~/server/domain/workflow/research";
import { buildQuickResearchTaskContract } from "~/server/domain/workflow/research";
import {
  compressedFindingsSchema,
  researchBriefSchema,
  researchClarificationRequestSchema,
  researchGapAnalysisSchema,
  researchTaskContractSchema,
  researchUnitPlanListSchema,
} from "~/server/domain/workflow/research-schemas";
import type {
  DeepSeekClient,
  DeepSeekMessage,
} from "~/server/infrastructure/intelligence/deepseek-client";

type ResearchSubject = "quick" | "company";

function uniqueStrings(items: string[], limit = 8) {
  return [...new Set(items.map((item) => item.trim()).filter(Boolean))].slice(
    0,
    limit,
  );
}

function compactText(value: string, maxLength = 320) {
  if (value.length <= maxLength) {
    return value;
  }

  return `${value.slice(0, maxLength)}...`;
}

function normalizeId(value: string, fallback: string) {
  const normalized = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return normalized || fallback;
}

function normalizeTaskContract(contract: ResearchTaskContract) {
  return {
    ...contract,
    requiredSources: uniqueStrings(contract.requiredSources, 8),
    requiredSections: uniqueStrings(contract.requiredSections, 12),
    deadlineMinutes: Math.min(24 * 60, Math.max(5, contract.deadlineMinutes)),
  } satisfies ResearchTaskContract;
}

function resolveReasoningModel(
  baseModel: string,
  taskContract?: ResearchTaskContract,
) {
  if (taskContract?.analysisDepth === "deep") {
    return "deepseek-reasoner";
  }

  return baseModel;
}

function resolveStructuredModel(
  baseModel: string,
  taskContract?: ResearchTaskContract,
  structuredModel?: string,
) {
  if (structuredModel) {
    return structuredModel;
  }

  return resolveReasoningModel(baseModel, taskContract);
}

function resolveOutputTokens(
  baseValue: number,
  taskContract?: ResearchTaskContract,
  multiplier = 1.45,
) {
  if (taskContract?.analysisDepth === "deep") {
    return Math.round(baseValue * multiplier);
  }

  return baseValue;
}

function roleForCapability(capability: ResearchUnitCapability) {
  switch (capability) {
    case "theme_overview":
      return "junior_researcher";
    case "market_heat":
      return "senior_analyst";
    case "candidate_screening":
      return "screening_analyst";
    case "credibility_lookup":
      return "validation_analyst";
    case "competition_synthesis":
      return "lead_analyst";
    case "official_search":
      return "official_collector";
    case "news_search":
      return "news_collector";
    case "industry_search":
      return "industry_collector";
    case "page_scrape":
      return "first_party_verifier";
    case "financial_pack":
      return "financial_collector";
    default:
      return "research_analyst";
  }
}

function artifactForCapability(capability: ResearchUnitCapability) {
  switch (capability) {
    case "theme_overview":
      return "trend_snapshot";
    case "market_heat":
      return "market_heat_assessment";
    case "candidate_screening":
      return "candidate_list";
    case "credibility_lookup":
      return "credibility_matrix";
    case "competition_synthesis":
      return "competition_summary";
    case "official_search":
      return "official_evidence_bundle";
    case "news_search":
      return "news_evidence_bundle";
    case "industry_search":
      return "industry_evidence_bundle";
    case "page_scrape":
      return "first_party_page_bundle";
    case "financial_pack":
      return "financial_evidence_bundle";
    default:
      return "research_artifact";
  }
}

function fallbackCapabilitiesFor(
  capability: ResearchUnitCapability,
): ResearchUnitCapability[] {
  switch (capability) {
    case "financial_pack":
      return ["official_search", "page_scrape", "news_search"];
    case "official_search":
      return ["page_scrape", "news_search"];
    case "news_search":
      return ["official_search", "industry_search"];
    case "industry_search":
      return ["news_search", "official_search"];
    case "page_scrape":
      return ["official_search", "news_search"];
    case "theme_overview":
      return ["market_heat"];
    case "market_heat":
      return ["theme_overview"];
    case "candidate_screening":
      return ["credibility_lookup"];
    case "credibility_lookup":
      return ["competition_synthesis"];
    case "competition_synthesis":
      return ["credibility_lookup"];
    default:
      return [];
  }
}

function acceptanceCriteriaFor(capability: ResearchUnitCapability) {
  switch (capability) {
    case "theme_overview":
      return [
        "Summarize the investable theme in one concise paragraph.",
        "Include at least one concrete catalyst or market context signal.",
      ];
    case "market_heat":
      return [
        "Return a bounded heat score and a short conclusion.",
        "Tie the score to observable news or market behavior.",
      ];
    case "candidate_screening":
      return [
        "Return at least one candidate when the topic is investable.",
        "Each candidate must include a concrete reason.",
      ];
    case "credibility_lookup":
      return [
        "Validate the top candidates against external evidence.",
        "Surface at least one supporting point or one risk per candidate.",
      ];
    case "competition_synthesis":
      return [
        "Rank candidate quality or industry positioning.",
        "Explain the comparison in investor-friendly language.",
      ];
    case "official_search":
      return [
        "Prefer first-party or near first-party disclosures.",
        "Return URLs that can support downstream citations.",
      ];
    case "news_search":
      return [
        "Return recent event evidence tied to catalysts or risks.",
        "Avoid purely repetitive or low-signal coverage.",
      ];
    case "industry_search":
      return [
        "Map competition or supply-chain position.",
        "Return evidence that helps answer strategic questions.",
      ];
    case "page_scrape":
      return [
        "Extract verifiable first-party facts from the page.",
        "Preserve the source URL for citation coverage.",
      ];
    case "financial_pack":
      return [
        "Return structured financial evidence when stock code exists.",
        "Explain data gaps explicitly when no pack is returned.",
      ];
    default:
      return ["Return a concise, valid artifact for downstream synthesis."];
  }
}

function withUnitMetadata(
  unit: ResearchUnitPlan,
  index: number,
): ResearchUnitPlan {
  return {
    ...unit,
    id: normalizeId(unit.id, `unit_${index + 1}`),
    title: unit.title.trim() || `Research unit ${index + 1}`,
    objective:
      unit.objective.trim() || unit.title.trim() || `Unit ${index + 1}`,
    keyQuestions: uniqueStrings(unit.keyQuestions ?? [], 4),
    dependsOn: uniqueStrings(unit.dependsOn ?? [], 4),
    priority: unit.priority ?? "medium",
    role: unit.role?.trim() || roleForCapability(unit.capability),
    expectedArtifact:
      unit.expectedArtifact?.trim() || artifactForCapability(unit.capability),
    fallbackCapabilities: uniqueStrings(
      unit.fallbackCapabilities ?? fallbackCapabilitiesFor(unit.capability),
      4,
    ).filter(
      (capability): capability is ResearchUnitCapability =>
        typeof capability === "string",
    ) as ResearchUnitCapability[],
    acceptanceCriteria: uniqueStrings(
      unit.acceptanceCriteria ?? acceptanceCriteriaFor(unit.capability),
      6,
    ),
  };
}

function buildMessages(
  system: string,
  userPayload: unknown,
): DeepSeekMessage[] {
  return [
    {
      role: "system",
      content: system,
    },
    {
      role: "user",
      content: JSON.stringify(userPayload, null, 2),
    },
  ];
}

function buildClarificationFallback(params: {
  subject: ResearchSubject;
  query: string;
  companyName?: string;
  focusConcepts?: string[];
  keyQuestion?: string;
  preferences?: ResearchPreferenceInput;
}) {
  const missingScopeFields: string[] = [];
  if (params.subject === "company" && !params.companyName?.trim()) {
    missingScopeFields.push("companyName");
  }
  if (params.subject === "quick" && params.query.trim().length < 2) {
    missingScopeFields.push("query");
  }
  if (
    params.subject === "company" &&
    (params.focusConcepts?.length ?? 0) === 0 &&
    !params.keyQuestion?.trim() &&
    !params.preferences?.researchGoal
  ) {
    missingScopeFields.push("researchGoal");
  }

  return {
    needClarification: missingScopeFields.length > 0,
    question:
      params.subject === "company"
        ? "Please clarify the single most important company research question, or give 1-3 focus concepts."
        : "Please narrow the research scope with a clearer theme, time window, or candidate direction.",
    verification:
      params.subject === "company"
        ? "Scope captured. I will turn it into a research brief before the company workflow continues."
        : "Scope captured. I will turn it into a research brief before the quick research workflow continues.",
    missingScopeFields,
    suggestedInputPatch:
      params.subject === "company"
        ? {
            focusConcepts: params.focusConcepts?.length
              ? params.focusConcepts
              : ["core_business", "profit_realization", "capex"],
          }
        : {},
  } satisfies ResearchClarificationRequest;
}

function buildBriefFallback(params: {
  subject: ResearchSubject;
  query: string;
  companyName?: string;
  stockCode?: string;
  officialWebsite?: string;
  focusConcepts?: string[];
  keyQuestion?: string;
  preferences?: ResearchPreferenceInput;
  clarificationSummary?: string;
}) {
  const focusConcepts = uniqueStrings(
    [
      ...(params.focusConcepts ?? []),
      ...(params.preferences?.preferredSources ?? []).slice(0, 1),
    ],
    5,
  );
  const keyQuestion =
    params.keyQuestion?.trim() ||
    params.preferences?.researchGoal?.trim() ||
    params.query;
  const mustAnswerQuestions = uniqueStrings(
    params.preferences?.mustAnswerQuestions ?? [],
    6,
  );

  return {
    query: params.query,
    companyName: params.companyName?.trim() || undefined,
    stockCode: params.stockCode?.trim() || undefined,
    officialWebsite: params.officialWebsite?.trim() || undefined,
    researchGoal:
      params.preferences?.researchGoal?.trim() ||
      (params.subject === "company"
        ? `Decide whether ${params.companyName ?? params.query} deserves deeper research.`
        : `Quickly assess the investability of ${params.query}.`),
    focusConcepts:
      focusConcepts.length > 0
        ? focusConcepts
        : params.subject === "company"
          ? ["business_model", "profit_realization", "industry_position"]
          : ["market_heat", "candidates", "credibility"],
    keyQuestions: uniqueStrings([keyQuestion], 5),
    mustAnswerQuestions:
      mustAnswerQuestions.length > 0 ? mustAnswerQuestions : [keyQuestion],
    forbiddenEvidenceTypes: uniqueStrings(
      params.preferences?.forbiddenEvidenceTypes ?? [],
      6,
    ),
    preferredSources: uniqueStrings(
      params.preferences?.preferredSources ?? [],
      6,
    ),
    freshnessWindowDays: params.preferences?.freshnessWindowDays ?? 180,
    scopeAssumptions:
      params.subject === "company"
        ? [
            "If first-party disclosure is missing, use high-confidence third-party evidence and mark the gap.",
          ]
        : [
            "If no narrow scope is provided, focus on the most investable angle in the supplied query.",
          ],
    clarificationSummary: params.clarificationSummary,
  } satisfies ResearchBriefV2;
}

function buildTaskContractFallback(params: {
  subject: ResearchSubject;
  preferences?: ResearchPreferenceInput;
  taskContract?: ResearchTaskContract;
}) {
  if (params.taskContract) {
    return normalizeTaskContract(params.taskContract);
  }

  if (params.subject === "company") {
    return {
      requiredSources: ["official", "financial", "news", "industry"],
      requiredSections: [
        "research_brief",
        "evidence_summary",
        "findings",
        "verdict",
        "risks",
      ],
      citationRequired: true,
      analysisDepth: "deep" as const,
      deadlineMinutes: 90,
    } satisfies ResearchTaskContract;
  }

  return buildQuickResearchTaskContract();
}

function buildUnitPlanFallback(params: {
  subject: ResearchSubject;
  brief: ResearchBriefV2;
  allowedCapabilities: ResearchUnitCapability[];
  maxUnitsPerPlan: number;
}) {
  if (params.subject === "quick") {
    const units: ResearchUnitPlan[] = [
      {
        id: "theme_overview",
        title: "Theme overview",
        objective: `Summarize the current market context for ${params.brief.query}.`,
        keyQuestions: params.brief.mustAnswerQuestions.slice(0, 2),
        priority: "high",
        capability: "theme_overview",
        dependsOn: [],
        role: "junior_researcher",
        expectedArtifact: "trend_snapshot",
        fallbackCapabilities: ["market_heat"],
        acceptanceCriteria: acceptanceCriteriaFor("theme_overview"),
      },
      {
        id: "market_heat",
        title: "Market heat",
        objective: `Measure the latest heat and momentum around ${params.brief.query}.`,
        keyQuestions: params.brief.mustAnswerQuestions.slice(0, 2),
        priority: "high",
        capability: "market_heat",
        dependsOn: ["theme_overview"],
        role: "senior_analyst",
        expectedArtifact: "market_heat_assessment",
        fallbackCapabilities: ["theme_overview"],
        acceptanceCriteria: acceptanceCriteriaFor("market_heat"),
      },
      {
        id: "candidate_screening",
        title: "Candidate screening",
        objective: "Screen a small list of candidates connected to the topic.",
        keyQuestions: params.brief.mustAnswerQuestions.slice(0, 2),
        priority: "high",
        capability: "candidate_screening",
        dependsOn: ["market_heat"],
        role: "screening_analyst",
        expectedArtifact: "candidate_list",
        fallbackCapabilities: ["credibility_lookup"],
        acceptanceCriteria: acceptanceCriteriaFor("candidate_screening"),
      },
      {
        id: "credibility_lookup",
        title: "Credibility lookup",
        objective: "Validate catalysts and risks for the screened candidates.",
        keyQuestions: params.brief.mustAnswerQuestions.slice(0, 2),
        priority: "medium",
        capability: "credibility_lookup",
        dependsOn: ["candidate_screening"],
        role: "validation_analyst",
        expectedArtifact: "credibility_matrix",
        fallbackCapabilities: ["competition_synthesis"],
        acceptanceCriteria: acceptanceCriteriaFor("credibility_lookup"),
      },
      {
        id: "competition_synthesis",
        title: "Competition synthesis",
        objective: "Summarize competition intensity and ranking of candidates.",
        keyQuestions: params.brief.mustAnswerQuestions.slice(0, 2),
        priority: "medium",
        capability: "competition_synthesis",
        dependsOn: ["credibility_lookup"],
        role: "lead_analyst",
        expectedArtifact: "competition_summary",
        fallbackCapabilities: ["credibility_lookup"],
        acceptanceCriteria: acceptanceCriteriaFor("competition_synthesis"),
      },
    ];

    return units
      .filter((unit) => params.allowedCapabilities.includes(unit.capability))
      .slice(0, params.maxUnitsPerPlan)
      .map(withUnitMetadata);
  }

  const companyName = params.brief.companyName ?? params.brief.query;
  const defaultUnits: ResearchUnitPlan[] = [
    {
      id: "business_model",
      title: "Business model",
      objective: `Clarify ${companyName}'s business model and commercial drivers.`,
      keyQuestions: params.brief.mustAnswerQuestions.slice(0, 2),
      priority: "high",
      capability: "official_search",
      dependsOn: [],
      role: "official_collector",
      expectedArtifact: "official_evidence_bundle",
      fallbackCapabilities: ["page_scrape", "news_search"],
      acceptanceCriteria: acceptanceCriteriaFor("official_search"),
    },
    {
      id: "financial_quality",
      title: "Financial quality",
      objective: `Check whether ${companyName}'s growth is translating into revenue or profit.`,
      keyQuestions: params.brief.mustAnswerQuestions.slice(0, 2),
      priority: "high",
      capability: "financial_pack",
      dependsOn: [],
      role: "financial_collector",
      expectedArtifact: "financial_evidence_bundle",
      fallbackCapabilities: ["official_search", "page_scrape"],
      acceptanceCriteria: acceptanceCriteriaFor("financial_pack"),
    },
    {
      id: "recent_events",
      title: "Recent events",
      objective: `Review recent announcements and catalysts related to ${companyName}.`,
      keyQuestions: params.brief.mustAnswerQuestions.slice(0, 2),
      priority: "medium",
      capability: "news_search",
      dependsOn: [],
      role: "news_collector",
      expectedArtifact: "news_evidence_bundle",
      fallbackCapabilities: ["official_search", "industry_search"],
      acceptanceCriteria: acceptanceCriteriaFor("news_search"),
    },
    {
      id: "industry_landscape",
      title: "Industry landscape",
      objective: `Map the competitive landscape around ${companyName}.`,
      keyQuestions: params.brief.mustAnswerQuestions.slice(0, 2),
      priority: "medium",
      capability: "industry_search",
      dependsOn: [],
      role: "industry_collector",
      expectedArtifact: "industry_evidence_bundle",
      fallbackCapabilities: ["news_search", "official_search"],
      acceptanceCriteria: acceptanceCriteriaFor("industry_search"),
    },
    {
      id: "first_party_pages",
      title: "First-party pages",
      objective: `Pull first-party pages for ${companyName} to confirm investor-facing claims.`,
      keyQuestions: params.brief.mustAnswerQuestions.slice(0, 2),
      priority: "medium",
      capability: "page_scrape",
      dependsOn: ["business_model"],
      role: "first_party_verifier",
      expectedArtifact: "first_party_page_bundle",
      fallbackCapabilities: ["official_search", "news_search"],
      acceptanceCriteria: acceptanceCriteriaFor("page_scrape"),
    },
  ];

  return defaultUnits
    .filter((unit) => params.allowedCapabilities.includes(unit.capability))
    .slice(0, params.maxUnitsPerPlan)
    .map(withUnitMetadata);
}

function buildGapFallback(params: {
  gapIteration: number;
  maxGapIterations: number;
  compressedFindings?: CompressedFindings;
  allowedCapabilities: ResearchUnitCapability[];
}) {
  const openQuestions = params.compressedFindings?.openQuestions ?? [];
  const requiresFollowup =
    params.gapIteration < params.maxGapIterations && openQuestions.length > 0;
  const fallbackCapability =
    params.allowedCapabilities.find((capability) =>
      capability.includes("search"),
    ) ??
    params.allowedCapabilities[0] ??
    "news_search";
  const followupUnits = requiresFollowup
    ? openQuestions.slice(0, 2).map((question, index) =>
        withUnitMetadata(
          {
            id: `followup_${params.gapIteration + 1}_${index + 1}`,
            title: `Follow-up ${index + 1}`,
            objective: compactText(question, 120),
            keyQuestions: [question],
            priority: "medium",
            capability: fallbackCapability,
            dependsOn: [],
            role: roleForCapability(fallbackCapability),
            expectedArtifact: artifactForCapability(fallbackCapability),
            fallbackCapabilities: fallbackCapabilitiesFor(fallbackCapability),
            acceptanceCriteria: acceptanceCriteriaFor(fallbackCapability),
          },
          index,
        ),
      )
    : [];

  return {
    requiresFollowup,
    summary: requiresFollowup
      ? "Some important questions remain under-supported and need a bounded follow-up search."
      : "Current evidence is sufficient for synthesis at this iteration.",
    missingAreas: openQuestions.slice(0, 4),
    followupUnits,
    iteration: params.gapIteration,
  } satisfies ResearchGapAnalysis;
}

function buildCompressionFallback(params: {
  brief: ResearchBriefV2;
  noteSummaries: string[];
  gapAnalysis?: ResearchGapAnalysis;
}) {
  return {
    summary: compactText(
      [params.brief.researchGoal, ...params.noteSummaries].join(" "),
      420,
    ),
    highlights: uniqueStrings(params.noteSummaries, 6),
    openQuestions: uniqueStrings(params.gapAnalysis?.missingAreas ?? [], 6),
    noteIds: [],
  } satisfies CompressedFindings;
}

export function buildDefaultTaskContract(params: {
  subject: ResearchSubject;
  preferences?: ResearchPreferenceInput;
  taskContract?: ResearchTaskContract;
}) {
  return buildTaskContractFallback(params);
}

export async function clarifyResearchScope(params: {
  client: DeepSeekClient;
  subject: ResearchSubject;
  query: string;
  companyName?: string;
  focusConcepts?: string[];
  keyQuestion?: string;
  preferences?: ResearchPreferenceInput;
  runtimeConfig: ResearchRuntimeConfig;
}) {
  const fallback = buildClarificationFallback(params);
  if (!params.runtimeConfig.allowClarification) {
    return {
      ...fallback,
      needClarification: false,
    } satisfies ResearchClarificationRequest;
  }

  return params.client.completeContract<ResearchClarificationRequest>(
    buildMessages(
      "You decide whether the research scope is specific enough to begin. Return JSON only. Ask for clarification only when missing information would materially degrade research quality.",
      {
        subject: params.subject,
        query: params.query,
        companyName: params.companyName,
        focusConcepts: params.focusConcepts,
        keyQuestion: params.keyQuestion,
        preferences: params.preferences,
      },
    ),
    fallback,
    researchClarificationRequestSchema,
    {
      model: params.runtimeConfig.models.clarification,
      maxOutputTokens: 1200,
      budgetPolicy: {
        maxRetries: 2,
        truncateStrategy: ["drop_low_priority", "trim_messages"],
        prioritySections: ["query", "companyName", "preferences"],
      },
      maxStructuredOutputRetries: 1,
    },
  );
}

export async function writeTaskContract(params: {
  client: DeepSeekClient;
  subject: ResearchSubject;
  preferences?: ResearchPreferenceInput;
  taskContract?: ResearchTaskContract;
  runtimeConfig: ResearchRuntimeConfig;
  structuredModel?: string;
}) {
  const fallback = buildTaskContractFallback(params);

  return params.client.completeContract<ResearchTaskContract>(
    buildMessages(
      "Convert the request into a bounded task contract for a research workflow. Return valid JSON only. Keep the contract minimal, enforceable, and investor-oriented.",
      {
        subject: params.subject,
        preferences: params.preferences,
        taskContract: params.taskContract,
      },
    ),
    fallback,
    researchTaskContractSchema,
    {
      model: resolveStructuredModel(
        params.runtimeConfig.models.planning,
        fallback,
        params.structuredModel,
      ),
      maxOutputTokens: resolveOutputTokens(900, fallback, 1.3),
      budgetPolicy: {
        maxRetries: 1,
        truncateStrategy: ["drop_low_priority", "trim_messages"],
        prioritySections: ["preferences", "taskContract"],
      },
      maxStructuredOutputRetries: 2,
    },
  );
}

export async function writeResearchBrief(params: {
  client: DeepSeekClient;
  subject: ResearchSubject;
  query: string;
  companyName?: string;
  stockCode?: string;
  officialWebsite?: string;
  focusConcepts?: string[];
  keyQuestion?: string;
  preferences?: ResearchPreferenceInput;
  taskContract?: ResearchTaskContract;
  clarificationSummary?: string;
  runtimeConfig: ResearchRuntimeConfig;
  structuredModel?: string;
}) {
  const fallback = buildBriefFallback(params);
  const effectiveContract = buildTaskContractFallback({
    subject: params.subject,
    preferences: params.preferences,
    taskContract: params.taskContract,
  });

  return params.client.completeContract<ResearchBriefV2>(
    buildMessages(
      "Convert the research request into a structured research brief. Return valid JSON only. Keep fields concise and investor-focused.",
      {
        subject: params.subject,
        query: params.query,
        companyName: params.companyName,
        stockCode: params.stockCode,
        officialWebsite: params.officialWebsite,
        focusConcepts: params.focusConcepts,
        keyQuestion: params.keyQuestion,
        preferences: params.preferences,
        taskContract: effectiveContract,
        clarificationSummary: params.clarificationSummary,
      },
    ),
    fallback,
    researchBriefSchema,
    {
      model: resolveStructuredModel(
        params.runtimeConfig.models.planning,
        effectiveContract,
        params.structuredModel,
      ),
      maxOutputTokens: resolveOutputTokens(2000, effectiveContract),
      budgetPolicy: {
        maxRetries: 2,
        truncateStrategy: ["drop_low_priority", "trim_messages"],
        prioritySections: [
          "query",
          "preferences",
          "taskContract",
          "clarificationSummary",
        ],
      },
      maxStructuredOutputRetries: 2,
    },
  );
}

export async function planResearchUnits(params: {
  client: DeepSeekClient;
  subject: ResearchSubject;
  brief: ResearchBriefV2;
  taskContract?: ResearchTaskContract;
  allowedCapabilities: ResearchUnitCapability[];
  runtimeConfig: ResearchRuntimeConfig;
  structuredModel?: string;
}) {
  const effectiveContract = buildTaskContractFallback({
    subject: params.subject,
    taskContract: params.taskContract,
  });
  const fallback = buildUnitPlanFallback({
    subject: params.subject,
    brief: params.brief,
    allowedCapabilities: params.allowedCapabilities,
    maxUnitsPerPlan: params.runtimeConfig.maxUnitsPerPlan,
  });

  const planned = await params.client.completeContract<ResearchUnitPlan[]>(
    buildMessages(
      "Plan research units for the supplied brief. Return JSON only. Use only the allowed capability values. Keep the number of units bounded, assign a role, expected artifact, fallback capabilities, and acceptance criteria for each unit.",
      {
        subject: params.subject,
        brief: params.brief,
        taskContract: effectiveContract,
        allowedCapabilities: params.allowedCapabilities,
        maxUnitsPerPlan: params.runtimeConfig.maxUnitsPerPlan,
      },
    ),
    fallback,
    researchUnitPlanListSchema,
    {
      model: resolveStructuredModel(
        params.runtimeConfig.models.planning,
        effectiveContract,
        params.structuredModel,
      ),
      maxOutputTokens: resolveOutputTokens(2400, effectiveContract),
      budgetPolicy: {
        maxRetries: 2,
        truncateStrategy: ["drop_low_priority", "trim_messages"],
        prioritySections: ["brief", "taskContract", "allowedCapabilities"],
      },
      maxStructuredOutputRetries: 2,
    },
  );

  return planned
    .filter((unit) => params.allowedCapabilities.includes(unit.capability))
    .slice(0, params.runtimeConfig.maxUnitsPerPlan)
    .map(withUnitMetadata);
}

export async function analyzeResearchGaps(params: {
  client: DeepSeekClient;
  brief: ResearchBriefV2;
  taskContract?: ResearchTaskContract;
  compressedFindings?: CompressedFindings;
  gapIteration: number;
  runtimeConfig: ResearchRuntimeConfig;
  allowedCapabilities: ResearchUnitCapability[];
  structuredModel?: string;
}) {
  const effectiveContract = buildTaskContractFallback({
    subject: params.brief.companyName ? "company" : "quick",
    taskContract: params.taskContract,
  });
  const fallback = buildGapFallback({
    gapIteration: params.gapIteration,
    maxGapIterations: params.runtimeConfig.maxGapIterations,
    compressedFindings: params.compressedFindings,
    allowedCapabilities: params.allowedCapabilities,
  });

  const gap = await params.client.completeContract<ResearchGapAnalysis>(
    buildMessages(
      "Assess whether the research still has material gaps. Return JSON only. Generate at most two follow-up units and only if the gaps are material.",
      {
        brief: params.brief,
        taskContract: effectiveContract,
        compressedFindings: params.compressedFindings,
        gapIteration: params.gapIteration,
        maxGapIterations: params.runtimeConfig.maxGapIterations,
        allowedCapabilities: params.allowedCapabilities,
      },
    ),
    fallback,
    researchGapAnalysisSchema,
    {
      model: resolveStructuredModel(
        params.runtimeConfig.models.planning,
        effectiveContract,
        params.structuredModel,
      ),
      maxOutputTokens: resolveOutputTokens(1800, effectiveContract, 1.35),
      budgetPolicy: {
        maxRetries: 1,
        truncateStrategy: ["drop_low_priority", "keep_tail", "trim_messages"],
        prioritySections: [
          "taskContract",
          "compressedFindings",
          "missingAreas",
        ],
      },
      maxStructuredOutputRetries: 2,
    },
  );

  return {
    ...gap,
    requiresFollowup:
      gap.requiresFollowup &&
      params.gapIteration < params.runtimeConfig.maxGapIterations &&
      gap.followupUnits.length > 0,
    followupUnits: gap.followupUnits
      .filter((unit) => params.allowedCapabilities.includes(unit.capability))
      .slice(0, 2)
      .map((unit, index) =>
        withUnitMetadata(
          {
            ...unit,
            id: normalizeId(
              unit.id,
              `followup_${params.gapIteration + 1}_${index + 1}`,
            ),
            title: unit.title.trim() || `Follow-up ${index + 1}`,
            objective:
              unit.objective.trim() ||
              unit.title.trim() ||
              "Follow-up research",
          },
          index,
        ),
      ),
  } satisfies ResearchGapAnalysis;
}

export async function compressResearchFindings(params: {
  client: DeepSeekClient;
  brief: ResearchBriefV2;
  taskContract?: ResearchTaskContract;
  noteSummaries: string[];
  gapAnalysis?: ResearchGapAnalysis;
  runtimeConfig: ResearchRuntimeConfig;
  structuredModel?: string;
}) {
  const effectiveContract = buildTaskContractFallback({
    subject: params.brief.companyName ? "company" : "quick",
    taskContract: params.taskContract,
  });
  const fallback = buildCompressionFallback(params);

  return params.client.completeContract<CompressedFindings>(
    buildMessages(
      "Compress the research notes into a synthesis payload for downstream report generation. Return JSON only.",
      {
        brief: params.brief,
        taskContract: effectiveContract,
        noteSummaries: params.noteSummaries,
        gapAnalysis: params.gapAnalysis,
      },
    ),
    fallback,
    compressedFindingsSchema,
    {
      model: resolveStructuredModel(
        params.runtimeConfig.models.compression,
        effectiveContract,
        params.structuredModel,
      ),
      maxOutputTokens: resolveOutputTokens(1800, effectiveContract, 1.35),
      budgetPolicy: {
        maxRetries: 2,
        contextLimitHint: params.runtimeConfig.maxNotesCharsForCompression,
        truncateStrategy: ["drop_low_priority", "keep_tail", "trim_messages"],
        prioritySections: [
          "brief",
          "taskContract",
          "noteSummaries",
          "gapAnalysis",
        ],
      },
      maxStructuredOutputRetries: 2,
    },
  );
}
