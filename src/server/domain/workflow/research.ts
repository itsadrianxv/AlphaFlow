type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeStringList(value: unknown, limit = 12) {
  if (!Array.isArray(value)) {
    return [];
  }

  return [...new Set(
    value
      .filter((item): item is string => typeof item === "string")
      .map((item) => item.trim())
      .filter(Boolean),
  )].slice(0, limit);
}

function normalizeString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function clampNumber(
  value: unknown,
  fallback: number,
  minimum: number,
  maximum: number,
) {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return fallback;
  }

  return Math.min(maximum, Math.max(minimum, Math.round(value)));
}

export type ResearchPreferenceInput = {
  researchGoal?: string;
  mustAnswerQuestions?: string[];
  forbiddenEvidenceTypes?: string[];
  preferredSources?: string[];
  freshnessWindowDays?: number;
};

export type ResearchClarificationRequest = {
  needClarification: boolean;
  question: string;
  verification: string;
  missingScopeFields: string[];
  suggestedInputPatch: Record<string, unknown>;
};

export type ResearchBriefV2 = {
  query: string;
  companyName?: string;
  stockCode?: string;
  officialWebsite?: string;
  researchGoal: string;
  focusConcepts: string[];
  keyQuestions: string[];
  mustAnswerQuestions: string[];
  forbiddenEvidenceTypes: string[];
  preferredSources: string[];
  freshnessWindowDays: number;
  scopeAssumptions: string[];
  clarificationSummary?: string;
};

export type ResearchUnitPriority = "high" | "medium" | "low";

export type ResearchUnitCapability =
  | "theme_overview"
  | "market_heat"
  | "candidate_screening"
  | "credibility_lookup"
  | "competition_synthesis"
  | "official_search"
  | "news_search"
  | "industry_search"
  | "page_scrape"
  | "financial_pack";

export type ResearchUnitPlan = {
  id: string;
  title: string;
  objective: string;
  keyQuestions: string[];
  priority: ResearchUnitPriority;
  capability: ResearchUnitCapability;
  dependsOn: string[];
};

export type ResearchUnitRunStatus =
  | "pending"
  | "running"
  | "completed"
  | "failed"
  | "skipped";

export type ResearchUnitRun = {
  unitId: string;
  title: string;
  capability: ResearchUnitCapability;
  status: ResearchUnitRunStatus;
  startedAt: string;
  completedAt?: string;
  notes: string[];
  sourceUrls: string[];
  evidenceCount: number;
  error?: string;
};

export type ResearchNote = {
  noteId: string;
  unitId: string;
  title: string;
  summary: string;
  keyFacts: string[];
  missingInfo: string[];
  evidenceReferenceIds: string[];
  sourceUrls: string[];
};

export type ResearchGapAnalysis = {
  requiresFollowup: boolean;
  summary: string;
  missingAreas: string[];
  followupUnits: ResearchUnitPlan[];
  iteration: number;
};

export type CompressedFindings = {
  summary: string;
  highlights: string[];
  openQuestions: string[];
  noteIds: string[];
};

export type ResearchModelMap = {
  clarification: string;
  planning: string;
  research: string;
  compression: string;
  report: string;
};

export type ResearchToolProviderMap = {
  webSearch: string;
  pageFetch: string;
  financialPack: string;
  themeNews: string;
  candidateScreening: string;
  credibilityLookup: string;
};

export type ResearchRuntimeConfig = {
  allowClarification: boolean;
  maxConcurrentResearchUnits: number;
  maxGapIterations: number;
  maxUnitsPerPlan: number;
  maxEvidencePerUnit: number;
  maxContentCharsPerSource: number;
  maxNotesCharsForCompression: number;
  models: ResearchModelMap;
  toolProviders: ResearchToolProviderMap;
};

export type WorkflowTemplateGraphConfig = {
  nodes: string[];
  researchDefaults?: Partial<
    Omit<ResearchRuntimeConfig, "models" | "toolProviders">
  > & {
    models?: Partial<ResearchModelMap>;
    toolProviders?: Partial<ResearchToolProviderMap>;
  };
};

export const DEFAULT_RESEARCH_RUNTIME_CONFIG: ResearchRuntimeConfig = {
  allowClarification: true,
  maxConcurrentResearchUnits: 3,
  maxGapIterations: 2,
  maxUnitsPerPlan: 6,
  maxEvidencePerUnit: 8,
  maxContentCharsPerSource: 2400,
  maxNotesCharsForCompression: 9000,
  models: {
    clarification: "deepseek-chat",
    planning: "deepseek-chat",
    research: "deepseek-chat",
    compression: "deepseek-chat",
    report: "deepseek-chat",
  },
  toolProviders: {
    webSearch: "firecrawl",
    pageFetch: "firecrawl",
    financialPack: "python",
    themeNews: "python",
    candidateScreening: "python",
    credibilityLookup: "python",
  },
};

export function parseResearchPreferenceInput(
  value: unknown,
): ResearchPreferenceInput | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const researchGoal = normalizeString(value.researchGoal);
  const mustAnswerQuestions = normalizeStringList(value.mustAnswerQuestions, 8);
  const forbiddenEvidenceTypes = normalizeStringList(
    value.forbiddenEvidenceTypes,
    8,
  );
  const preferredSources = normalizeStringList(value.preferredSources, 8);
  const freshnessWindowDays =
    typeof value.freshnessWindowDays === "number" &&
    Number.isFinite(value.freshnessWindowDays)
      ? clampNumber(value.freshnessWindowDays, 30, 1, 3650)
      : undefined;

  if (
    !researchGoal &&
    mustAnswerQuestions.length === 0 &&
    forbiddenEvidenceTypes.length === 0 &&
    preferredSources.length === 0 &&
    freshnessWindowDays === undefined
  ) {
    return undefined;
  }

  return {
    researchGoal: researchGoal || undefined,
    mustAnswerQuestions,
    forbiddenEvidenceTypes,
    preferredSources,
    freshnessWindowDays,
  };
}

export function parseWorkflowTemplateGraphConfig(
  graphConfig: unknown,
): WorkflowTemplateGraphConfig {
  const defaultGraphConfig: WorkflowTemplateGraphConfig = {
    nodes: [],
    researchDefaults: undefined,
  };

  if (!isRecord(graphConfig)) {
    return defaultGraphConfig;
  }

  const nodes = Array.isArray(graphConfig.nodes)
    ? graphConfig.nodes.filter((node): node is string => typeof node === "string")
    : [];

  const rawResearchDefaults = isRecord(graphConfig.researchDefaults)
    ? graphConfig.researchDefaults
    : undefined;

  return {
    nodes,
    researchDefaults: rawResearchDefaults
      ? {
          allowClarification:
            typeof rawResearchDefaults.allowClarification === "boolean"
              ? rawResearchDefaults.allowClarification
              : undefined,
          maxConcurrentResearchUnits:
            typeof rawResearchDefaults.maxConcurrentResearchUnits === "number"
              ? rawResearchDefaults.maxConcurrentResearchUnits
              : undefined,
          maxGapIterations:
            typeof rawResearchDefaults.maxGapIterations === "number"
              ? rawResearchDefaults.maxGapIterations
              : undefined,
          maxUnitsPerPlan:
            typeof rawResearchDefaults.maxUnitsPerPlan === "number"
              ? rawResearchDefaults.maxUnitsPerPlan
              : undefined,
          maxEvidencePerUnit:
            typeof rawResearchDefaults.maxEvidencePerUnit === "number"
              ? rawResearchDefaults.maxEvidencePerUnit
              : undefined,
          maxContentCharsPerSource:
            typeof rawResearchDefaults.maxContentCharsPerSource === "number"
              ? rawResearchDefaults.maxContentCharsPerSource
              : undefined,
          maxNotesCharsForCompression:
            typeof rawResearchDefaults.maxNotesCharsForCompression === "number"
              ? rawResearchDefaults.maxNotesCharsForCompression
              : undefined,
          models: isRecord(rawResearchDefaults.models)
            ? {
                clarification: normalizeString(
                  rawResearchDefaults.models.clarification,
                ),
                planning: normalizeString(rawResearchDefaults.models.planning),
                research: normalizeString(rawResearchDefaults.models.research),
                compression: normalizeString(
                  rawResearchDefaults.models.compression,
                ),
                report: normalizeString(rawResearchDefaults.models.report),
              }
            : undefined,
          toolProviders: isRecord(rawResearchDefaults.toolProviders)
            ? {
                webSearch: normalizeString(
                  rawResearchDefaults.toolProviders.webSearch,
                ),
                pageFetch: normalizeString(
                  rawResearchDefaults.toolProviders.pageFetch,
                ),
                financialPack: normalizeString(
                  rawResearchDefaults.toolProviders.financialPack,
                ),
                themeNews: normalizeString(
                  rawResearchDefaults.toolProviders.themeNews,
                ),
                candidateScreening: normalizeString(
                  rawResearchDefaults.toolProviders.candidateScreening,
                ),
                credibilityLookup: normalizeString(
                  rawResearchDefaults.toolProviders.credibilityLookup,
                ),
              }
            : undefined,
        }
      : undefined,
  };
}

export function resolveResearchRuntimeConfig(
  graphConfig: unknown,
  overrides?: Partial<ResearchRuntimeConfig>,
): ResearchRuntimeConfig {
  const parsed = parseWorkflowTemplateGraphConfig(graphConfig);
  const researchDefaults = parsed.researchDefaults;

  return {
    allowClarification:
      overrides?.allowClarification ??
      researchDefaults?.allowClarification ??
      DEFAULT_RESEARCH_RUNTIME_CONFIG.allowClarification,
    maxConcurrentResearchUnits: clampNumber(
      overrides?.maxConcurrentResearchUnits ??
        researchDefaults?.maxConcurrentResearchUnits,
      DEFAULT_RESEARCH_RUNTIME_CONFIG.maxConcurrentResearchUnits,
      1,
      12,
    ),
    maxGapIterations: clampNumber(
      overrides?.maxGapIterations ?? researchDefaults?.maxGapIterations,
      DEFAULT_RESEARCH_RUNTIME_CONFIG.maxGapIterations,
      0,
      6,
    ),
    maxUnitsPerPlan: clampNumber(
      overrides?.maxUnitsPerPlan ?? researchDefaults?.maxUnitsPerPlan,
      DEFAULT_RESEARCH_RUNTIME_CONFIG.maxUnitsPerPlan,
      1,
      16,
    ),
    maxEvidencePerUnit: clampNumber(
      overrides?.maxEvidencePerUnit ?? researchDefaults?.maxEvidencePerUnit,
      DEFAULT_RESEARCH_RUNTIME_CONFIG.maxEvidencePerUnit,
      1,
      20,
    ),
    maxContentCharsPerSource: clampNumber(
      overrides?.maxContentCharsPerSource ??
        researchDefaults?.maxContentCharsPerSource,
      DEFAULT_RESEARCH_RUNTIME_CONFIG.maxContentCharsPerSource,
      300,
      40000,
    ),
    maxNotesCharsForCompression: clampNumber(
      overrides?.maxNotesCharsForCompression ??
        researchDefaults?.maxNotesCharsForCompression,
      DEFAULT_RESEARCH_RUNTIME_CONFIG.maxNotesCharsForCompression,
      1000,
      50000,
    ),
    models: {
      clarification:
        overrides?.models?.clarification ||
        researchDefaults?.models?.clarification ||
        DEFAULT_RESEARCH_RUNTIME_CONFIG.models.clarification,
      planning:
        overrides?.models?.planning ||
        researchDefaults?.models?.planning ||
        DEFAULT_RESEARCH_RUNTIME_CONFIG.models.planning,
      research:
        overrides?.models?.research ||
        researchDefaults?.models?.research ||
        DEFAULT_RESEARCH_RUNTIME_CONFIG.models.research,
      compression:
        overrides?.models?.compression ||
        researchDefaults?.models?.compression ||
        DEFAULT_RESEARCH_RUNTIME_CONFIG.models.compression,
      report:
        overrides?.models?.report ||
        researchDefaults?.models?.report ||
        DEFAULT_RESEARCH_RUNTIME_CONFIG.models.report,
    },
    toolProviders: {
      webSearch:
        overrides?.toolProviders?.webSearch ||
        researchDefaults?.toolProviders?.webSearch ||
        DEFAULT_RESEARCH_RUNTIME_CONFIG.toolProviders.webSearch,
      pageFetch:
        overrides?.toolProviders?.pageFetch ||
        researchDefaults?.toolProviders?.pageFetch ||
        DEFAULT_RESEARCH_RUNTIME_CONFIG.toolProviders.pageFetch,
      financialPack:
        overrides?.toolProviders?.financialPack ||
        researchDefaults?.toolProviders?.financialPack ||
        DEFAULT_RESEARCH_RUNTIME_CONFIG.toolProviders.financialPack,
      themeNews:
        overrides?.toolProviders?.themeNews ||
        researchDefaults?.toolProviders?.themeNews ||
        DEFAULT_RESEARCH_RUNTIME_CONFIG.toolProviders.themeNews,
      candidateScreening:
        overrides?.toolProviders?.candidateScreening ||
        researchDefaults?.toolProviders?.candidateScreening ||
        DEFAULT_RESEARCH_RUNTIME_CONFIG.toolProviders.candidateScreening,
      credibilityLookup:
        overrides?.toolProviders?.credibilityLookup ||
        researchDefaults?.toolProviders?.credibilityLookup ||
        DEFAULT_RESEARCH_RUNTIME_CONFIG.toolProviders.credibilityLookup,
    },
  };
}

export function getWorkflowNodeKeysFromParsedGraphConfig(graphConfig: unknown) {
  return parseWorkflowTemplateGraphConfig(graphConfig).nodes;
}
