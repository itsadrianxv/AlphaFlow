import { Annotation, END, START, StateGraph } from "@langchain/langgraph";
import { IntelligenceAgentService } from "~/server/application/intelligence/intelligence-agent-service";
import type {
  QuickResearchGraphState,
  QuickResearchNodeKey,
} from "~/server/domain/workflow/types";
import { QUICK_RESEARCH_NODE_KEYS } from "~/server/domain/workflow/types";

const WorkflowState = Annotation.Root({
  runId: Annotation<string>,
  userId: Annotation<string>,
  query: Annotation<string>,
  progressPercent: Annotation<number>,
  currentNodeKey: Annotation<QuickResearchNodeKey | undefined>,
  intent: Annotation<string | undefined>,
  industryOverview: Annotation<string | undefined>,
  heatAnalysis: Annotation<
    | {
        heatScore: number;
        heatConclusion: string;
      }
    | undefined
  >,
  candidates: Annotation<
    | Array<{
        stockCode: string;
        stockName: string;
        reason: string;
        score: number;
      }>
    | undefined
  >,
  credibility: Annotation<
    | Array<{
        stockCode: string;
        credibilityScore: number;
        highlights: string[];
        risks: string[];
      }>
    | undefined
  >,
  competition: Annotation<string | undefined>,
  finalReport: Annotation<
    | {
        overview: string;
        heatScore: number;
        heatConclusion: string;
        candidates: Array<{
          stockCode: string;
          stockName: string;
          reason: string;
          score: number;
        }>;
        credibility: Array<{
          stockCode: string;
          credibilityScore: number;
          highlights: string[];
          risks: string[];
        }>;
        topPicks: Array<{
          stockCode: string;
          stockName: string;
          reason: string;
        }>;
        competitionSummary: string;
        generatedAt: string;
      }
    | undefined
  >,
  errors: Annotation<string[]>({
    reducer: (left, right) => left.concat(right),
    default: () => [],
  }),
});

type NodeExecutor = (
  state: QuickResearchGraphState,
) => Promise<Partial<QuickResearchGraphState>>;

export type QuickResearchGraphExecutionHooks = {
  onNodeStarted?: (nodeKey: QuickResearchNodeKey) => Promise<void> | void;
  onNodeProgress?: (
    nodeKey: QuickResearchNodeKey,
    payload: Record<string, unknown>,
  ) => Promise<void> | void;
  onNodeSucceeded?: (
    nodeKey: QuickResearchNodeKey,
    updatedState: QuickResearchGraphState,
  ) => Promise<void> | void;
};

export class QuickResearchLangGraph {
  private readonly intelligenceService: IntelligenceAgentService;

  private readonly nodeExecutors: Record<QuickResearchNodeKey, NodeExecutor>;

  constructor(intelligenceService: IntelligenceAgentService) {
    this.intelligenceService = intelligenceService;
    this.nodeExecutors = {
      agent1_industry_overview: async (state) => {
        const { overview } = await this.intelligenceService.generateIndustryOverview(
          state.query,
        );

        return {
          intent: state.query,
          industryOverview: overview,
        };
      },
      agent2_market_heat: async (state) => {
        const heatAnalysis = await this.intelligenceService.analyzeMarketHeat(
          state.query,
        );

        return {
          heatAnalysis: {
            heatScore: heatAnalysis.heatScore,
            heatConclusion: heatAnalysis.heatConclusion,
          },
        };
      },
      agent3_candidate_screening: async (state) => {
        const heatScore = state.heatAnalysis?.heatScore ?? 50;
        const candidates = await this.intelligenceService.screenCandidates(
          state.query,
          heatScore,
        );

        return {
          candidates,
        };
      },
      agent4_credibility_batch: async (state) => {
        const candidates = state.candidates ?? [];
        const credibility = await this.intelligenceService.evaluateCredibility(
          state.query,
          candidates,
        );

        return {
          credibility,
        };
      },
      agent5_competition_summary: async (state) => {
        const competitionSummary = await this.intelligenceService.summarizeCompetition({
          query: state.query,
          candidates: state.candidates ?? [],
          credibility: state.credibility ?? [],
        });

        const finalReport = this.intelligenceService.buildFinalReport({
          overview: state.industryOverview ?? "暂无行业概览",
          heatScore: state.heatAnalysis?.heatScore ?? 50,
          heatConclusion: state.heatAnalysis?.heatConclusion ?? "热度信息不足",
          candidates: state.candidates ?? [],
          credibility: state.credibility ?? [],
          competitionSummary,
        });

        return {
          competition: competitionSummary,
          finalReport,
        };
      },
    };
  }

  getNodeOrder() {
    return QUICK_RESEARCH_NODE_KEYS;
  }

  async execute(params: {
    initialState: QuickResearchGraphState;
    startNodeIndex?: number;
    hooks?: QuickResearchGraphExecutionHooks;
  }) {
    let state = {
      ...params.initialState,
      errors: params.initialState.errors,
    };

    const startIndex = params.startNodeIndex ?? 0;

    for (let index = startIndex; index < QUICK_RESEARCH_NODE_KEYS.length; index += 1) {
      const nodeKey = QUICK_RESEARCH_NODE_KEYS[index];
      if (!nodeKey) {
        continue;
      }
      const nodeGraph = this.buildSingleNodeGraph(nodeKey);

      await params.hooks?.onNodeStarted?.(nodeKey);
      await params.hooks?.onNodeProgress?.(nodeKey, {
        message: "节点执行中",
      });

      state = {
        ...state,
        currentNodeKey: nodeKey,
      };

      const result = (await nodeGraph.invoke(state)) as typeof WorkflowState.State;
      const progressPercent = Math.round(
        ((index + 1) / QUICK_RESEARCH_NODE_KEYS.length) * 100,
      );

      state = {
        ...(result as QuickResearchGraphState),
        currentNodeKey: nodeKey,
        progressPercent,
      };

      await params.hooks?.onNodeSucceeded?.(nodeKey, state);
    }

    return state;
  }

  private buildSingleNodeGraph(nodeKey: QuickResearchNodeKey) {
    return new StateGraph(WorkflowState)
      .addNode(nodeKey, (state) => this.nodeExecutors[nodeKey](state as QuickResearchGraphState))
      .addEdge(START, nodeKey)
      .addEdge(nodeKey, END)
      .compile();
  }
}
