import { v4 as uuidv4 } from "uuid";
import {
  type CompanyResearchAgentService,
  normalizeCompanyResearchQuestions,
} from "~/server/application/intelligence/company-research-agent-service";
import { reflectCompanyResearch } from "~/server/application/intelligence/research-reflection";
import type { ResearchToolRegistry } from "~/server/application/intelligence/research-tool-registry";
import {
  analyzeResearchGaps,
  buildDefaultTaskContract,
  clarifyResearchScope,
  compressResearchFindings,
  planResearchUnits,
  writeResearchBrief,
  writeTaskContract,
} from "~/server/application/intelligence/research-workflow-kernel";
import type { CompanyResearchPack } from "~/server/domain/intelligence/types";
import type {
  CompressedFindings,
  ResearchGapAnalysis,
  ResearchNote,
  ResearchRuntimeConfig,
  ResearchUnitCapability,
  ResearchUnitPlan,
  ResearchUnitRun,
} from "~/server/domain/workflow/research";
import type {
  CompanyEvidenceNote,
  CompanyResearchBrief,
  CompanyResearchCollectorKey,
  CompanyResearchCollectorRunInfo,
  CompanyResearchGraphState,
  CompanyResearchGroundedSource,
  CompanyResearchInput,
  CompanyResearchQuestion,
  CompanyResearchResultDto,
  CompanyResearchSourceTier,
  CompanyResearchSourceType,
} from "~/server/domain/workflow/types";
import type { DeepSeekClient } from "~/server/infrastructure/intelligence/deepseek-client";

type CompanyResearchWorkflowServiceDependencies = {
  client: DeepSeekClient;
  companyResearchService: CompanyResearchAgentService;
  researchToolRegistry: ResearchToolRegistry;
};

type CompanyExecutionSnapshot = {
  groundedSources: CompanyResearchGroundedSource[];
  collectedEvidenceByCollector: Partial<
    Record<CompanyResearchCollectorKey, CompanyEvidenceNote[]>
  >;
  collectorRunInfo: Partial<
    Record<CompanyResearchCollectorKey, CompanyResearchCollectorRunInfo>
  >;
  collectorPacks: Partial<
    Record<CompanyResearchCollectorKey, CompanyResearchPack | undefined>
  >;
  collectionNotes: string[];
};

const COMPANY_ALLOWED_CAPABILITIES: ResearchUnitCapability[] = [
  "official_search",
  "news_search",
  "industry_search",
  "page_scrape",
  "financial_pack",
];

function uniqueStrings(items: string[], limit = 8) {
  return [...new Set(items.map((item) => item.trim()).filter(Boolean))].slice(
    0,
    limit,
  );
}

function normalizeUrl(url?: string) {
  if (!url) {
    return undefined;
  }

  const trimmed = url.trim();
  if (!trimmed) {
    return undefined;
  }

  return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
}

function stripWww(hostname: string) {
  return hostname.replace(/^www\./i, "").toLowerCase();
}

function buildOfficialHostSet(officialWebsite?: string) {
  if (!officialWebsite) {
    return new Set<string>();
  }

  try {
    const parsed = new URL(officialWebsite);
    const hostname = stripWww(parsed.hostname);
    const parts = hostname.split(".");
    if (parts.length <= 2) {
      return new Set([hostname]);
    }

    return new Set([hostname, parts.slice(-2).join(".")]);
  } catch {
    return new Set<string>();
  }
}

function isFirstPartyUrl(url: string | undefined, officialHosts: Set<string>) {
  if (!url) {
    return false;
  }

  try {
    const hostname = stripWww(new URL(url).hostname);
    return [...officialHosts].some(
      (host) => hostname === host || hostname.endsWith(`.${host}`),
    );
  } catch {
    return false;
  }
}

function toCompanyBrief(
  input: CompanyResearchInput,
  brief: CompanyResearchGraphState["researchBrief"],
): CompanyResearchBrief {
  return {
    companyName: brief?.companyName ?? input.companyName,
    stockCode: brief?.stockCode ?? input.stockCode,
    officialWebsite:
      brief?.officialWebsite ?? normalizeUrl(input.officialWebsite),
    researchGoal: brief?.researchGoal ?? input.keyQuestion ?? input.companyName,
    focusConcepts:
      brief?.focusConcepts.length && brief.focusConcepts.length > 0
        ? brief.focusConcepts
        : (input.focusConcepts ?? []),
    keyQuestions:
      brief?.keyQuestions.length && brief.keyQuestions.length > 0
        ? brief.keyQuestions
        : uniqueStrings(
            [
              input.keyQuestion ?? "",
              ...(input.researchPreferences?.mustAnswerQuestions ?? []),
            ],
            6,
          ),
  };
}

function buildFallbackResearchBrief(
  input: CompanyResearchInput,
  brief: CompanyResearchGraphState["brief"],
): NonNullable<CompanyResearchGraphState["researchBrief"]> {
  return {
    query: input.keyQuestion?.trim() || input.companyName,
    companyName: brief?.companyName ?? input.companyName,
    stockCode: brief?.stockCode ?? input.stockCode,
    officialWebsite:
      brief?.officialWebsite ?? normalizeUrl(input.officialWebsite),
    researchGoal: brief?.researchGoal ?? input.keyQuestion ?? input.companyName,
    focusConcepts: brief?.focusConcepts ?? input.focusConcepts ?? [],
    keyQuestions: brief?.keyQuestions ?? [],
    mustAnswerQuestions:
      brief?.keyQuestions && brief.keyQuestions.length > 0
        ? brief.keyQuestions
        : [input.keyQuestion?.trim() || input.companyName],
    forbiddenEvidenceTypes: [],
    preferredSources: [],
    freshnessWindowDays: 180,
    scopeAssumptions: [],
  };
}

function resolveTaskContract(state: CompanyResearchGraphState) {
  return (
    state.taskContract ??
    buildDefaultTaskContract({
      subject: "company",
      preferences: state.researchInput.researchPreferences,
      taskContract: state.researchInput.taskContract,
    })
  );
}

function buildCollectorQueries(params: {
  collectorKey: CompanyResearchCollectorKey;
  brief: CompanyResearchGraphState["researchBrief"];
  companyBrief: CompanyResearchBrief;
  deepQuestions: CompanyResearchQuestion[];
  officialHosts: Set<string>;
}) {
  const deepQuestions = normalizeCompanyResearchQuestions(params.deepQuestions);
  const companyName = params.companyBrief.companyName;
  const leadConcept =
    params.brief?.focusConcepts[0] ??
    params.companyBrief.focusConcepts[0] ??
    "核心业务";
  const leadQuestion =
    deepQuestions[0]?.targetMetric ??
    params.companyBrief.keyQuestions[0] ??
    params.brief?.mustAnswerQuestions[0] ??
    "利润兑现";

  if (params.collectorKey === "official_sources") {
    const host = [...params.officialHosts][0];
    if (!host) {
      return uniqueStrings([
        `${companyName} 投资者关系`,
        `${companyName} 公告 年报`,
      ]);
    }

    return uniqueStrings([
      `site:${host} ${companyName} 投资者关系`,
      `site:${host} ${companyName} 年报 半年报`,
      `site:${host} ${companyName} ${leadConcept}`,
    ]);
  }

  if (params.collectorKey === "news_sources") {
    return uniqueStrings([
      `${companyName} ${leadConcept} 最新进展`,
      `${companyName} 公告 纪要 ${leadQuestion}`,
      `${companyName} ${leadConcept} 订单 产能`,
    ]);
  }

  return uniqueStrings([
    `${companyName} ${leadConcept} 行业格局 竞争对手`,
    `${companyName} 产业链 地位 ${leadConcept}`,
    `${companyName} ${leadQuestion} 行业对比`,
  ]);
}

function resolveCollectorKeyForCapability(
  capability: ResearchUnitCapability,
): CompanyResearchCollectorKey {
  if (capability === "industry_search") {
    return "industry_sources";
  }

  if (capability === "news_search") {
    return "news_sources";
  }

  if (capability === "financial_pack") {
    return "financial_sources";
  }

  return "official_sources";
}

function mapWebDocumentToEvidence(params: {
  collectorKey: CompanyResearchCollectorKey;
  sourceType: CompanyResearchSourceType;
  sourceTier: CompanyResearchSourceTier;
  isFirstParty: boolean;
  title: string;
  url?: string;
  sourceName: string;
  summary: string;
  snippet: string;
  relevance: string;
}) {
  return {
    referenceId: uuidv4(),
    title: params.title,
    sourceName: params.sourceName,
    url: params.url,
    sourceType: params.sourceType,
    sourceTier: params.sourceTier,
    collectorKey: params.collectorKey,
    isFirstParty: params.isFirstParty,
    snippet: params.snippet,
    extractedFact: params.summary,
    relevance: params.relevance,
  } satisfies CompanyEvidenceNote;
}

function buildNote(params: {
  unit: ResearchUnitPlan;
  summary: string;
  keyFacts: string[];
  missingInfo?: string[];
  evidenceReferenceIds?: string[];
  sourceUrls?: string[];
}): ResearchNote {
  return {
    noteId: `${params.unit.id}_note`,
    unitId: params.unit.id,
    title: params.unit.title,
    summary: params.summary,
    keyFacts: uniqueStrings(params.keyFacts, 6),
    missingInfo: uniqueStrings(params.missingInfo ?? [], 4),
    evidenceReferenceIds: uniqueStrings(params.evidenceReferenceIds ?? [], 8),
    sourceUrls: uniqueStrings(params.sourceUrls ?? [], 8),
  };
}

export class CompanyResearchWorkflowService {
  private readonly client: DeepSeekClient;
  private readonly companyResearchService: CompanyResearchAgentService;
  private readonly researchToolRegistry: ResearchToolRegistry;

  constructor(dependencies: CompanyResearchWorkflowServiceDependencies) {
    this.client = dependencies.client;
    this.companyResearchService = dependencies.companyResearchService;
    this.researchToolRegistry = dependencies.researchToolRegistry;
  }

  async buildTaskContract(
    input: CompanyResearchInput,
    runtimeConfig: ResearchRuntimeConfig,
  ) {
    return writeTaskContract({
      client: this.client,
      subject: "company",
      preferences: input.researchPreferences,
      taskContract: input.taskContract,
      runtimeConfig,
    });
  }

  async clarifyScope(
    input: CompanyResearchInput,
    runtimeConfig: ResearchRuntimeConfig,
  ) {
    return clarifyResearchScope({
      client: this.client,
      subject: "company",
      query: input.keyQuestion?.trim() || input.companyName,
      companyName: input.companyName,
      focusConcepts: input.focusConcepts,
      keyQuestion: input.keyQuestion,
      preferences: input.researchPreferences,
      runtimeConfig,
    });
  }

  async buildBrief(
    input: CompanyResearchInput,
    runtimeConfig: ResearchRuntimeConfig,
    clarificationSummary?: string,
  ) {
    return writeResearchBrief({
      client: this.client,
      subject: "company",
      query: input.keyQuestion?.trim() || input.companyName,
      companyName: input.companyName,
      stockCode: input.stockCode,
      officialWebsite: input.officialWebsite,
      focusConcepts: input.focusConcepts,
      keyQuestion: input.keyQuestion,
      preferences: input.researchPreferences,
      taskContract: input.taskContract,
      clarificationSummary,
      runtimeConfig,
    });
  }

  groundSources(state: CompanyResearchGraphState) {
    const companyBrief =
      state.brief ?? toCompanyBrief(state.researchInput, state.researchBrief);
    const grounded = this.companyResearchService.groundSources({
      input: state.researchInput,
      brief: companyBrief,
    });

    return {
      groundedSources: grounded.groundedSources,
      collectionNotes: grounded.notes,
    };
  }

  async planUnits(params: {
    state: CompanyResearchGraphState;
    runtimeConfig: ResearchRuntimeConfig;
  }) {
    const companyBrief = toCompanyBrief(
      params.state.researchInput,
      params.state.researchBrief,
    );
    const conceptInsights =
      await this.companyResearchService.mapConceptInsights(companyBrief);
    const deepQuestions = await this.companyResearchService.designDeepQuestions(
      {
        brief: companyBrief,
        conceptInsights,
      },
    );
    const units = await planResearchUnits({
      client: this.client,
      subject: "company",
      brief:
        params.state.researchBrief ??
        buildFallbackResearchBrief(params.state.researchInput, companyBrief),
      taskContract: resolveTaskContract(params.state),
      allowedCapabilities: COMPANY_ALLOWED_CAPABILITIES,
      runtimeConfig: params.runtimeConfig,
    });

    return {
      brief: companyBrief,
      conceptInsights,
      deepQuestions: normalizeCompanyResearchQuestions(deepQuestions),
      researchUnits: units,
    };
  }

  private async runCollectorUnit(params: {
    unit: ResearchUnitPlan;
    state: CompanyResearchGraphState;
    snapshot: CompanyExecutionSnapshot;
    runtimeConfig: ResearchRuntimeConfig;
  }): Promise<{
    collectorKey: CompanyResearchCollectorKey;
    evidence: CompanyEvidenceNote[];
    notes: string[];
    queries: string[];
    configured: boolean;
    groundedSources?: CompanyResearchGroundedSource[];
    pack?: CompanyResearchPack;
    researchNote: ResearchNote;
    run: ResearchUnitRun;
  }> {
    const startedAt = new Date().toISOString();
    const companyBrief =
      params.state.brief ??
      toCompanyBrief(params.state.researchInput, params.state.researchBrief);
    const officialHosts = buildOfficialHostSet(companyBrief.officialWebsite);
    const grounded = this.companyResearchService.groundSources({
      input: params.state.researchInput,
      brief: companyBrief,
    });
    const groundedSources = [
      ...new Map(
        [...params.snapshot.groundedSources, ...grounded.groundedSources].map(
          (item) => [`${item.collectorKey}:${item.url}`, item] as const,
        ),
      ).values(),
    ];

    try {
      if (params.unit.capability === "financial_pack") {
        const pack = companyBrief.stockCode
          ? await this.researchToolRegistry.getFinancialPack({
              stockCode: companyBrief.stockCode,
              concept:
                params.state.conceptInsights?.[0]?.concept ??
                companyBrief.focusConcepts[0],
              runtimeConfig: params.runtimeConfig,
            })
          : null;
        const evidence = (pack?.referenceItems ?? []).map((item) => ({
          referenceId: item.id,
          title: item.title,
          sourceName: item.sourceName,
          url: item.url,
          sourceType: "financial" as const,
          sourceTier: "third_party" as const,
          collectorKey: "financial_sources" as const,
          isFirstParty: false,
          snippet: item.snippet,
          extractedFact: item.extractedFact,
          relevance:
            "Structured financial evidence from the Python intelligence service.",
          publishedAt: item.publishedAt,
        }));

        return {
          collectorKey: "financial_sources",
          evidence,
          notes: pack?.summaryNotes ?? ["Financial pack unavailable."],
          queries: [],
          configured: Boolean(pack),
          groundedSources,
          pack: pack ?? undefined,
          researchNote: buildNote({
            unit: params.unit,
            summary:
              pack?.summaryNotes[0] ??
              `Collected ${evidence.length} financial evidence items.`,
            keyFacts: evidence.slice(0, 3).map((item) => item.extractedFact),
            missingInfo: pack ? [] : ["No financial pack returned."],
            evidenceReferenceIds: evidence.map((item) => item.referenceId),
            sourceUrls: evidence
              .map((item) => item.url)
              .filter((item): item is string => Boolean(item)),
          }),
          run: {
            unitId: params.unit.id,
            title: params.unit.title,
            capability: params.unit.capability,
            status: "completed",
            attempt: 1,
            repairCount: 0,
            fallbackUsed: pack ? undefined : "official_search",
            validationErrors: [],
            qualityFlags: pack ? [] : ["financial_pack_unavailable"],
            startedAt,
            completedAt: new Date().toISOString(),
            notes: pack?.summaryNotes ?? [],
            sourceUrls: evidence
              .map((item) => item.url)
              .filter((item): item is string => Boolean(item)),
            evidenceCount: evidence.length,
          },
        };
      }

      const collectorKey = resolveCollectorKeyForCapability(
        params.unit.capability,
      );
      const sourceType: CompanyResearchSourceType =
        collectorKey === "industry_sources"
          ? "industry"
          : collectorKey === "news_sources"
            ? "news"
            : "official";
      const queries = buildCollectorQueries({
        collectorKey,
        brief: params.state.researchBrief,
        companyBrief,
        deepQuestions: params.state.deepQuestions ?? [],
        officialHosts,
      });
      const webResults = await this.researchToolRegistry.searchWeb({
        queries,
        runtimeConfig: params.runtimeConfig,
        limit: params.runtimeConfig.maxEvidencePerUnit,
      });
      const evidence = webResults.map((item) =>
        mapWebDocumentToEvidence({
          collectorKey,
          sourceType,
          sourceTier: isFirstPartyUrl(item.url, officialHosts)
            ? "first_party"
            : "third_party",
          isFirstParty: isFirstPartyUrl(item.url, officialHosts),
          title: item.title,
          url: item.url,
          sourceName: item.sourceName,
          summary: item.summary,
          snippet: item.snippet,
          relevance:
            collectorKey === "industry_sources"
              ? "Industry structure and competition evidence."
              : collectorKey === "news_sources"
                ? "Recent event and catalyst evidence."
                : "First-party or near first-party company disclosure evidence.",
        }),
      );

      if (params.unit.capability === "page_scrape") {
        const firstPartyTargets = groundedSources
          .filter((item) => item.isFirstParty)
          .slice(0, params.runtimeConfig.maxEvidencePerUnit);
        const pageResults = await Promise.all(
          firstPartyTargets.map((item) =>
            this.researchToolRegistry.fetchPage({
              url: item.url,
              runtimeConfig: params.runtimeConfig,
            }),
          ),
        );
        for (const page of pageResults) {
          if (!page) {
            continue;
          }

          evidence.push(
            mapWebDocumentToEvidence({
              collectorKey: "official_sources",
              sourceType: "official",
              sourceTier: "first_party",
              isFirstParty: true,
              title: page.title,
              url: page.url,
              sourceName: page.sourceName,
              summary: page.summary,
              snippet: page.snippet,
              relevance:
                "First-party page scrape used to confirm company claims.",
            }),
          );
        }
      }

      return {
        collectorKey,
        evidence,
        notes: [
          ...grounded.notes,
          evidence.length > 0
            ? `Collected ${evidence.length} evidence items for ${collectorKey}.`
            : `No evidence returned for ${collectorKey}.`,
        ],
        queries,
        configured: evidence.length > 0,
        groundedSources,
        researchNote: buildNote({
          unit: params.unit,
          summary:
            evidence[0]?.extractedFact ??
            `Collected ${evidence.length} evidence items for ${collectorKey}.`,
          keyFacts: evidence.slice(0, 3).map((item) => item.extractedFact),
          missingInfo:
            evidence.length === 0
              ? [`No usable evidence returned for ${collectorKey}.`]
              : [],
          evidenceReferenceIds: evidence.map((item) => item.referenceId),
          sourceUrls: evidence
            .map((item) => item.url)
            .filter((item): item is string => Boolean(item)),
        }),
        run: {
          unitId: params.unit.id,
          title: params.unit.title,
          capability: params.unit.capability,
          status: "completed",
          attempt: 1,
          repairCount: 0,
          validationErrors: [],
          qualityFlags: evidence.length === 0 ? [`${collectorKey}_empty`] : [],
          startedAt,
          completedAt: new Date().toISOString(),
          notes: queries,
          sourceUrls: evidence
            .map((item) => item.url)
            .filter((item): item is string => Boolean(item)),
          evidenceCount: evidence.length,
        },
      };
    } catch (error) {
      return {
        collectorKey: resolveCollectorKeyForCapability(params.unit.capability),
        evidence: [],
        notes: [error instanceof Error ? error.message : "unknown error"],
        queries: [],
        configured: false,
        groundedSources,
        researchNote: buildNote({
          unit: params.unit,
          summary: `Unit failed: ${error instanceof Error ? error.message : "unknown error"}`,
          keyFacts: [],
          missingInfo: [params.unit.objective],
        }),
        run: {
          unitId: params.unit.id,
          title: params.unit.title,
          capability: params.unit.capability,
          status: "failed",
          attempt: 1,
          repairCount: 0,
          validationErrors: [
            error instanceof Error ? error.message : "unknown error",
          ],
          qualityFlags: ["unit_failed"],
          startedAt,
          completedAt: new Date().toISOString(),
          notes: [],
          sourceUrls: [],
          evidenceCount: 0,
          error: error instanceof Error ? error.message : "unknown error",
        },
      };
    }
  }

  async executeCollectorUnit(params: {
    unit: ResearchUnitPlan;
    state: CompanyResearchGraphState;
    runtimeConfig: ResearchRuntimeConfig;
  }) {
    const snapshot: CompanyExecutionSnapshot = {
      groundedSources: params.state.groundedSources ?? [],
      collectedEvidenceByCollector: {
        ...(params.state.collectedEvidenceByCollector ?? {}),
      },
      collectorRunInfo: {
        ...(params.state.collectorRunInfo ?? {}),
      },
      collectorPacks: {
        ...(params.state.collectorPacks ?? {}),
      },
      collectionNotes: [...(params.state.collectionNotes ?? [])],
    };
    const result = await this.runCollectorUnit({
      unit: params.unit,
      state: params.state,
      snapshot,
      runtimeConfig: params.runtimeConfig,
    });

    return {
      groundedSources: result.groundedSources ?? snapshot.groundedSources,
      collectedEvidenceByCollector: {
        [result.collectorKey]: result.evidence,
      },
      collectorRunInfo: {
        [result.collectorKey]: {
          collectorKey: result.collectorKey,
          configured: result.configured,
          queries: uniqueStrings(result.queries, 8),
          notes: uniqueStrings(result.notes, 8),
        },
      },
      collectorPacks: result.pack
        ? {
            [result.collectorKey]: result.pack,
          }
        : {},
      collectionNotes: uniqueStrings(
        [...snapshot.collectionNotes, ...result.notes],
        24,
      ),
      researchNotes: [result.researchNote],
      researchUnitRuns: [result.run],
      researchUnits: [params.unit],
    };
  }

  async executeUnits(params: {
    state: CompanyResearchGraphState;
    runtimeConfig: ResearchRuntimeConfig;
    units: ResearchUnitPlan[];
  }) {
    const snapshot: CompanyExecutionSnapshot = {
      groundedSources: params.state.groundedSources ?? [],
      collectedEvidenceByCollector: {
        ...(params.state.collectedEvidenceByCollector ?? {}),
      },
      collectorRunInfo: {
        ...(params.state.collectorRunInfo ?? {}),
      },
      collectorPacks: {
        ...(params.state.collectorPacks ?? {}),
      },
      collectionNotes: [...(params.state.collectionNotes ?? [])],
    };
    const researchNotes = [...(params.state.researchNotes ?? [])];
    const researchUnitRuns = [...(params.state.researchUnitRuns ?? [])];
    const completedUnits = new Set(researchUnitRuns.map((item) => item.unitId));
    const pendingUnits = params.units.filter(
      (unit) => !completedUnits.has(unit.id),
    );

    while (pendingUnits.length > 0) {
      const readyUnits = pendingUnits.filter((unit) =>
        unit.dependsOn.every((dependency) => completedUnits.has(dependency)),
      );
      const batch =
        readyUnits.length > 0
          ? readyUnits.slice(0, params.runtimeConfig.maxConcurrentResearchUnits)
          : pendingUnits.slice(0, 1);
      const batchResults = await Promise.all(
        batch.map((unit) =>
          this.runCollectorUnit({
            unit,
            state: params.state,
            snapshot,
            runtimeConfig: params.runtimeConfig,
          }),
        ),
      );

      for (const result of batchResults) {
        snapshot.groundedSources =
          result.groundedSources ?? snapshot.groundedSources;
        snapshot.collectedEvidenceByCollector[result.collectorKey] = [
          ...(snapshot.collectedEvidenceByCollector[result.collectorKey] ?? []),
          ...result.evidence,
        ];
        snapshot.collectorRunInfo[result.collectorKey] = {
          collectorKey: result.collectorKey,
          configured: result.configured,
          queries: uniqueStrings(result.queries, 8),
          notes: uniqueStrings(result.notes, 8),
        };
        if (result.pack) {
          snapshot.collectorPacks[result.collectorKey] = result.pack;
        }
        snapshot.collectionNotes = uniqueStrings(
          [...snapshot.collectionNotes, ...result.notes],
          24,
        );
        researchNotes.push(result.researchNote);
        researchUnitRuns.push(result.run);
        completedUnits.add(result.run.unitId);
      }

      for (const unit of batch) {
        const index = pendingUnits.findIndex((item) => item.id === unit.id);
        if (index >= 0) {
          pendingUnits.splice(index, 1);
        }
      }
    }

    return {
      groundedSources: snapshot.groundedSources,
      collectedEvidenceByCollector: snapshot.collectedEvidenceByCollector,
      collectorRunInfo: snapshot.collectorRunInfo,
      collectorPacks: snapshot.collectorPacks,
      collectionNotes: snapshot.collectionNotes,
      researchNotes,
      researchUnitRuns,
      researchUnits: params.units,
    };
  }

  async runGapLoop(params: {
    state: CompanyResearchGraphState;
    runtimeConfig: ResearchRuntimeConfig;
  }) {
    let workingState = { ...params.state };
    let gapIteration = 0;
    let replanRecords = [...(params.state.replanRecords ?? [])];
    let gapAnalysis: ResearchGapAnalysis = {
      requiresFollowup: false,
      summary: "No gap analysis yet.",
      missingAreas: [],
      followupUnits: [],
      iteration: 0,
    };

    while (gapIteration <= params.runtimeConfig.maxGapIterations) {
      const brief =
        workingState.researchBrief ??
        buildFallbackResearchBrief(
          workingState.researchInput,
          workingState.brief,
        );
      const compressed = await compressResearchFindings({
        client: this.client,
        brief,
        taskContract: resolveTaskContract(workingState),
        noteSummaries: [
          ...(workingState.researchNotes ?? []).map((note) => note.summary),
          ...(workingState.evidence ?? [])
            .slice(0, 4)
            .map((item) => `${item.title}: ${item.extractedFact}`),
        ],
        gapAnalysis,
        runtimeConfig: params.runtimeConfig,
      });

      gapAnalysis = await analyzeResearchGaps({
        client: this.client,
        brief,
        taskContract: resolveTaskContract(workingState),
        compressedFindings: compressed,
        gapIteration,
        runtimeConfig: params.runtimeConfig,
        allowedCapabilities: COMPANY_ALLOWED_CAPABILITIES,
      });

      if (!gapAnalysis.requiresFollowup) {
        return {
          state: {
            ...workingState,
            gapAnalysis,
            replanRecords,
          },
          gapAnalysis,
        };
      }

      replanRecords = [
        ...replanRecords,
        {
          replanId: `company_gap_${gapIteration + 1}`,
          iteration: gapIteration + 1,
          triggerNodeKey: "agent5_gap_analysis_and_replan",
          reason: "material_research_gap",
          missingAreas: gapAnalysis.missingAreas,
          action: "append_followup_units",
          fallbackCapability: gapAnalysis.followupUnits[0]?.capability,
          resultSummary: gapAnalysis.summary,
          createdAt: new Date().toISOString(),
        },
      ];

      const executed = await this.executeUnits({
        state: {
          ...workingState,
          researchUnits: [
            ...(workingState.researchUnits ?? []),
            ...gapAnalysis.followupUnits,
          ],
        },
        runtimeConfig: params.runtimeConfig,
        units: gapAnalysis.followupUnits,
      });

      const curated = this.companyResearchService.curateEvidence({
        brief:
          workingState.brief ??
          toCompanyBrief(
            workingState.researchInput,
            workingState.researchBrief,
          ),
        questions: workingState.deepQuestions ?? [],
        collectedEvidenceByCollector:
          executed.collectedEvidenceByCollector ?? {},
        collectorRunInfo: executed.collectorRunInfo ?? {},
        collectionNotes: executed.collectionNotes ?? [],
      });

      workingState = {
        ...workingState,
        ...executed,
        evidence: curated.evidence,
        references: curated.references,
        collectionSummary: curated.collectionSummary,
        crawlerSummary: curated.crawler,
        researchNotes: executed.researchNotes,
        researchUnitRuns: executed.researchUnitRuns,
        researchUnits: [
          ...(workingState.researchUnits ?? []),
          ...gapAnalysis.followupUnits,
        ],
        compressedFindings: compressed,
        gapAnalysis,
        replanRecords,
      };
      gapIteration += 1;
    }

    return {
      state: {
        ...workingState,
        gapAnalysis,
        replanRecords,
      },
      gapAnalysis,
    };
  }

  synthesizeEvidence(state: CompanyResearchGraphState) {
    return this.curateEvidence(state);
  }

  curateEvidence(state: CompanyResearchGraphState) {
    const brief =
      state.brief ?? toCompanyBrief(state.researchInput, state.researchBrief);
    return this.companyResearchService.curateEvidence({
      brief,
      questions: state.deepQuestions ?? [],
      collectedEvidenceByCollector: state.collectedEvidenceByCollector ?? {},
      collectorRunInfo: state.collectorRunInfo ?? {},
      collectionNotes: state.collectionNotes ?? [],
    });
  }

  enrichReferences(state: CompanyResearchGraphState) {
    return this.companyResearchService.enrichReferences({
      references: state.references ?? [],
      evidence: state.evidence ?? [],
    });
  }

  async compressFindings(
    state: CompanyResearchGraphState,
    runtimeConfig: ResearchRuntimeConfig,
  ): Promise<CompressedFindings> {
    return compressResearchFindings({
      client: this.client,
      brief:
        state.researchBrief ??
        buildFallbackResearchBrief(state.researchInput, state.brief),
      taskContract: resolveTaskContract(state),
      noteSummaries: [
        ...(state.researchNotes ?? []).map((note) => note.summary),
        ...(state.evidence ?? [])
          .slice(0, 5)
          .map((item) => `${item.title}: ${item.extractedFact}`),
      ],
      gapAnalysis: state.gapAnalysis,
      runtimeConfig,
    });
  }

  async finalizeReport(params: {
    state: CompanyResearchGraphState;
    runtimeConfig: ResearchRuntimeConfig;
  }): Promise<CompanyResearchResultDto> {
    const deepQuestions = normalizeCompanyResearchQuestions(
      params.state.deepQuestions,
    );
    const taskContract = resolveTaskContract(params.state);
    const brief =
      params.state.brief ??
      toCompanyBrief(params.state.researchInput, params.state.researchBrief);
    const findings = await this.companyResearchService.answerQuestions({
      brief,
      questions: deepQuestions,
      evidence: params.state.evidence ?? [],
      compressedFindings: params.state.compressedFindings,
    });
    const verdict = await this.companyResearchService.buildVerdict({
      brief,
      conceptInsights: params.state.conceptInsights ?? [],
      findings,
    });
    const confidenceAnalysis =
      await this.companyResearchService.analyzeConfidence({
        brief,
        findings,
        verdict,
        evidence: params.state.evidence ?? [],
        references: params.state.references ?? [],
      });

    const report = this.companyResearchService.buildFinalReport({
      brief,
      conceptInsights: params.state.conceptInsights ?? [],
      deepQuestions,
      findings,
      evidence: params.state.evidence ?? [],
      references: params.state.references ?? [],
      collectionSummary: params.state.collectionSummary,
      crawler: params.state.crawlerSummary ?? {
        provider: "tavily",
        configured: false,
        queries: [],
        notes: [],
      },
      verdict,
      confidenceAnalysis,
      researchPlan: params.state.researchUnits,
      researchUnitRuns: params.state.researchUnitRuns,
      researchNotes: params.state.researchNotes,
      compressedFindings: params.state.compressedFindings,
      gapAnalysis: params.state.gapAnalysis,
      replanRecords: params.state.replanRecords,
      runtimeConfigSummary: {
        allowClarification: params.runtimeConfig.allowClarification,
        maxConcurrentResearchUnits:
          params.runtimeConfig.maxConcurrentResearchUnits,
        maxGapIterations: params.runtimeConfig.maxGapIterations,
        maxUnitsPerPlan: params.runtimeConfig.maxUnitsPerPlan,
        maxEvidencePerUnit: params.runtimeConfig.maxEvidencePerUnit,
      },
    });
    const reflection = reflectCompanyResearch({
      taskContract,
      result: report,
    });

    return {
      ...report,
      reflection,
      contractScore: reflection.contractScore,
      qualityFlags: reflection.qualityFlags,
      missingRequirements: reflection.missingRequirements,
    };
  }
}
