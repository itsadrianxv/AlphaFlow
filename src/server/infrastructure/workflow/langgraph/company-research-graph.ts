import { Annotation, END, START, StateGraph } from "@langchain/langgraph";
import type { CompanyResearchAgentService } from "~/server/application/intelligence/company-research-agent-service";
import type {
  CompanyResearchGraphState,
  CompanyResearchInput,
  CompanyResearchNodeKey,
  WorkflowGraphState,
  WorkflowNodeKey,
} from "~/server/domain/workflow/types";
import {
  COMPANY_RESEARCH_NODE_KEYS,
  COMPANY_RESEARCH_TEMPLATE_CODE,
} from "~/server/domain/workflow/types";
import type {
  WorkflowGraphBuildInitialStateParams,
  WorkflowGraphExecutionHooks,
  WorkflowGraphRunner,
} from "~/server/infrastructure/workflow/langgraph/workflow-graph";

const WorkflowState = Annotation.Root({
  runId: Annotation<string>,
  userId: Annotation<string>,
  query: Annotation<string>,
  progressPercent: Annotation<number>,
  currentNodeKey: Annotation<CompanyResearchNodeKey | undefined>,
  researchInput: Annotation<CompanyResearchInput>,
  brief: Annotation<CompanyResearchGraphState["brief"]>,
  conceptInsights: Annotation<CompanyResearchGraphState["conceptInsights"]>,
  deepQuestions: Annotation<CompanyResearchGraphState["deepQuestions"]>,
  evidence: Annotation<CompanyResearchGraphState["evidence"]>,
  findings: Annotation<CompanyResearchGraphState["findings"]>,
  crawlerSummary: Annotation<CompanyResearchGraphState["crawlerSummary"]>,
  finalReport: Annotation<CompanyResearchGraphState["finalReport"]>,
  errors: Annotation<string[]>({
    reducer: (left, right) => left.concat(right),
    default: () => [],
  }),
});

type NodeExecutor = (
  state: CompanyResearchGraphState,
) => Promise<Partial<CompanyResearchGraphState>>;

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

export class CompanyResearchLangGraph implements WorkflowGraphRunner {
  readonly templateCode = COMPANY_RESEARCH_TEMPLATE_CODE;

  private readonly companyResearchService: CompanyResearchAgentService;

  private readonly nodeExecutors: Record<CompanyResearchNodeKey, NodeExecutor>;

  constructor(companyResearchService: CompanyResearchAgentService) {
    this.companyResearchService = companyResearchService;
    this.nodeExecutors = {
      agent1_company_briefing: async (state) => {
        const brief = await this.companyResearchService.buildResearchBrief(
          state.researchInput,
        );

        return {
          brief,
        };
      },
      agent2_concept_mapping: async (state) => {
        const conceptInsights =
          await this.companyResearchService.mapConceptInsights(
            state.brief ?? createFallbackBrief(state),
          );

        return {
          conceptInsights,
        };
      },
      agent3_question_design: async (state) => {
        const deepQuestions =
          await this.companyResearchService.designDeepQuestions({
            brief: state.brief ?? createFallbackBrief(state),
            conceptInsights: state.conceptInsights ?? [],
          });

        return {
          deepQuestions,
        };
      },
      agent4_evidence_collection: async (state) => {
        const collected = await this.companyResearchService.collectEvidence({
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
        const findings = await this.companyResearchService.answerQuestions({
          brief,
          questions: state.deepQuestions ?? [],
          evidence: state.evidence ?? [],
        });
        const verdict = await this.companyResearchService.buildVerdict({
          brief,
          conceptInsights: state.conceptInsights ?? [],
          findings,
        });
        const confidenceAnalysis =
          await this.companyResearchService.analyzeConfidence({
            brief,
            findings,
            verdict,
            evidence: state.evidence ?? [],
          });
        const finalReport = this.companyResearchService.buildFinalReport({
          brief,
          conceptInsights: state.conceptInsights ?? [],
          deepQuestions: state.deepQuestions ?? [],
          findings,
          evidence: state.evidence ?? [],
          crawler: state.crawlerSummary ?? {
            provider: "firecrawl",
            configured: false,
            queries: [],
            notes: ["No crawler notes available."],
          },
          verdict,
          confidenceAnalysis,
        });

        return {
          findings,
          finalReport,
        };
      },
    };
  }

  getNodeOrder() {
    return [...COMPANY_RESEARCH_NODE_KEYS];
  }

  buildInitialState(
    params: WorkflowGraphBuildInitialStateParams,
  ): CompanyResearchGraphState {
    return {
      runId: params.runId,
      userId: params.userId,
      query: params.query,
      progressPercent: params.progressPercent,
      currentNodeKey: undefined,
      researchInput: toResearchInput(params.input),
      errors: [],
    };
  }

  getNodeOutput(nodeKey: WorkflowNodeKey, state: WorkflowGraphState) {
    const companyState = state as CompanyResearchGraphState;

    if (nodeKey === "agent1_company_briefing") {
      return {
        brief: companyState.brief,
      };
    }

    if (nodeKey === "agent2_concept_mapping") {
      return {
        conceptInsights: companyState.conceptInsights,
      };
    }

    if (nodeKey === "agent3_question_design") {
      return {
        deepQuestions: companyState.deepQuestions,
      };
    }

    if (nodeKey === "agent4_evidence_collection") {
      return {
        evidence: companyState.evidence,
        crawlerSummary: companyState.crawlerSummary,
      };
    }

    return {
      findings: companyState.findings,
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

  mergeNodeOutput(
    state: WorkflowGraphState,
    nodeKey: WorkflowNodeKey,
    output: Record<string, unknown>,
  ) {
    return {
      ...state,
      ...output,
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

  async execute(params: {
    initialState: WorkflowGraphState;
    startNodeIndex?: number;
    hooks?: WorkflowGraphExecutionHooks;
  }) {
    let state = {
      ...(params.initialState as CompanyResearchGraphState),
      errors: (params.initialState.errors ?? []) as string[],
    };

    const startIndex = params.startNodeIndex ?? 0;

    for (
      let index = startIndex;
      index < COMPANY_RESEARCH_NODE_KEYS.length;
      index += 1
    ) {
      const nodeKey = COMPANY_RESEARCH_NODE_KEYS[index];

      if (!nodeKey) {
        continue;
      }

      const nodeGraph = this.buildSingleNodeGraph(nodeKey);

      await params.hooks?.onNodeStarted?.(nodeKey);
      await params.hooks?.onNodeProgress?.(nodeKey, {
        message: "Node is running",
      });

      state = {
        ...state,
        currentNodeKey: nodeKey,
      };

      const result = (await nodeGraph.invoke(
        state,
      )) as typeof WorkflowState.State;
      const progressPercent = Math.round(
        ((index + 1) / COMPANY_RESEARCH_NODE_KEYS.length) * 100,
      );

      state = {
        ...(result as CompanyResearchGraphState),
        currentNodeKey: nodeKey,
        progressPercent,
      };

      await params.hooks?.onNodeSucceeded?.(nodeKey, state);
    }

    return state;
  }

  private buildSingleNodeGraph(nodeKey: CompanyResearchNodeKey) {
    return new StateGraph(WorkflowState)
      .addNode(nodeKey, (state) =>
        this.nodeExecutors[nodeKey](state as CompanyResearchGraphState),
      )
      .addEdge(START, nodeKey)
      .addEdge(nodeKey, END)
      .compile();
  }
}
