import type {
  CompressedFindings,
  ResearchBriefV2,
  ResearchClarificationRequest,
  ResearchGapAnalysis,
  ResearchPreferenceInput,
  ResearchRuntimeConfig,
  ResearchUnitCapability,
  ResearchUnitPlan,
} from "~/server/domain/workflow/research";
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

  const needClarification = missingScopeFields.length > 0;
  const question =
    params.subject === "company"
      ? "请补充这次公司研究最想验证的核心问题，或给出 1-3 个重点概念。"
      : "请补充更具体的研究范围，例如想看的赛道、时间窗口或候选方向。";
  const verification =
    params.subject === "company"
      ? "已收到范围信息，我会先整理研究 brief，再进入公司研究。"
      : "已收到范围信息，我会先整理研究 brief，再进入主题研究。";

  return {
    needClarification,
    question,
    verification,
    missingScopeFields,
    suggestedInputPatch:
      params.subject === "company"
        ? {
            focusConcepts: params.focusConcepts?.length
              ? params.focusConcepts
              : ["核心业务", "利润兑现", "资本开支"],
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
        ? `判断 ${params.companyName ?? params.query} 是否值得进一步研究`
        : `快速梳理 ${params.query} 的研究优先级`),
    focusConcepts:
      focusConcepts.length > 0
        ? focusConcepts
        : params.subject === "company"
          ? ["业务模式", "利润兑现", "行业格局"]
          : ["市场热度", "候选标的", "可信度"],
    keyQuestions: uniqueStrings([keyQuestion], 5),
    mustAnswerQuestions:
      mustAnswerQuestions.length > 0 ? mustAnswerQuestions : [keyQuestion],
    forbiddenEvidenceTypes: uniqueStrings(
      params.preferences?.forbiddenEvidenceTypes ?? [],
      6,
    ),
    preferredSources: uniqueStrings(params.preferences?.preferredSources ?? [], 6),
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
      },
      {
        id: "market_heat",
        title: "Market heat",
        objective: `Measure the latest heat and momentum around ${params.brief.query}.`,
        keyQuestions: params.brief.mustAnswerQuestions.slice(0, 2),
        priority: "high",
        capability: "market_heat",
        dependsOn: ["theme_overview"],
      },
      {
        id: "candidate_screening",
        title: "Candidate screening",
        objective: "Screen a small list of candidates connected to the topic.",
        keyQuestions: params.brief.mustAnswerQuestions.slice(0, 2),
        priority: "high",
        capability: "candidate_screening",
        dependsOn: ["market_heat"],
      },
      {
        id: "credibility_lookup",
        title: "Credibility lookup",
        objective: "Validate catalysts and risks for the screened candidates.",
        keyQuestions: params.brief.mustAnswerQuestions.slice(0, 2),
        priority: "medium",
        capability: "credibility_lookup",
        dependsOn: ["candidate_screening"],
      },
      {
        id: "competition_synthesis",
        title: "Competition synthesis",
        objective: "Summarize competition intensity and ranking of candidates.",
        keyQuestions: params.brief.mustAnswerQuestions.slice(0, 2),
        priority: "medium",
        capability: "competition_synthesis",
        dependsOn: ["credibility_lookup"],
      },
    ];

    return units
      .filter((unit) => params.allowedCapabilities.includes(unit.capability))
      .slice(0, params.maxUnitsPerPlan);
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
    },
    {
      id: "financial_quality",
      title: "Financial quality",
      objective: `Check whether ${companyName}'s growth is translating into revenue or profit.`,
      keyQuestions: params.brief.mustAnswerQuestions.slice(0, 2),
      priority: "high",
      capability: "financial_pack",
      dependsOn: [],
    },
    {
      id: "recent_events",
      title: "Recent events",
      objective: `Review recent announcements and catalysts related to ${companyName}.`,
      keyQuestions: params.brief.mustAnswerQuestions.slice(0, 2),
      priority: "medium",
      capability: "news_search",
      dependsOn: [],
    },
    {
      id: "industry_landscape",
      title: "Industry landscape",
      objective: `Map the competitive landscape around ${companyName}.`,
      keyQuestions: params.brief.mustAnswerQuestions.slice(0, 2),
      priority: "medium",
      capability: "industry_search",
      dependsOn: [],
    },
    {
      id: "first_party_pages",
      title: "First-party pages",
      objective: `Pull first-party pages for ${companyName} to confirm investor-facing claims.`,
      keyQuestions: params.brief.mustAnswerQuestions.slice(0, 2),
      priority: "medium",
      capability: "page_scrape",
      dependsOn: ["business_model"],
    },
  ];

  return defaultUnits
    .filter((unit) => params.allowedCapabilities.includes(unit.capability))
    .slice(0, params.maxUnitsPerPlan);
}

function buildGapFallback(params: {
  brief: ResearchBriefV2;
  gapIteration: number;
  maxGapIterations: number;
  compressedFindings?: CompressedFindings;
  allowedCapabilities: ResearchUnitCapability[];
}) {
  const openQuestions = params.compressedFindings?.openQuestions ?? [];
  const requiresFollowup =
    params.gapIteration < params.maxGapIterations && openQuestions.length > 0;
  const followupUnits = requiresFollowup
    ? openQuestions.slice(0, 2).map((question, index) => ({
        id: `followup_${params.gapIteration + 1}_${index + 1}`,
        title: `Follow-up ${index + 1}`,
        objective: compactText(question, 120),
        keyQuestions: [question],
        priority: "medium" as const,
        capability:
          params.allowedCapabilities.find((capability) =>
            capability.includes("search"),
          ) ?? params.allowedCapabilities[0] ?? "news_search",
        dependsOn: [],
      }))
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

function buildMessages(system: string, userPayload: unknown): DeepSeekMessage[] {
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

  return params.client.completeJson<ResearchClarificationRequest>(
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
  clarificationSummary?: string;
  runtimeConfig: ResearchRuntimeConfig;
}) {
  const fallback = buildBriefFallback(params);

  return params.client.completeJson<ResearchBriefV2>(
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
        clarificationSummary: params.clarificationSummary,
      },
    ),
    fallback,
    {
      model: params.runtimeConfig.models.planning,
      maxOutputTokens: 2000,
      budgetPolicy: {
        maxRetries: 2,
        truncateStrategy: ["drop_low_priority", "trim_messages"],
        prioritySections: ["query", "preferences", "clarificationSummary"],
      },
      maxStructuredOutputRetries: 1,
    },
  );
}

export async function planResearchUnits(params: {
  client: DeepSeekClient;
  subject: ResearchSubject;
  brief: ResearchBriefV2;
  allowedCapabilities: ResearchUnitCapability[];
  runtimeConfig: ResearchRuntimeConfig;
}) {
  const fallback = buildUnitPlanFallback({
    subject: params.subject,
    brief: params.brief,
    allowedCapabilities: params.allowedCapabilities,
    maxUnitsPerPlan: params.runtimeConfig.maxUnitsPerPlan,
  });

  const planned = await params.client.completeJson<ResearchUnitPlan[]>(
    buildMessages(
      "Plan research units for the supplied brief. Return JSON only. Use only the allowed capability values. Keep the number of units bounded and avoid duplicates.",
      {
        subject: params.subject,
        brief: params.brief,
        allowedCapabilities: params.allowedCapabilities,
        maxUnitsPerPlan: params.runtimeConfig.maxUnitsPerPlan,
      },
    ),
    fallback,
    {
      model: params.runtimeConfig.models.planning,
      maxOutputTokens: 2200,
      budgetPolicy: {
        maxRetries: 2,
        truncateStrategy: ["drop_low_priority", "trim_messages"],
        prioritySections: ["brief", "allowedCapabilities"],
      },
      maxStructuredOutputRetries: 1,
    },
  );

  return planned
    .filter((unit) => params.allowedCapabilities.includes(unit.capability))
    .slice(0, params.runtimeConfig.maxUnitsPerPlan)
    .map((unit, index) => ({
      ...unit,
      id: normalizeId(unit.id, `unit_${index + 1}`),
      title: unit.title.trim() || `Research unit ${index + 1}`,
      objective: unit.objective.trim() || unit.title.trim() || `Unit ${index + 1}`,
      keyQuestions: uniqueStrings(unit.keyQuestions ?? [], 4),
      dependsOn: uniqueStrings(unit.dependsOn ?? [], 4),
      priority: unit.priority ?? "medium",
    }));
}

export async function analyzeResearchGaps(params: {
  client: DeepSeekClient;
  brief: ResearchBriefV2;
  compressedFindings?: CompressedFindings;
  gapIteration: number;
  runtimeConfig: ResearchRuntimeConfig;
  allowedCapabilities: ResearchUnitCapability[];
}) {
  const fallback = buildGapFallback({
    brief: params.brief,
    gapIteration: params.gapIteration,
    maxGapIterations: params.runtimeConfig.maxGapIterations,
    compressedFindings: params.compressedFindings,
    allowedCapabilities: params.allowedCapabilities,
  });

  const gap = await params.client.completeJson<ResearchGapAnalysis>(
    buildMessages(
      "Assess whether the research still has material gaps. Return JSON only. Generate at most two follow-up units and only if the gaps are material.",
      {
        brief: params.brief,
        compressedFindings: params.compressedFindings,
        gapIteration: params.gapIteration,
        maxGapIterations: params.runtimeConfig.maxGapIterations,
        allowedCapabilities: params.allowedCapabilities,
      },
    ),
    fallback,
    {
      model: params.runtimeConfig.models.planning,
      maxOutputTokens: 1600,
      budgetPolicy: {
        maxRetries: 1,
        truncateStrategy: ["drop_low_priority", "keep_tail", "trim_messages"],
        prioritySections: ["compressedFindings", "missingAreas"],
      },
      maxStructuredOutputRetries: 1,
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
      .map((unit, index) => ({
        ...unit,
        id: normalizeId(unit.id, `followup_${params.gapIteration + 1}_${index + 1}`),
        title: unit.title.trim() || `Follow-up ${index + 1}`,
        objective: unit.objective.trim() || unit.title.trim() || "Follow-up research",
        keyQuestions: uniqueStrings(unit.keyQuestions ?? [], 4),
        dependsOn: uniqueStrings(unit.dependsOn ?? [], 4),
      })),
  } satisfies ResearchGapAnalysis;
}

export async function compressResearchFindings(params: {
  client: DeepSeekClient;
  brief: ResearchBriefV2;
  noteSummaries: string[];
  gapAnalysis?: ResearchGapAnalysis;
  runtimeConfig: ResearchRuntimeConfig;
}) {
  const fallback = buildCompressionFallback(params);

  return params.client.completeJson<CompressedFindings>(
    buildMessages(
      "Compress the research notes into a synthesis payload for downstream report generation. Return JSON only.",
      {
        brief: params.brief,
        noteSummaries: params.noteSummaries,
        gapAnalysis: params.gapAnalysis,
      },
    ),
    fallback,
    {
      model: params.runtimeConfig.models.compression,
      maxOutputTokens: 1800,
      budgetPolicy: {
        maxRetries: 2,
        contextLimitHint: params.runtimeConfig.maxNotesCharsForCompression,
        truncateStrategy: ["drop_low_priority", "keep_tail", "trim_messages"],
        prioritySections: ["brief", "noteSummaries", "gapAnalysis"],
      },
      maxStructuredOutputRetries: 1,
    },
  );
}
