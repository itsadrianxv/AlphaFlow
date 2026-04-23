import { Annotation, END, StateGraph } from "@langchain/langgraph";
import type { CompanyResearchAgentService } from "~/modules/research/server/application/intelligence/company-research-agent-service";
import type { CompanyResearchWorkflowService } from "~/modules/research/server/application/intelligence/company-research-workflow-service";
import { WorkflowPauseError } from "~/modules/research/server/domain/workflow/errors";
import { getFlowSpec } from "~/modules/research/server/domain/workflow/flow-specs";
import { parseResearchTaskContract } from "~/modules/research/server/domain/workflow/research";
import type {
  CompanyResearchCollectionSummary,
  CompanyResearchGraphState,
  CompanyResearchInput,
  CompanyResearchNodeKey,
  WorkflowGraphState,
  WorkflowNodeKey,
} from "~/modules/research/server/domain/workflow/types";
import {
  COMPANY_RESEARCH_NODE_KEYS,
  COMPANY_RESEARCH_TEMPLATE_CODE,
  COMPANY_RESEARCH_V1_NODE_KEYS,
  COMPANY_RESEARCH_V3_NODE_KEYS,
  COMPANY_RESEARCH_V4_NODE_KEYS,
  resolveResearchRuntimeConfig,
} from "~/modules/research/server/domain/workflow/types";
import type { WorkflowGraphBuildInitialStateParams } from "~/modules/research/server/workflows/langgraph/workflow-graph";
import { BaseWorkflowLangGraph } from "~/modules/research/server/workflows/langgraph/workflow-graph-base";
import {
  addFanOutAndJoinEdges,
  addResumeStart,
  addSequentialEdges,
  addWorkflowNodes,
} from "~/modules/research/server/workflows/langgraph/workflow-graph-builder";

type LegacyNodeKey = (typeof COMPANY_RESEARCH_V1_NODE_KEYS)[number];
type V2NodeKey = (typeof COMPANY_RESEARCH_NODE_KEYS)[number];
type V3NodeKey = (typeof COMPANY_RESEARCH_V3_NODE_KEYS)[number];
type V4NodeKey = (typeof COMPANY_RESEARCH_V4_NODE_KEYS)[number];
type CompanyGraphBuilder = StateGraph<
  unknown,
  CompanyResearchGraphState,
  Partial<CompanyResearchGraphState>,
  string
>;
type NodeExecutor = (
  state: CompanyResearchGraphState,
) => Promise<Partial<CompanyResearchGraphState>>;

function mergeStringArrays(left?: string[], right?: string[]) {
  return [...new Set([...(left ?? []), ...(right ?? [])].filter(Boolean))];
}

function mergeGroundedSources(
  left?: NonNullable<CompanyResearchGraphState["groundedSources"]>,
  right?: NonNullable<CompanyResearchGraphState["groundedSources"]>,
) {
  return [
    ...new Map(
      [...(left ?? []), ...(right ?? [])].map((item) => [
        `${item.collectorKey}:${item.url}`,
        item,
      ]),
    ).values(),
  ];
}

function mergeResearchUnits(
  left?: CompanyResearchGraphState["researchUnits"],
  right?: CompanyResearchGraphState["researchUnits"],
) {
  return [
    ...new Map(
      [...(left ?? []), ...(right ?? [])].map(
        (item) => [item.id, item] as const,
      ),
    ).values(),
  ];
}

function mergeResearchNotes(
  left?: CompanyResearchGraphState["researchNotes"],
  right?: CompanyResearchGraphState["researchNotes"],
) {
  return [
    ...new Map(
      [...(left ?? []), ...(right ?? [])].map(
        (item) => [item.noteId, item] as const,
      ),
    ).values(),
  ];
}

function mergeResearchUnitRuns(
  left?: CompanyResearchGraphState["researchUnitRuns"],
  right?: CompanyResearchGraphState["researchUnitRuns"],
) {
  return [
    ...new Map(
      [...(left ?? []), ...(right ?? [])].map((item) => [
        `${item.unitId}:${item.attempt}`,
        item,
      ]),
    ).values(),
  ];
}

const WorkflowState = Annotation.Root({
  runId: Annotation<string>,
  userId: Annotation<string>,
  query: Annotation<string>,
  progressPercent: Annotation<number>,
  resumeFromNodeKey: Annotation<WorkflowNodeKey | undefined>,
  currentNodeKey: Annotation<CompanyResearchNodeKey | undefined>,
  researchInput: Annotation<CompanyResearchInput>,
  clarificationRequest: Annotation<
    CompanyResearchGraphState["clarificationRequest"]
  >,
  taskContract: Annotation<CompanyResearchGraphState["taskContract"]>,
  researchRuntimeConfig: Annotation<
    CompanyResearchGraphState["researchRuntimeConfig"]
  >,
  researchBrief: Annotation<CompanyResearchGraphState["researchBrief"]>,
  researchUnits: Annotation<CompanyResearchGraphState["researchUnits"]>({
    reducer: (left, right) => mergeResearchUnits(left, right),
    default: () => [],
  }),
  researchUnitRuns: Annotation<CompanyResearchGraphState["researchUnitRuns"]>({
    reducer: (left, right) => mergeResearchUnitRuns(left, right),
    default: () => [],
  }),
  researchNotes: Annotation<CompanyResearchGraphState["researchNotes"]>({
    reducer: (left, right) => mergeResearchNotes(left, right),
    default: () => [],
  }),
  compressedFindings: Annotation<
    CompanyResearchGraphState["compressedFindings"]
  >,
  gapAnalysis: Annotation<CompanyResearchGraphState["gapAnalysis"]>,
  replanRecords: Annotation<CompanyResearchGraphState["replanRecords"]>,
  reflection: Annotation<CompanyResearchGraphState["reflection"]>,
  contractScore: Annotation<CompanyResearchGraphState["contractScore"]>,
  qualityFlags: Annotation<CompanyResearchGraphState["qualityFlags"]>,
  missingRequirements: Annotation<
    CompanyResearchGraphState["missingRequirements"]
  >,
  brief: Annotation<CompanyResearchGraphState["brief"]>,
  conceptInsights: Annotation<CompanyResearchGraphState["conceptInsights"]>,
  deepQuestions: Annotation<CompanyResearchGraphState["deepQuestions"]>,
  groundedSources: Annotation<CompanyResearchGraphState["groundedSources"]>({
    reducer: (left, right) => mergeGroundedSources(left, right),
    default: () => [],
  }),
  collectedEvidenceByCollector: Annotation<
    CompanyResearchGraphState["collectedEvidenceByCollector"]
  >({
    reducer: (left, right) => ({ ...left, ...right }),
    default: () => ({}),
  }),
  collectorPacks: Annotation<CompanyResearchGraphState["collectorPacks"]>({
    reducer: (left, right) => ({ ...left, ...right }),
    default: () => ({}),
  }),
  collectorRunInfo: Annotation<CompanyResearchGraphState["collectorRunInfo"]>({
    reducer: (left, right) => ({ ...left, ...right }),
    default: () => ({}),
  }),
  collectionNotes: Annotation<CompanyResearchGraphState["collectionNotes"]>({
    reducer: (left, right) => mergeStringArrays(left, right),
    default: () => [],
  }),
  evidence: Annotation<CompanyResearchGraphState["evidence"]>,
  references: Annotation<CompanyResearchGraphState["references"]>,
  findings: Annotation<CompanyResearchGraphState["findings"]>,
  collectionSummary: Annotation<CompanyResearchGraphState["collectionSummary"]>,
  crawlerSummary: Annotation<CompanyResearchGraphState["crawlerSummary"]>,
  finalReport: Annotation<CompanyResearchGraphState["finalReport"]>,
  errors: Annotation<string[]>({
    reducer: (left, right) => left.concat(right),
    default: () => [],
  }),
});

function toResearchInput(input: Record<string, unknown>): CompanyResearchInput {
  const companyName =
    typeof input.companyName === "string" && input.companyName.trim().length > 0
      ? input.companyName.trim()
      : "Unknown company";

  return {
    companyName,
    stockCode:
      typeof input.stockCode === "string" && input.stockCode.trim().length > 0
        ? input.stockCode.trim()
        : undefined,
    officialWebsite:
      typeof input.officialWebsite === "string" &&
      input.officialWebsite.trim().length > 0
        ? input.officialWebsite.trim()
        : undefined,
    focusConcepts: Array.isArray(input.focusConcepts)
      ? input.focusConcepts.filter(
          (item): item is string =>
            typeof item === "string" && item.trim().length > 0,
        )
      : undefined,
    keyQuestion:
      typeof input.keyQuestion === "string" &&
      input.keyQuestion.trim().length > 0
        ? input.keyQuestion.trim()
        : undefined,
    supplementalUrls: Array.isArray(input.supplementalUrls)
      ? input.supplementalUrls.filter(
          (item): item is string =>
            typeof item === "string" && item.trim().length > 0,
        )
      : undefined,
    researchPreferences:
      input.researchPreferences &&
      typeof input.researchPreferences === "object" &&
      !Array.isArray(input.researchPreferences)
        ? {
            researchGoal:
              typeof (input.researchPreferences as Record<string, unknown>)
                .researchGoal === "string"
                ? ((input.researchPreferences as Record<string, unknown>)
                    .researchGoal as string)
                : undefined,
            mustAnswerQuestions: Array.isArray(
              (input.researchPreferences as Record<string, unknown>)
                .mustAnswerQuestions,
            )
              ? (
                  (input.researchPreferences as Record<string, unknown>)
                    .mustAnswerQuestions as unknown[]
                ).filter((item): item is string => typeof item === "string")
              : undefined,
            forbiddenEvidenceTypes: Array.isArray(
              (input.researchPreferences as Record<string, unknown>)
                .forbiddenEvidenceTypes,
            )
              ? (
                  (input.researchPreferences as Record<string, unknown>)
                    .forbiddenEvidenceTypes as unknown[]
                ).filter((item): item is string => typeof item === "string")
              : undefined,
            preferredSources: Array.isArray(
              (input.researchPreferences as Record<string, unknown>)
                .preferredSources,
            )
              ? (
                  (input.researchPreferences as Record<string, unknown>)
                    .preferredSources as unknown[]
                ).filter((item): item is string => typeof item === "string")
              : undefined,
            freshnessWindowDays:
              typeof (input.researchPreferences as Record<string, unknown>)
                .freshnessWindowDays === "number"
                ? ((input.researchPreferences as Record<string, unknown>)
                    .freshnessWindowDays as number)
                : undefined,
          }
        : undefined,
    taskContract: parseResearchTaskContract(input.taskContract),
  };
}

function createFallbackBrief(state: CompanyResearchGraphState) {
  return {
    companyName: state.researchInput.companyName,
    researchGoal: state.query,
    focusConcepts: state.researchInput.focusConcepts ?? [],
    keyQuestions: [],
  };
}

function summarizeCollectorState(
  state: CompanyResearchGraphState,
  collectorKey:
    | "official_sources"
    | "financial_sources"
    | "news_sources"
    | "industry_sources",
) {
  const evidence = state.collectedEvidenceByCollector?.[collectorKey] ?? [];
  const runInfo = state.collectorRunInfo?.[collectorKey];

  return {
    collectorKey,
    rawCount: evidence.length,
    firstPartyCount: evidence.filter((item) => item.isFirstParty).length,
    configured: runInfo?.configured ?? false,
    queries: runInfo?.queries ?? [],
    notes: runInfo?.notes ?? [],
  };
}

function findUnitByCapability(
  units: CompanyResearchGraphState["researchUnits"],
  capability: string,
) {
  return (units ?? []).find((unit) => unit.capability === capability);
}

abstract class CompanyResearchLangGraphBase<
  NodeKey extends CompanyResearchNodeKey,
> extends BaseWorkflowLangGraph<CompanyResearchGraphState, NodeKey> {
  readonly templateCode = COMPANY_RESEARCH_TEMPLATE_CODE;

  buildInitialState(
    params: WorkflowGraphBuildInitialStateParams,
  ): CompanyResearchGraphState {
    return {
      runId: params.runId,
      userId: params.userId,
      query: params.query,
      progressPercent: params.progressPercent,
      resumeFromNodeKey: undefined,
      currentNodeKey: undefined,
      researchInput: toResearchInput(params.input),
      taskContract: parseResearchTaskContract(params.input.taskContract),
      researchRuntimeConfig: resolveResearchRuntimeConfig(
        params.templateGraphConfig,
      ),
      errors: [],
    };
  }

  mergeNodeResult(
    state: WorkflowGraphState,
    nodeKey: WorkflowNodeKey,
    result: import("~/modules/research/server/domain/workflow/flow-spec").NodeResult,
  ) {
    return {
      ...state,
      ...result.data,
      currentNodeKey: nodeKey,
      lastCompletedNodeKey: nodeKey,
    };
  }

  getRunResult(state: WorkflowGraphState): Record<string, unknown> {
    const companyState = state as CompanyResearchGraphState;

    return (companyState.finalReport ?? {
      generatedAt: new Date().toISOString(),
    }) as Record<string, unknown>;
  }
}

export class LegacyCompanyResearchLangGraph extends CompanyResearchLangGraphBase<LegacyNodeKey> {
  readonly templateVersion = 1;

  constructor(companyResearchService: CompanyResearchAgentService) {
    const nodeExecutors: Record<LegacyNodeKey, NodeExecutor> = {
      agent1_company_briefing: async (state) => ({
        brief: await companyResearchService.buildResearchBrief(
          state.researchInput,
        ),
      }),
      agent2_concept_mapping: async (state) => ({
        conceptInsights: await companyResearchService.mapConceptInsights(
          state.brief ?? createFallbackBrief(state),
        ),
      }),
      agent3_question_design: async (state) => ({
        deepQuestions: await companyResearchService.designDeepQuestions({
          brief: state.brief ?? createFallbackBrief(state),
          conceptInsights: state.conceptInsights ?? [],
        }),
      }),
      agent4_evidence_collection: async (state) => {
        const collected = await companyResearchService.collectEvidence({
          brief: state.brief ?? createFallbackBrief(state),
          questions: state.deepQuestions ?? [],
        });

        return {
          evidence: collected.evidence,
          crawlerSummary: collected.crawler,
        };
      },
      agent5_investment_synthesis: async (state) => {
        const brief = state.brief ?? createFallbackBrief(state);
        const findings = await companyResearchService.answerQuestions({
          brief,
          questions: state.deepQuestions ?? [],
          evidence: state.evidence ?? [],
        });
        const verdict = await companyResearchService.buildVerdict({
          brief,
          conceptInsights: state.conceptInsights ?? [],
          findings,
        });
        const confidenceAnalysis =
          await companyResearchService.analyzeConfidence({
            brief,
            findings,
            verdict,
            evidence: state.evidence ?? [],
          });

        return {
          findings,
          finalReport: companyResearchService.buildFinalReport({
            brief,
            conceptInsights: state.conceptInsights ?? [],
            deepQuestions: state.deepQuestions ?? [],
            findings,
            evidence: state.evidence ?? [],
            crawler: state.crawlerSummary ?? {
              provider: "tavily",
              configured: false,
              queries: [],
              notes: ["No crawler notes available."],
            },
            verdict,
            confidenceAnalysis,
          }),
        };
      },
    };

    const graphBuilder = new StateGraph(
      WorkflowState,
    ) as unknown as CompanyGraphBuilder;
    addWorkflowNodes(
      graphBuilder,
      COMPANY_RESEARCH_V1_NODE_KEYS,
      nodeExecutors,
    );
    addResumeStart(graphBuilder, COMPANY_RESEARCH_V1_NODE_KEYS);
    graphBuilder.addEdge("agent1_company_briefing", "agent2_concept_mapping");
    graphBuilder.addEdge("agent2_concept_mapping", "agent3_question_design");
    graphBuilder.addEdge(
      "agent3_question_design",
      "agent4_evidence_collection",
    );
    graphBuilder.addEdge(
      "agent4_evidence_collection",
      "agent5_investment_synthesis",
    );
    graphBuilder.addEdge("agent5_investment_synthesis", END);

    super({
      graph: graphBuilder.compile(),
      nodeOrder: COMPANY_RESEARCH_V1_NODE_KEYS,
      spec: getFlowSpec(COMPANY_RESEARCH_TEMPLATE_CODE, 1),
    });
  }

  getNodeOutput(nodeKey: WorkflowNodeKey, state: WorkflowGraphState) {
    const companyState = state as CompanyResearchGraphState;

    if (nodeKey === "agent1_company_briefing") {
      return { brief: companyState.brief };
    }
    if (nodeKey === "agent2_concept_mapping") {
      return { conceptInsights: companyState.conceptInsights };
    }
    if (nodeKey === "agent3_question_design") {
      return { deepQuestions: companyState.deepQuestions };
    }
    if (nodeKey === "agent4_evidence_collection") {
      return {
        evidenceCount: companyState.evidence?.length ?? 0,
        crawlerSummary: companyState.crawlerSummary,
      };
    }

    return {
      findingCount: companyState.findings?.length ?? 0,
      finalReport: companyState.finalReport,
    };
  }

  getNodeEventPayload(nodeKey: WorkflowNodeKey, state: WorkflowGraphState) {
    const companyState = state as CompanyResearchGraphState;

    if (nodeKey === "agent3_question_design") {
      return {
        questionCount: companyState.deepQuestions?.length ?? 0,
      };
    }
    if (nodeKey === "agent4_evidence_collection") {
      return {
        evidenceCount: companyState.evidence?.length ?? 0,
      };
    }
    if (nodeKey === "agent5_investment_synthesis") {
      return {
        findingCount: companyState.findings?.length ?? 0,
        confidenceStatus:
          companyState.finalReport?.confidenceAnalysis?.status ?? "UNAVAILABLE",
      };
    }

    return {};
  }
}

export class CompanyResearchLangGraph extends CompanyResearchLangGraphBase<V2NodeKey> {
  readonly templateVersion = 2;

  protected getResumeNodeKey(startNodeIndex?: number): V2NodeKey | undefined {
    if (startNodeIndex === undefined) {
      return undefined;
    }

    const requestedNodeKey = COMPANY_RESEARCH_NODE_KEYS[startNodeIndex];
    if (
      requestedNodeKey === "collector_official_sources" ||
      requestedNodeKey === "collector_financial_sources" ||
      requestedNodeKey === "collector_news_sources" ||
      requestedNodeKey === "collector_industry_sources"
    ) {
      return "agent4_source_grounding";
    }

    return super.getResumeNodeKey(startNodeIndex) as V2NodeKey | undefined;
  }

  constructor(companyResearchService: CompanyResearchAgentService) {
    const nodeExecutors: Record<V2NodeKey, NodeExecutor> = {
      agent1_company_briefing: async (state) => ({
        brief: await companyResearchService.buildResearchBrief(
          state.researchInput,
        ),
      }),
      agent2_concept_mapping: async (state) => ({
        conceptInsights: await companyResearchService.mapConceptInsights(
          state.brief ?? createFallbackBrief(state),
        ),
      }),
      agent3_question_design: async (state) => ({
        deepQuestions: await companyResearchService.designDeepQuestions({
          brief: state.brief ?? createFallbackBrief(state),
          conceptInsights: state.conceptInsights ?? [],
        }),
      }),
      agent4_source_grounding: async (state) => {
        const grounded = companyResearchService.groundSources({
          input: state.researchInput,
          brief: state.brief ?? createFallbackBrief(state),
        });
        return {
          groundedSources: grounded.groundedSources,
          collectionNotes: grounded.notes,
        };
      },
      collector_official_sources: async (state) =>
        companyResearchService.buildCollectorState(
          await companyResearchService.collectOfficialSources({
            brief: state.brief ?? createFallbackBrief(state),
            groundedSources: state.groundedSources ?? [],
          }),
        ),
      collector_financial_sources: async (state) =>
        companyResearchService.buildCollectorState(
          await companyResearchService.collectFinancialSources({
            brief: state.brief ?? createFallbackBrief(state),
            conceptInsights: state.conceptInsights ?? [],
          }),
        ),
      collector_news_sources: async (state) =>
        companyResearchService.buildCollectorState(
          await companyResearchService.collectNewsSources({
            brief: state.brief ?? createFallbackBrief(state),
            questions: state.deepQuestions ?? [],
            groundedSources: state.groundedSources ?? [],
          }),
        ),
      collector_industry_sources: async (state) =>
        companyResearchService.buildCollectorState(
          await companyResearchService.collectIndustrySources({
            brief: state.brief ?? createFallbackBrief(state),
            questions: state.deepQuestions ?? [],
          }),
        ),
      agent9_evidence_curation: async (state) => {
        const curated = companyResearchService.curateEvidence({
          brief: state.brief ?? createFallbackBrief(state),
          questions: state.deepQuestions ?? [],
          collectedEvidenceByCollector:
            state.collectedEvidenceByCollector ?? {},
          collectorRunInfo: state.collectorRunInfo ?? {},
          collectionNotes: state.collectionNotes ?? [],
        });

        return {
          evidence: curated.evidence,
          references: curated.references,
          collectionSummary: curated.collectionSummary,
          crawlerSummary: curated.crawler,
        };
      },
      agent10_reference_enrichment: async (state) =>
        companyResearchService.enrichReferences({
          references: state.references ?? [],
          evidence: state.evidence ?? [],
        }),
      agent11_investment_synthesis: async (state) => {
        const brief = state.brief ?? createFallbackBrief(state);
        const findings = await companyResearchService.answerQuestions({
          brief,
          questions: state.deepQuestions ?? [],
          evidence: state.evidence ?? [],
        });
        const verdict = await companyResearchService.buildVerdict({
          brief,
          conceptInsights: state.conceptInsights ?? [],
          findings,
        });
        const confidenceAnalysis =
          await companyResearchService.analyzeConfidence({
            brief,
            findings,
            verdict,
            evidence: state.evidence ?? [],
            references: state.references ?? [],
          });

        return {
          findings,
          finalReport: companyResearchService.buildFinalReport({
            brief,
            conceptInsights: state.conceptInsights ?? [],
            deepQuestions: state.deepQuestions ?? [],
            findings,
            evidence: state.evidence ?? [],
            references: state.references ?? [],
            collectionSummary: state.collectionSummary as
              | CompanyResearchCollectionSummary
              | undefined,
            crawler: state.crawlerSummary ?? {
              provider: "tavily",
              configured: false,
              queries: [],
              notes: ["No crawler notes available."],
            },
            verdict,
            confidenceAnalysis,
          }),
        };
      },
    };

    const graphBuilder = new StateGraph(
      WorkflowState,
    ) as unknown as CompanyGraphBuilder;
    addWorkflowNodes(graphBuilder, COMPANY_RESEARCH_NODE_KEYS, nodeExecutors);
    addResumeStart(graphBuilder, COMPANY_RESEARCH_NODE_KEYS);
    graphBuilder.addEdge("agent1_company_briefing", "agent2_concept_mapping");
    graphBuilder.addEdge("agent2_concept_mapping", "agent3_question_design");
    graphBuilder.addEdge("agent3_question_design", "agent4_source_grounding");
    addFanOutAndJoinEdges(graphBuilder, {
      startNode: "agent4_source_grounding",
      parallelNodes: [
        "collector_official_sources",
        "collector_financial_sources",
        "collector_news_sources",
        "collector_industry_sources",
      ],
      joinNode: "agent9_evidence_curation",
    });
    graphBuilder.addEdge(
      "agent9_evidence_curation",
      "agent10_reference_enrichment",
    );
    graphBuilder.addEdge(
      "agent10_reference_enrichment",
      "agent11_investment_synthesis",
    );
    graphBuilder.addEdge("agent11_investment_synthesis", END);

    super({
      graph: graphBuilder.compile(),
      nodeOrder: COMPANY_RESEARCH_NODE_KEYS,
      spec: getFlowSpec(COMPANY_RESEARCH_TEMPLATE_CODE, 2),
    });
  }

  getNodeOutput(nodeKey: WorkflowNodeKey, state: WorkflowGraphState) {
    const companyState = state as CompanyResearchGraphState;

    if (nodeKey === "agent1_company_briefing") {
      return { brief: companyState.brief };
    }
    if (nodeKey === "agent2_concept_mapping") {
      return { conceptInsights: companyState.conceptInsights };
    }
    if (nodeKey === "agent3_question_design") {
      return { deepQuestions: companyState.deepQuestions };
    }
    if (nodeKey === "agent4_source_grounding") {
      return {
        groundedSources: companyState.groundedSources,
        firstPartySeedCount:
          companyState.groundedSources?.filter((item) => item.isFirstParty)
            .length ?? 0,
      };
    }
    if (
      nodeKey === "collector_official_sources" ||
      nodeKey === "collector_financial_sources" ||
      nodeKey === "collector_news_sources" ||
      nodeKey === "collector_industry_sources"
    ) {
      return summarizeCollectorState(
        companyState,
        nodeKey.replace("collector_", "") as Parameters<
          typeof summarizeCollectorState
        >[1],
      );
    }
    if (nodeKey === "agent9_evidence_curation") {
      return {
        evidenceCount: companyState.evidence?.length ?? 0,
        referenceCount: companyState.references?.length ?? 0,
        collectionSummary: companyState.collectionSummary,
      };
    }
    if (nodeKey === "agent10_reference_enrichment") {
      return {
        evidenceCount: companyState.evidence?.length ?? 0,
        referenceCount: companyState.references?.length ?? 0,
      };
    }

    return {
      findingCount: companyState.findings?.length ?? 0,
      finalReport: companyState.finalReport,
    };
  }

  getNodeEventPayload(nodeKey: WorkflowNodeKey, state: WorkflowGraphState) {
    const companyState = state as CompanyResearchGraphState;

    if (nodeKey === "agent3_question_design") {
      return {
        questionCount: companyState.deepQuestions?.length ?? 0,
      };
    }
    if (nodeKey === "agent4_source_grounding") {
      return {
        groundedSourceCount: companyState.groundedSources?.length ?? 0,
        firstPartyCount:
          companyState.groundedSources?.filter((item) => item.isFirstParty)
            .length ?? 0,
      };
    }
    if (
      nodeKey === "collector_official_sources" ||
      nodeKey === "collector_financial_sources" ||
      nodeKey === "collector_news_sources" ||
      nodeKey === "collector_industry_sources"
    ) {
      return summarizeCollectorState(
        companyState,
        nodeKey.replace("collector_", "") as Parameters<
          typeof summarizeCollectorState
        >[1],
      );
    }
    if (nodeKey === "agent9_evidence_curation") {
      return {
        rawCount: companyState.collectionSummary?.totalRawCount ?? 0,
        curatedCount: companyState.collectionSummary?.totalCuratedCount ?? 0,
        referenceCount:
          companyState.collectionSummary?.totalReferenceCount ?? 0,
        firstPartyCount:
          companyState.collectionSummary?.totalFirstPartyCount ?? 0,
      };
    }
    if (nodeKey === "agent10_reference_enrichment") {
      return {
        evidenceCount: companyState.evidence?.length ?? 0,
        referenceCount: companyState.references?.length ?? 0,
      };
    }
    if (nodeKey === "agent11_investment_synthesis") {
      return {
        findingCount: companyState.findings?.length ?? 0,
        confidenceStatus:
          companyState.finalReport?.confidenceAnalysis?.status ?? "UNAVAILABLE",
      };
    }

    return {};
  }
}

export class ODRCompanyResearchLangGraph extends CompanyResearchLangGraphBase<V3NodeKey> {
  readonly templateVersion = 3;

  constructor(workflowService: CompanyResearchWorkflowService) {
    const nodeExecutors: Record<V3NodeKey, NodeExecutor> = {
      agent0_clarify_scope: async (state) => {
        if (!state.researchRuntimeConfig) {
          return {};
        }

        const clarification = await workflowService.clarifyScope(
          state.researchInput,
          state.researchRuntimeConfig,
        );

        if (clarification.needClarification) {
          throw new WorkflowPauseError(
            clarification.question,
            "clarification_required",
            {
              clarificationRequest: clarification,
              currentNodeKey: "agent0_clarify_scope",
            },
          );
        }

        return {
          clarificationRequest: clarification,
        };
      },
      agent1_write_research_brief: async (state) => {
        if (!state.researchRuntimeConfig) {
          return {};
        }

        const researchBrief = await workflowService.buildBrief(
          state.researchInput,
          state.researchRuntimeConfig,
          state.clarificationRequest?.verification,
        );

        return {
          researchBrief,
          brief: {
            companyName:
              researchBrief.companyName ?? state.researchInput.companyName,
            stockCode: researchBrief.stockCode,
            officialWebsite: researchBrief.officialWebsite,
            researchGoal: researchBrief.researchGoal,
            focusConcepts: researchBrief.focusConcepts,
            keyQuestions: researchBrief.keyQuestions,
          },
        };
      },
      agent2_plan_research_units: async (state) => {
        if (!state.researchRuntimeConfig) {
          return {};
        }

        return workflowService.planUnits({
          state,
          runtimeConfig: state.researchRuntimeConfig,
        });
      },
      agent3_execute_research_units: async (state) => {
        if (!state.researchRuntimeConfig) {
          return {};
        }

        return workflowService.executeUnits({
          state,
          runtimeConfig: state.researchRuntimeConfig,
          units: state.researchUnits ?? [],
        });
      },
      agent4_evidence_curation: async (state) => {
        const curated = workflowService.curateEvidence(state);
        return {
          evidence: curated.evidence,
          references: curated.references,
          collectionSummary: curated.collectionSummary,
          crawlerSummary: curated.crawler,
        };
      },
      agent5_gap_analysis: async (state) => {
        if (!state.researchRuntimeConfig) {
          return {};
        }

        const result = await workflowService.runGapLoop({
          state,
          runtimeConfig: state.researchRuntimeConfig,
        });

        return {
          ...result.state,
          gapAnalysis: result.gapAnalysis,
        };
      },
      agent6_compress_findings: async (state) => {
        if (!state.researchRuntimeConfig) {
          return {};
        }

        return {
          compressedFindings: await workflowService.compressFindings(
            state,
            state.researchRuntimeConfig,
          ),
        };
      },
      agent7_reference_enrichment: async (state) =>
        workflowService.enrichReferences(state),
      agent8_investment_synthesis: async (state) => {
        if (!state.researchRuntimeConfig) {
          return {};
        }

        const finalReport = await workflowService.finalizeReport({
          state,
          runtimeConfig: state.researchRuntimeConfig,
        });
        return {
          findings: finalReport.findings,
          finalReport,
        };
      },
    };

    const graphBuilder = new StateGraph(
      WorkflowState,
    ) as unknown as CompanyGraphBuilder;
    addWorkflowNodes(
      graphBuilder,
      COMPANY_RESEARCH_V3_NODE_KEYS,
      nodeExecutors,
    );
    addResumeStart(graphBuilder, COMPANY_RESEARCH_V3_NODE_KEYS);
    addSequentialEdges(graphBuilder, COMPANY_RESEARCH_V3_NODE_KEYS);

    super({
      graph: graphBuilder.compile(),
      nodeOrder: COMPANY_RESEARCH_V3_NODE_KEYS,
      spec: getFlowSpec(COMPANY_RESEARCH_TEMPLATE_CODE, 3),
    });
  }

  getNodeOutput(nodeKey: WorkflowNodeKey, state: WorkflowGraphState) {
    const companyState = state as CompanyResearchGraphState;

    if (nodeKey === "agent0_clarify_scope") {
      return {
        clarificationRequest: companyState.clarificationRequest,
      };
    }
    if (nodeKey === "agent1_write_research_brief") {
      return {
        researchBrief: companyState.researchBrief,
        brief: companyState.brief,
      };
    }
    if (nodeKey === "agent2_plan_research_units") {
      return {
        plannedUnitCount: companyState.researchUnits?.length ?? 0,
        questionCount: companyState.deepQuestions?.length ?? 0,
      };
    }
    if (nodeKey === "agent3_execute_research_units") {
      return {
        noteCount: companyState.researchNotes?.length ?? 0,
        unitRunCount: companyState.researchUnitRuns?.length ?? 0,
        rawCollectors: Object.keys(
          companyState.collectedEvidenceByCollector ?? {},
        ).length,
      };
    }
    if (nodeKey === "agent4_evidence_curation") {
      return {
        evidenceCount: companyState.evidence?.length ?? 0,
        referenceCount: companyState.references?.length ?? 0,
        collectionSummary: companyState.collectionSummary,
      };
    }
    if (nodeKey === "agent5_gap_analysis") {
      return {
        gapAnalysis: companyState.gapAnalysis,
      };
    }
    if (nodeKey === "agent6_compress_findings") {
      return {
        compressedFindings: companyState.compressedFindings,
      };
    }
    if (nodeKey === "agent7_reference_enrichment") {
      return {
        referenceCount: companyState.references?.length ?? 0,
      };
    }

    return {
      findingCount: companyState.findings?.length ?? 0,
      finalReport: companyState.finalReport,
    };
  }

  getNodeEventPayload(nodeKey: WorkflowNodeKey, state: WorkflowGraphState) {
    const companyState = state as CompanyResearchGraphState;

    if (nodeKey === "agent0_clarify_scope") {
      return {
        clarificationRequired:
          companyState.clarificationRequest?.needClarification ?? false,
        missingScopeFields:
          companyState.clarificationRequest?.missingScopeFields ?? [],
        question: companyState.clarificationRequest?.question,
        verification: companyState.clarificationRequest?.verification,
        suggestedInputPatch:
          companyState.clarificationRequest?.suggestedInputPatch ?? {},
      };
    }
    if (nodeKey === "agent2_plan_research_units") {
      return {
        plannedUnitCount: companyState.researchUnits?.length ?? 0,
        questionCount: companyState.deepQuestions?.length ?? 0,
      };
    }
    if (nodeKey === "agent3_execute_research_units") {
      return {
        noteCount: companyState.researchNotes?.length ?? 0,
        collectorCount: Object.keys(
          companyState.collectedEvidenceByCollector ?? {},
        ).length,
      };
    }
    if (nodeKey === "agent4_evidence_curation") {
      return {
        rawCount: companyState.collectionSummary?.totalRawCount ?? 0,
        curatedCount: companyState.collectionSummary?.totalCuratedCount ?? 0,
        referenceCount:
          companyState.collectionSummary?.totalReferenceCount ?? 0,
      };
    }
    if (nodeKey === "agent5_gap_analysis") {
      return {
        requiresFollowup: companyState.gapAnalysis?.requiresFollowup ?? false,
        missingAreaCount: companyState.gapAnalysis?.missingAreas.length ?? 0,
      };
    }
    if (nodeKey === "agent8_investment_synthesis") {
      return {
        findingCount: companyState.findings?.length ?? 0,
        confidenceStatus:
          companyState.finalReport?.confidenceAnalysis?.status ?? "UNAVAILABLE",
      };
    }

    return {};
  }
}

export class CompanyResearchContractLangGraph extends CompanyResearchLangGraphBase<V4NodeKey> {
  readonly templateVersion = 4;

  protected getResumeNodeKey(startNodeIndex?: number): V4NodeKey | undefined {
    if (startNodeIndex === undefined) {
      return undefined;
    }

    const requestedNodeKey = COMPANY_RESEARCH_V4_NODE_KEYS[startNodeIndex];
    if (
      requestedNodeKey === "collector_official_sources" ||
      requestedNodeKey === "collector_financial_sources" ||
      requestedNodeKey === "collector_news_sources" ||
      requestedNodeKey === "collector_industry_sources"
    ) {
      return "agent3_source_grounding";
    }

    return super.getResumeNodeKey(startNodeIndex) as V4NodeKey | undefined;
  }

  constructor(workflowService: CompanyResearchWorkflowService) {
    const nodeExecutors: Record<V4NodeKey, NodeExecutor> = {
      agent0_clarify_scope: async (state) => {
        if (!state.researchRuntimeConfig) {
          return {};
        }

        const clarification = await workflowService.clarifyScope(
          state.researchInput,
          state.researchRuntimeConfig,
        );

        if (clarification.needClarification) {
          throw new WorkflowPauseError(
            clarification.question,
            "clarification_required",
            {
              clarificationRequest: clarification,
              currentNodeKey: "agent0_clarify_scope",
            },
          );
        }

        return {
          clarificationRequest: clarification,
        };
      },
      agent1_write_research_brief: async (state) => {
        if (!state.researchRuntimeConfig) {
          return {};
        }

        const taskContract = await workflowService.buildTaskContract(
          state.researchInput,
          state.researchRuntimeConfig,
        );
        const researchBrief = await workflowService.buildBrief(
          state.researchInput,
          state.researchRuntimeConfig,
          state.clarificationRequest?.verification,
        );

        return {
          taskContract,
          researchBrief,
          brief: {
            companyName:
              researchBrief.companyName ?? state.researchInput.companyName,
            stockCode: researchBrief.stockCode,
            officialWebsite: researchBrief.officialWebsite,
            researchGoal: researchBrief.researchGoal,
            focusConcepts: researchBrief.focusConcepts,
            keyQuestions: researchBrief.keyQuestions,
          },
        };
      },
      agent2_plan_research_units: async (state) => {
        if (!state.researchRuntimeConfig) {
          return {};
        }

        return workflowService.planUnits({
          state,
          runtimeConfig: state.researchRuntimeConfig,
        });
      },
      agent3_source_grounding: async (state) =>
        workflowService.groundSources(state),
      collector_official_sources: async (state) => {
        if (!state.researchRuntimeConfig) {
          return {};
        }
        const unit = findUnitByCapability(
          state.researchUnits,
          "official_search",
        );
        if (!unit) {
          return {};
        }
        return workflowService.executeCollectorUnit({
          unit,
          state,
          runtimeConfig: state.researchRuntimeConfig,
        });
      },
      collector_financial_sources: async (state) => {
        if (!state.researchRuntimeConfig) {
          return {};
        }
        const unit = findUnitByCapability(
          state.researchUnits,
          "financial_pack",
        );
        if (!unit) {
          return {};
        }
        return workflowService.executeCollectorUnit({
          unit,
          state,
          runtimeConfig: state.researchRuntimeConfig,
        });
      },
      collector_news_sources: async (state) => {
        if (!state.researchRuntimeConfig) {
          return {};
        }
        const unit = findUnitByCapability(state.researchUnits, "news_search");
        if (!unit) {
          return {};
        }
        return workflowService.executeCollectorUnit({
          unit,
          state,
          runtimeConfig: state.researchRuntimeConfig,
        });
      },
      collector_industry_sources: async (state) => {
        if (!state.researchRuntimeConfig) {
          return {};
        }
        const unit = findUnitByCapability(
          state.researchUnits,
          "industry_search",
        );
        if (!unit) {
          return {};
        }
        return workflowService.executeCollectorUnit({
          unit,
          state,
          runtimeConfig: state.researchRuntimeConfig,
        });
      },
      agent4_synthesis: async (state) => {
        const curated = workflowService.synthesizeEvidence(state);
        return {
          evidence: curated.evidence,
          references: curated.references,
          collectionSummary: curated.collectionSummary,
          crawlerSummary: curated.crawler,
        };
      },
      agent5_gap_analysis_and_replan: async (state) => {
        if (!state.researchRuntimeConfig) {
          return {};
        }

        const result = await workflowService.runGapLoop({
          state,
          runtimeConfig: state.researchRuntimeConfig,
        });

        return {
          ...result.state,
          gapAnalysis: result.gapAnalysis,
        };
      },
      agent6_compress_findings: async (state) => {
        if (!state.researchRuntimeConfig) {
          return {};
        }

        return {
          compressedFindings: await workflowService.compressFindings(
            state,
            state.researchRuntimeConfig,
          ),
        };
      },
      agent7_reference_enrichment: async (state) =>
        workflowService.enrichReferences(state),
      agent8_finalize_report: async (state) => {
        if (!state.researchRuntimeConfig) {
          return {};
        }

        const finalReport = await workflowService.finalizeReport({
          state,
          runtimeConfig: state.researchRuntimeConfig,
        });

        return {
          findings: finalReport.findings,
          finalReport,
        };
      },
      agent9_reflection: async (state) => ({
        reflection: state.finalReport?.reflection,
        contractScore: state.finalReport?.contractScore,
        qualityFlags: state.finalReport?.qualityFlags,
        missingRequirements: state.finalReport?.missingRequirements,
      }),
    };

    const graphBuilder = new StateGraph(
      WorkflowState,
    ) as unknown as CompanyGraphBuilder;
    addWorkflowNodes(
      graphBuilder,
      COMPANY_RESEARCH_V4_NODE_KEYS,
      nodeExecutors,
    );
    addResumeStart(graphBuilder, COMPANY_RESEARCH_V4_NODE_KEYS);
    graphBuilder.addEdge("agent0_clarify_scope", "agent1_write_research_brief");
    graphBuilder.addEdge(
      "agent1_write_research_brief",
      "agent2_plan_research_units",
    );
    graphBuilder.addEdge(
      "agent2_plan_research_units",
      "agent3_source_grounding",
    );
    addFanOutAndJoinEdges(graphBuilder, {
      startNode: "agent3_source_grounding",
      parallelNodes: [
        "collector_official_sources",
        "collector_financial_sources",
        "collector_news_sources",
        "collector_industry_sources",
      ],
      joinNode: "agent4_synthesis",
    });
    graphBuilder.addEdge("agent4_synthesis", "agent5_gap_analysis_and_replan");
    graphBuilder.addEdge(
      "agent5_gap_analysis_and_replan",
      "agent6_compress_findings",
    );
    graphBuilder.addEdge(
      "agent6_compress_findings",
      "agent7_reference_enrichment",
    );
    graphBuilder.addEdge(
      "agent7_reference_enrichment",
      "agent8_finalize_report",
    );
    graphBuilder.addEdge("agent8_finalize_report", "agent9_reflection");
    graphBuilder.addEdge("agent9_reflection", END);

    super({
      graph: graphBuilder.compile(),
      nodeOrder: COMPANY_RESEARCH_V4_NODE_KEYS,
      spec: getFlowSpec(COMPANY_RESEARCH_TEMPLATE_CODE, 4),
    });
  }

  getNodeOutput(nodeKey: WorkflowNodeKey, state: WorkflowGraphState) {
    const companyState = state as CompanyResearchGraphState;

    if (nodeKey === "agent1_write_research_brief") {
      return {
        taskContract: companyState.taskContract,
        researchBrief: companyState.researchBrief,
        brief: companyState.brief,
      };
    }
    if (nodeKey === "agent2_plan_research_units") {
      return {
        plannedUnitCount: companyState.researchUnits?.length ?? 0,
        questionCount: companyState.deepQuestions?.length ?? 0,
      };
    }
    if (nodeKey === "agent3_source_grounding") {
      return {
        groundedSources: companyState.groundedSources,
        firstPartySeedCount:
          companyState.groundedSources?.filter((item) => item.isFirstParty)
            .length ?? 0,
      };
    }
    if (
      nodeKey === "collector_official_sources" ||
      nodeKey === "collector_financial_sources" ||
      nodeKey === "collector_news_sources" ||
      nodeKey === "collector_industry_sources"
    ) {
      return summarizeCollectorState(
        companyState,
        nodeKey.replace("collector_", "") as Parameters<
          typeof summarizeCollectorState
        >[1],
      );
    }
    if (nodeKey === "agent4_synthesis") {
      return {
        evidenceCount: companyState.evidence?.length ?? 0,
        referenceCount: companyState.references?.length ?? 0,
        collectionSummary: companyState.collectionSummary,
      };
    }
    if (nodeKey === "agent5_gap_analysis_and_replan") {
      return {
        gapAnalysis: companyState.gapAnalysis,
        replanCount: companyState.replanRecords?.length ?? 0,
      };
    }
    if (nodeKey === "agent6_compress_findings") {
      return {
        compressedFindings: companyState.compressedFindings,
      };
    }
    if (nodeKey === "agent7_reference_enrichment") {
      return {
        referenceCount: companyState.references?.length ?? 0,
      };
    }
    if (nodeKey === "agent8_finalize_report") {
      return {
        findingCount: companyState.findings?.length ?? 0,
        finalReport: companyState.finalReport,
      };
    }

    return {
      reflection: companyState.reflection,
      contractScore: companyState.contractScore,
      qualityFlags: companyState.qualityFlags,
      missingRequirements: companyState.missingRequirements,
    };
  }

  getNodeEventPayload(nodeKey: WorkflowNodeKey, state: WorkflowGraphState) {
    const companyState = state as CompanyResearchGraphState;

    if (nodeKey === "agent0_clarify_scope") {
      return {
        clarificationRequired:
          companyState.clarificationRequest?.needClarification ?? false,
        missingScopeFields:
          companyState.clarificationRequest?.missingScopeFields ?? [],
        question: companyState.clarificationRequest?.question,
        verification: companyState.clarificationRequest?.verification,
        suggestedInputPatch:
          companyState.clarificationRequest?.suggestedInputPatch ?? {},
      };
    }

    if (nodeKey === "agent1_write_research_brief") {
      return {
        analysisDepth: companyState.taskContract?.analysisDepth ?? "standard",
        citationRequired: companyState.taskContract?.citationRequired ?? false,
      };
    }
    if (nodeKey === "agent2_plan_research_units") {
      return {
        plannedUnitCount: companyState.researchUnits?.length ?? 0,
        questionCount: companyState.deepQuestions?.length ?? 0,
      };
    }
    if (
      nodeKey === "collector_official_sources" ||
      nodeKey === "collector_financial_sources" ||
      nodeKey === "collector_news_sources" ||
      nodeKey === "collector_industry_sources"
    ) {
      return summarizeCollectorState(
        companyState,
        nodeKey.replace("collector_", "") as Parameters<
          typeof summarizeCollectorState
        >[1],
      );
    }
    if (nodeKey === "agent4_synthesis") {
      return {
        rawCount: companyState.collectionSummary?.totalRawCount ?? 0,
        curatedCount: companyState.collectionSummary?.totalCuratedCount ?? 0,
        referenceCount:
          companyState.collectionSummary?.totalReferenceCount ?? 0,
        firstPartyRatio:
          (companyState.collectionSummary?.totalReferenceCount ?? 0) > 0
            ? Number(
                (
                  (companyState.collectionSummary?.totalFirstPartyCount ?? 0) /
                  (companyState.collectionSummary?.totalReferenceCount ?? 1)
                ).toFixed(2),
              )
            : 0,
      };
    }
    if (nodeKey === "agent5_gap_analysis_and_replan") {
      return {
        requiresFollowup: companyState.gapAnalysis?.requiresFollowup ?? false,
        missingAreaCount: companyState.gapAnalysis?.missingAreas.length ?? 0,
        replanCount: companyState.replanRecords?.length ?? 0,
      };
    }
    if (nodeKey === "agent9_reflection") {
      return {
        contractScore: companyState.contractScore ?? null,
        qualityFlags: companyState.qualityFlags ?? [],
      };
    }

    return {};
  }
}
