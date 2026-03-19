import assert from "node:assert/strict";

process.env.SKIP_ENV_VALIDATION = process.env.SKIP_ENV_VALIDATION ?? "1";

const QUESTION = "半导体设备国产替代，未来 12 个月最关键的兑现节点是什么";
const USER_ID = "user_1";
const WORKER_ID = "notebook_worker";
const CREATED_AT = new Date("2026-03-19T00:00:00.000Z");

const { WorkflowEventType, WorkflowNodeRunStatus, WorkflowRunStatus } =
  await import("@prisma/client");
const { WorkflowCommandService } = await import(
  "~/server/application/workflow/command-service"
);
const { WorkflowExecutionService } = await import(
  "~/server/application/workflow/execution-service"
);
const { QuickResearchWorkflowService } = await import(
  "~/server/application/intelligence/quick-research-workflow-service"
);
const { QuickResearchContractLangGraph } = await import(
  "~/server/infrastructure/workflow/langgraph/quick-research-graph"
);
const { QUICK_RESEARCH_TEMPLATE_CODE, QUICK_RESEARCH_V3_NODE_KEYS } =
  await import("~/server/domain/workflow/types");
const {
  researchClarificationRequestSchema,
  researchTaskContractSchema,
  researchBriefSchema,
  researchUnitPlanListSchema,
  researchGapAnalysisSchema,
  compressedFindingsSchema,
} = await import("~/server/domain/workflow/research-schemas");

const researchPreferences = {
  researchGoal:
    "判断半导体设备国产替代在未来 12 个月最关键的兑现节点，并筛出最值得跟踪的设备龙头。",
  mustAnswerQuestions: [
    QUESTION,
    "哪些设备环节会最先从验证进入批量订单",
    "哪些公司最有机会把订单兑现成收入和利润",
  ],
  preferredSources: [
    "company announcement",
    "fab capex guidance",
    "industry media",
  ],
  freshnessWindowDays: 365,
};

const news = [
  {
    id: "news-1",
    title: "晶圆厂扩产重新强调关键设备国产验证节奏",
    summary: "扩产项目开始把设备验证通过率写入采购节奏。",
    source: "证券时报",
    publishedAt: "2026-03-10T08:00:00.000Z",
    sentiment: "positive",
    relevanceScore: 0.91,
    relatedStocks: ["002371", "688012"],
  },
  {
    id: "news-2",
    title: "存储与先进封装项目提高薄膜沉积和清洗设备本土采购比例",
    summary: "采购策略更强调重复订单与交付能力。",
    source: "中国电子报",
    publishedAt: "2026-03-08T08:00:00.000Z",
    sentiment: "positive",
    relevanceScore: 0.87,
    relatedStocks: ["002371", "688072"],
  },
  {
    id: "news-3",
    title: "设备厂开始披露更多验证转订单的细分口径",
    summary: "市场开始区分样机验证、批量验证与收入确认三种节点。",
    source: "上海证券报",
    publishedAt: "2026-03-06T08:00:00.000Z",
    sentiment: "positive",
    relevanceScore: 0.83,
    relatedStocks: ["002371", "688012", "688072"],
  },
] as const;

const candidates = [
  {
    stockCode: "002371",
    stockName: "北方华创",
    reason: "平台化覆盖刻蚀、薄膜沉积与清洗，更容易把验证转成重复订单。",
    score: 93,
  },
  {
    stockCode: "688012",
    stockName: "中微公司",
    reason: "高端刻蚀验证更深入，先进制程导入时业绩弹性最大。",
    score: 91,
  },
  {
    stockCode: "688072",
    stockName: "拓荆科技",
    reason: "薄膜沉积在存储和先进封装扩产里更接近订单兑现。",
    score: 88,
  },
] as const;

const evidenceList = [
  {
    stockCode: "002371",
    companyName: "北方华创",
    concept: "半导体设备国产替代",
    evidenceSummary:
      "平台化设备覆盖度高，验证通过后更容易获得同客户重复订单。",
    catalysts: ["验证通过后重复订单加速", "成熟制程与先进封装同时拉动收入确认"],
    risks: ["若晶圆厂资本开支延后，收入确认节奏会被推迟"],
    credibilityScore: 92,
    updatedAt: "2026-03-19T00:00:00.000Z",
  },
  {
    stockCode: "688012",
    companyName: "中微公司",
    concept: "半导体设备国产替代",
    evidenceSummary: "高端刻蚀若切入先进制程批量验证，订单兑现弹性最大。",
    catalysts: ["先进制程批量验证节点", "关键客户扩单节点"],
    risks: ["高端环节验证周期拉长会影响业绩兑现时点"],
    credibilityScore: 90,
    updatedAt: "2026-03-19T00:00:00.000Z",
  },
  {
    stockCode: "688072",
    companyName: "拓荆科技",
    concept: "半导体设备国产替代",
    evidenceSummary:
      "薄膜沉积设备受益于存储和先进封装扩产，订单确认相对更早。",
    catalysts: ["存储扩产恢复下的订单确认", "先进封装线验证转量产"],
    risks: ["单一扩产项目波动会放大季度确认节奏"],
    credibilityScore: 86,
    updatedAt: "2026-03-19T00:00:00.000Z",
  },
] as const;

const credibility = [
  {
    stockCode: "002371",
    credibilityScore: 92,
    highlights: ["重复订单兑现链路最清晰，最有机会把验证转成收入确认。"],
    risks: ["若大客户扩产节奏放缓，兑现时点会后移。"],
  },
  {
    stockCode: "688012",
    credibilityScore: 90,
    highlights: ["高端刻蚀机台若拿到批量验证，先进制程弹性最大。"],
    risks: ["先进制程验证周期本身更长，兑现需要观察重复订单。"],
  },
  {
    stockCode: "688072",
    credibilityScore: 86,
    highlights: ["薄膜沉积与先进封装扩产会更早体现订单确认。"],
    risks: ["项目集中度较高，季度收入确认节奏可能波动。"],
  },
] as const;

const confidenceAnalysis = {
  status: "COMPLETE",
  finalScore: 89,
  level: "high",
  claimCount: 3,
  supportedCount: 3,
  insufficientCount: 0,
  contradictedCount: 0,
  abstainCount: 0,
  supportRate: 1,
  insufficientRate: 0,
  contradictionRate: 0,
  abstainRate: 0,
  evidenceCoverageScore: 88,
  freshnessScore: 84,
  sourceDiversityScore: 72,
  notes: ["验证、重复订单与收入确认三类证据可以彼此印证。"],
  claims: [],
} as const;

const competitionSummary =
  "北方华创的平台化覆盖最利于把验证转成重复订单，中微公司在高端刻蚀上的先进制程弹性最大，拓荆科技则受益于薄膜沉积与先进封装扩产。";

function buildFinalReport(params: {
  overview: string;
  heatScore: number;
  heatConclusion: string;
  candidates: Array<(typeof candidates)[number]>;
  credibility: Array<(typeof credibility)[number]>;
  competitionSummary: string;
  confidenceAnalysis: typeof confidenceAnalysis;
}) {
  const topPicks = [...params.credibility]
    .sort((left, right) => right.credibilityScore - left.credibilityScore)
    .slice(0, 3)
    .map((item) => {
      const candidate = params.candidates.find(
        (candidateItem) => candidateItem.stockCode === item.stockCode,
      );
      return {
        stockCode: item.stockCode,
        stockName: candidate?.stockName ?? item.stockCode,
        reason: item.highlights[0] ?? "具备相对优势",
      };
    });

  return {
    overview: params.overview,
    heatScore: params.heatScore,
    heatConclusion: params.heatConclusion,
    candidates: params.candidates,
    credibility: params.credibility,
    topPicks,
    competitionSummary: params.competitionSummary,
    confidenceAnalysis: params.confidenceAnalysis,
    generatedAt: CREATED_AT.toISOString(),
  };
}

class DeterministicContractClient {
  calls: string[] = [];

  async completeContract(
    _messages: unknown,
    fallbackValue: unknown,
    schema: unknown,
  ) {
    if (schema === researchClarificationRequestSchema) {
      this.calls.push("clarify_scope");
      return {
        needClarification: false,
        question: "",
        verification: "范围已足够明确，可以直接进入行业研究。",
        missingScopeFields: [],
        suggestedInputPatch: {},
      };
    }

    if (schema === researchTaskContractSchema) {
      this.calls.push("task_contract");
      return {
        requiredSources: ["official", "industry", "news", "financial"],
        requiredSections: [
          "research_spec",
          "trend_analysis",
          "candidate_screening",
          "competition",
          "top_picks",
        ],
        citationRequired: false,
        analysisDepth: "deep",
        deadlineMinutes: 45,
      };
    }

    if (schema === researchBriefSchema) {
      this.calls.push("research_brief");
      return {
        query: QUESTION,
        researchGoal:
          "判断半导体设备国产替代在未来 12 个月最关键的兑现节点，并给出最值得跟踪的设备龙头排序。",
        focusConcepts: ["设备验证", "重复订单", "收入确认"],
        keyQuestions: [QUESTION],
        mustAnswerQuestions: researchPreferences.mustAnswerQuestions,
        forbiddenEvidenceTypes: [],
        preferredSources: researchPreferences.preferredSources,
        freshnessWindowDays: 365,
        scopeAssumptions: ["默认以 A 股核心设备龙头为主要跟踪对象。"],
        clarificationSummary: "范围已足够明确，可以直接进入行业研究。",
      };
    }

    if (schema === researchUnitPlanListSchema) {
      this.calls.push("plan_units");
      return [
        {
          id: "theme_overview",
          title: "国产替代主线梳理",
          objective: "确认半导体设备国产替代的主驱动与兑现链路",
          keyQuestions: [QUESTION],
          priority: "high",
          capability: "theme_overview",
          dependsOn: [],
          role: "sector_analyst",
          expectedArtifact: "trend_snapshot",
          fallbackCapabilities: ["market_heat"],
          acceptanceCriteria: [
            "明确指出未来 12 个月最重要的兑现节点。",
            "把节点拆成验证、订单和收入三个层次。",
          ],
        },
        {
          id: "market_heat",
          title: "板块热度与催化节奏",
          objective: "确认资本开支与国产化采购是否支持兑现加速",
          keyQuestions: ["市场热度是否支持设备订单兑现"],
          priority: "high",
          capability: "market_heat",
          dependsOn: ["theme_overview"],
          role: "market_analyst",
          expectedArtifact: "market_heat_assessment",
          fallbackCapabilities: ["theme_overview"],
          acceptanceCriteria: [
            "给出热度分数和催化解释。",
            "说明资本开支恢复如何影响兑现时点。",
          ],
        },
        {
          id: "candidate_screening",
          title: "受益标的筛选",
          objective: "筛出兑现链路最清晰的设备龙头",
          keyQuestions: ["哪些设备公司最值得跟踪"],
          priority: "high",
          capability: "candidate_screening",
          dependsOn: ["market_heat"],
          role: "screening_analyst",
          expectedArtifact: "candidate_list",
          fallbackCapabilities: ["credibility_lookup"],
          acceptanceCriteria: [
            "返回 2 到 3 个候选设备龙头。",
            "每个标的都要对应一个兑现逻辑。",
          ],
        },
        {
          id: "credibility_lookup",
          title: "兑现证据校验",
          objective: "验证候选标的是否具备验证、订单与收入证据",
          keyQuestions: ["哪些证据支撑兑现节奏"],
          priority: "high",
          capability: "credibility_lookup",
          dependsOn: ["candidate_screening"],
          role: "validation_analyst",
          expectedArtifact: "credibility_matrix",
          fallbackCapabilities: ["competition_synthesis"],
          acceptanceCriteria: [
            "至少给出一个支持点和一个风险点。",
            "把验证与重复订单区分开。",
          ],
        },
        {
          id: "competition_synthesis",
          title: "竞争格局收敛",
          objective: "比较龙头之间的兑现优先级",
          keyQuestions: ["谁更可能率先兑现"],
          priority: "medium",
          capability: "competition_synthesis",
          dependsOn: ["credibility_lookup"],
          role: "lead_analyst",
          expectedArtifact: "competition_summary",
          fallbackCapabilities: ["credibility_lookup"],
          acceptanceCriteria: ["明确排序逻辑。", "区分平台化能力与先进制程弹性。"],
        },
      ];
    }

    if (schema === compressedFindingsSchema) {
      this.calls.push("compress_findings");
      return {
        summary:
          "未来 12 个月最关键的兑现节点不是单一政策催化，而是晶圆厂验证通过、首轮重复订单落地、以及收入确认与毛利率兑现三段能否连续发生。",
        highlights: [
          "晶圆厂验证通过是最领先的先行指标，决定国产替代能否从故事进入采购清单。",
          "首轮重复订单比单次中标更关键，因为它验证了设备稳定性、交付能力与客户复购意愿。",
          "收入确认与毛利率兑现是最后的财务验证，决定板块从预期交易切换到业绩交易。",
        ],
        openQuestions: [],
        noteIds: [
          "theme_overview_note",
          "market_heat_note",
          "candidate_screening_note",
          "credibility_lookup_note",
          "competition_synthesis_note",
        ],
      };
    }

    if (schema === researchGapAnalysisSchema) {
      this.calls.push("gap_analysis");
      return {
        requiresFollowup: false,
        summary:
          "关键问题已经被回答，后续只需继续跟踪验证通过、重复订单和收入确认三个节点。",
        missingAreas: [],
        followupUnits: [],
        iteration: 0,
      };
    }

    return fallbackValue;
  }
}

const intelligenceService = {
  async generateIndustryOverview(query: string) {
    assert.equal(query, QUESTION);
    return {
      overview:
        "半导体设备国产替代未来 12 个月最关键的兑现，不是抽象政策预期，而是晶圆厂验证通过、首轮重复订单落地、以及收入确认与毛利率兑现这三个节点能否连续发生。",
      news,
    };
  },
  async analyzeMarketHeat(query: string, newsFromOverview?: typeof news) {
    assert.equal(query, QUESTION);
    return {
      heatScore: 81,
      heatConclusion:
        "资本开支回暖叠加国产化采购倾向增强，设备验证与订单转化正在成为板块热度核心。",
      news: newsFromOverview ?? news,
    };
  },
  async screenCandidates(query: string, heatScore: number) {
    assert.equal(query, QUESTION);
    assert.equal(heatScore, 81);
    return candidates;
  },
  async evaluateCredibility(query: string, currentCandidates: typeof candidates) {
    assert.equal(query, QUESTION);
    assert.equal(currentCandidates.length, candidates.length);
    return {
      credibility,
      evidenceList,
    };
  },
  async summarizeCompetition(params: {
    query: string;
    candidates: typeof candidates;
    credibility: typeof credibility;
  }) {
    assert.equal(params.query, QUESTION);
    assert.equal(params.candidates.length, candidates.length);
    assert.equal(params.credibility.length, credibility.length);
    return competitionSummary;
  },
  async analyzeQuickResearchOverall() {
    return confidenceAnalysis;
  },
  buildFinalReport,
};

type MutableRunState = {
  id: string;
  createdAt: Date;
  idempotencyKey: string | null;
  userId: string;
  query: string;
  input: Record<string, unknown>;
  progressPercent: number;
  currentNodeKey: string | null;
  status: (typeof WorkflowRunStatus)[keyof typeof WorkflowRunStatus];
  result: Record<string, unknown> | null;
  template: {
    id: string;
    code: string;
    version: number;
    graphConfig: {
      nodes: string[];
    };
  };
  nodeRuns: Array<{
    id: string;
    nodeKey: string;
    agentName: string;
    attempt: number;
    status: (typeof WorkflowNodeRunStatus)[keyof typeof WorkflowNodeRunStatus];
    output: unknown;
    input?: Record<string, unknown>;
  }>;
};

function createRepositoryHarness(graph: { templateVersion: number }) {
  const template = {
    id: "template_quick_v3",
    code: QUICK_RESEARCH_TEMPLATE_CODE,
    version: graph.templateVersion,
    graphConfig: {
      nodes: [...QUICK_RESEARCH_V3_NODE_KEYS],
    },
  };

  let run: MutableRunState | null = null;
  let sequence = 0;
  let latestEvent: {
    sequence: number;
    eventType: (typeof WorkflowEventType)[keyof typeof WorkflowEventType];
    payload: Record<string, unknown>;
    occurredAt: Date;
  } | null = null;

  const recordEvent = (
    eventType: (typeof WorkflowEventType)[keyof typeof WorkflowEventType],
    payload: Record<string, unknown> = {},
  ) => {
    sequence += 1;
    latestEvent = {
      sequence,
      eventType,
      payload,
      occurredAt: new Date(CREATED_AT.getTime() + sequence * 1000),
    };
  };

  const findNodeRun = (nodeKey: string) =>
    run?.nodeRuns.find((nodeRun) => nodeRun.nodeKey === nodeKey) ?? null;

  const repository = {
    async findPendingOrRunningByIdempotency(
      userId: string,
      idempotencyKey: string,
    ) {
      if (!run) {
        return null;
      }

      const isReusable =
        run.userId === userId &&
        run.idempotencyKey === idempotencyKey &&
        (run.status === WorkflowRunStatus.PENDING ||
          run.status === WorkflowRunStatus.RUNNING);

      return isReusable
        ? {
            id: run.id,
            status: run.status,
            createdAt: run.createdAt,
          }
        : null;
    },
    async getTemplateByCodeAndVersion() {
      return null;
    },
    async ensureQuickResearchTemplate() {
      return template;
    },
    async createRun(params: {
      userId: string;
      query: string;
      input: Record<string, unknown>;
      nodeKeys: string[];
      idempotencyKey?: string;
    }) {
      run = {
        id: "run_1",
        createdAt: CREATED_AT,
        idempotencyKey: params.idempotencyKey ?? null,
        userId: params.userId,
        query: params.query,
        input: params.input,
        progressPercent: 0,
        currentNodeKey: null,
        status: WorkflowRunStatus.PENDING,
        result: null,
        template,
        nodeRuns: params.nodeKeys.map((nodeKey, index) => ({
          id: `node_${index + 1}`,
          nodeKey,
          agentName: nodeKey,
          attempt: 1,
          status: WorkflowNodeRunStatus.PENDING,
          output: null,
        })),
      };

      return {
        id: run.id,
        status: run.status,
        createdAt: run.createdAt,
      };
    },
    async claimNextPendingRun(workerId: string) {
      if (!run || run.status !== WorkflowRunStatus.PENDING) {
        return null;
      }

      run.status = WorkflowRunStatus.RUNNING;
      recordEvent(WorkflowEventType.RUN_STARTED, { workerId });

      return {
        id: run.id,
        progressPercent: run.progressPercent,
        currentNodeKey: run.currentNodeKey,
        template: run.template,
      };
    },
    async listRunningRuns() {
      if (!run || run.status !== WorkflowRunStatus.RUNNING) {
        return [];
      }

      return [
        {
          id: run.id,
          progressPercent: run.progressPercent,
          currentNodeKey: run.currentNodeKey,
          template: run.template,
        },
      ];
    },
    async getRunById(runId: string) {
      if (!run || run.id !== runId) {
        return null;
      }

      return {
        ...run,
        input: { ...run.input },
        template: run.template,
        nodeRuns: run.nodeRuns.map((nodeRun) => ({ ...nodeRun })),
      };
    },
    async isCancellationRequested() {
      return false;
    },
    async markNodeStarted(params: {
      nodeKey: string;
      agentName: string;
      attempt: number;
      input: Record<string, unknown>;
    }) {
      const nodeRun = findNodeRun(params.nodeKey);
      if (!nodeRun) {
        throw new Error(`Missing node run for ${params.nodeKey}`);
      }

      nodeRun.status = WorkflowNodeRunStatus.RUNNING;
      nodeRun.agentName = params.agentName;
      nodeRun.attempt = params.attempt;
      nodeRun.input = params.input;
      recordEvent(WorkflowEventType.NODE_STARTED, {
        nodeKey: params.nodeKey,
      });

      return { id: nodeRun.id };
    },
    async updateRunProgress(params: {
      currentNodeKey?: string;
      progressPercent: number;
    }) {
      if (!run) {
        return;
      }
      run.currentNodeKey = params.currentNodeKey ?? null;
      run.progressPercent = params.progressPercent;
    },
    async addNodeProgressEvent(params: {
      nodeKey: string;
      payload: Record<string, unknown>;
    }) {
      recordEvent(WorkflowEventType.NODE_PROGRESS, {
        nodeKey: params.nodeKey,
        ...(params.payload ?? {}),
      });
    },
    async markNodeSucceeded(params: {
      nodeKey: string;
      output: Record<string, unknown>;
      durationMs: number;
      eventPayload?: Record<string, unknown>;
    }) {
      const nodeRun = findNodeRun(params.nodeKey);
      if (!nodeRun) {
        throw new Error(`Missing node run for ${params.nodeKey}`);
      }

      nodeRun.status = WorkflowNodeRunStatus.SUCCEEDED;
      nodeRun.output = params.output;
      recordEvent(WorkflowEventType.NODE_SUCCEEDED, {
        nodeKey: params.nodeKey,
        durationMs: params.durationMs,
        ...(params.eventPayload ?? {}),
      });
    },
    async markNodeSkipped(params: {
      nodeKey: string;
      output: Record<string, unknown>;
      durationMs: number;
      reason: string;
      eventPayload?: Record<string, unknown>;
    }) {
      const nodeRun = findNodeRun(params.nodeKey);
      if (!nodeRun) {
        throw new Error(`Missing node run for ${params.nodeKey}`);
      }

      nodeRun.status = WorkflowNodeRunStatus.SKIPPED;
      nodeRun.output = params.output;
      recordEvent(WorkflowEventType.NODE_SUCCEEDED, {
        nodeKey: params.nodeKey,
        durationMs: params.durationMs,
        skipped: true,
        reason: params.reason,
        ...(params.eventPayload ?? {}),
      });
    },
    async markNodeFailed(params: {
      nodeKey: string;
      errorCode: string;
      errorMessage: string;
    }) {
      const nodeRun = findNodeRun(params.nodeKey);
      if (nodeRun) {
        nodeRun.status = WorkflowNodeRunStatus.FAILED;
      }

      recordEvent(WorkflowEventType.NODE_FAILED, {
        nodeKey: params.nodeKey,
        errorCode: params.errorCode,
        errorMessage: params.errorMessage,
      });
    },
    async markRunSucceeded(params: { result: Record<string, unknown> }) {
      if (!run) {
        return;
      }
      run.status = WorkflowRunStatus.SUCCEEDED;
      run.progressPercent = 100;
      run.result = params.result;
      recordEvent(WorkflowEventType.RUN_SUCCEEDED, {
        completedAt: CREATED_AT.toISOString(),
      });
    },
    async markRunFailed(params: { errorCode: string; errorMessage: string }) {
      if (!run) {
        return;
      }
      run.status = WorkflowRunStatus.FAILED;
      recordEvent(WorkflowEventType.RUN_FAILED, {
        errorCode: params.errorCode,
        errorMessage: params.errorMessage,
      });
    },
    async markRunCancelled(params: { reason: string }) {
      if (!run) {
        return;
      }
      run.status = WorkflowRunStatus.CANCELLED;
      recordEvent(WorkflowEventType.RUN_CANCELLED, {
        reason: params.reason,
      });
    },
    async markRunPaused(params: {
      currentNodeKey?: string;
      progressPercent: number;
      reason: string;
      eventPayload?: Record<string, unknown>;
    }) {
      if (!run) {
        return;
      }
      run.status = WorkflowRunStatus.PAUSED;
      run.currentNodeKey = params.currentNodeKey ?? null;
      run.progressPercent = params.progressPercent;
      recordEvent(WorkflowEventType.RUN_PAUSED, {
        reason: params.reason,
        nodeKey: params.currentNodeKey,
        ...(params.eventPayload ?? {}),
      });
    },
    async markRunResumed(params: {
      currentNodeKey?: string;
      progressPercent: number;
      reason?: string;
      eventPayload?: Record<string, unknown>;
    }) {
      if (!run) {
        return;
      }
      run.status = WorkflowRunStatus.RUNNING;
      run.currentNodeKey = params.currentNodeKey ?? null;
      run.progressPercent = params.progressPercent;
      recordEvent(WorkflowEventType.RUN_RESUMED, {
        reason: params.reason ?? "user_resumed",
        nodeKey: params.currentNodeKey,
        ...(params.eventPayload ?? {}),
      });
    },
    async getLatestEvent() {
      return latestEvent;
    },
    async findNodeRun(_runId: string, nodeKey: string) {
      return findNodeRun(nodeKey);
    },
    async requestCancellation() {
      return run;
    },
  };

  return {
    repository,
    getRun: () => run,
  };
}

function createRuntimeStoreHarness() {
  let currentCheckpoint: Record<string, unknown> | null = null;
  const publishedEvents: Array<{
    type: string;
    payload: Record<string, unknown>;
  }> = [];

  const runtimeStore = {
    async loadCheckpoint() {
      return currentCheckpoint;
    },
    async saveCheckpoint(_runId: string, state: Record<string, unknown>) {
      currentCheckpoint = state;
    },
    async clearCheckpoint() {
      currentCheckpoint = null;
    },
    async publishEvent(event: { type: string; payload: Record<string, unknown> }) {
      publishedEvents.push(event);
    },
  };

  return {
    runtimeStore,
    publishedEvents,
    getCheckpoint: () => currentCheckpoint,
  };
}

const contractClient = new DeterministicContractClient();
const workflowService = new QuickResearchWorkflowService({
  client: contractClient as never,
  intelligenceService: intelligenceService as never,
});
const graph = new QuickResearchContractLangGraph(workflowService);
const repositoryHarness = createRepositoryHarness(graph);
const runtimeStoreHarness = createRuntimeStoreHarness();

const commandService = new WorkflowCommandService(
  repositoryHarness.repository as never,
  runtimeStoreHarness.runtimeStore as never,
);

const startResult = await commandService.startQuickResearch({
  userId: USER_ID,
  query: QUESTION,
  researchPreferences,
  idempotencyKey: "notebook-semiconductor-equipment-e2e",
});

assert.equal(startResult.status, WorkflowRunStatus.PENDING);
assert.equal(repositoryHarness.getRun()?.query, QUESTION);

const executionService = new WorkflowExecutionService({
  repository: repositoryHarness.repository as never,
  runtimeStore: runtimeStoreHarness.runtimeStore as never,
  graphs: [graph],
});

const picked = await executionService.executeNextPendingRun(WORKER_ID);
assert.equal(picked, true);

const run = repositoryHarness.getRun();
assert.ok(run);
assert.equal(run.status, WorkflowRunStatus.SUCCEEDED);
assert.equal(run.template.code, QUICK_RESEARCH_TEMPLATE_CODE);
assert.equal(run.template.version, 3);
assert.equal(run.result?.researchPlan?.length, 5);
assert.equal(run.result?.researchNotes?.length, 5);
assert.equal(run.result?.gapAnalysis?.requiresFollowup, false);
assert.deepEqual(
  run.nodeRuns.map((nodeRun) => nodeRun.nodeKey),
  [...QUICK_RESEARCH_V3_NODE_KEYS],
);
assert.deepEqual(contractClient.calls, [
  "clarify_scope",
  "task_contract",
  "research_brief",
  "plan_units",
  "compress_findings",
  "gap_analysis",
  "compress_findings",
]);
assert.equal(runtimeStoreHarness.getCheckpoint(), null);

const synthesizedText = [
  run.result?.overview,
  run.result?.competitionSummary,
  run.result?.compressedFindings?.summary,
  ...(run.result?.compressedFindings?.highlights ?? []),
].join("\n");
assert.match(synthesizedText, /验证/);
assert.match(synthesizedText, /重复订单/);
assert.match(synthesizedText, /收入确认/);
assert.equal(run.result?.topPicks?.[0]?.stockCode, "002371");

const publishedEventTypes = runtimeStoreHarness.publishedEvents.map(
  (event) => event.type,
);
assert.ok(publishedEventTypes.includes("RUN_STARTED"));
assert.ok(publishedEventTypes.includes("RUN_SUCCEEDED"));

const output = {
  question: QUESTION,
  templateCode: run.template.code,
  templateVersion: run.template.version,
  startedStatus: startResult.status,
  finalStatus: run.status,
  nodeOrder: run.nodeRuns.map((nodeRun) => nodeRun.nodeKey),
  llmContractCalls: contractClient.calls,
  keyFulfillmentNodes: [
    "晶圆厂验证通过",
    "首轮重复订单落地",
    "收入确认与毛利率兑现",
  ],
  topPicks: run.result?.topPicks,
  report: {
    researchGoal: run.result?.brief?.researchGoal,
    overview: run.result?.overview,
    heatConclusion: run.result?.heatConclusion,
    competitionSummary: run.result?.competitionSummary,
    compressedFindings: run.result?.compressedFindings,
    reflection: run.result?.reflection,
  },
  publishedEventTypes,
  assertions: [
    "startQuickResearch 创建了一个待执行的 v3 行业研究 run",
    "WorkflowExecutionService 完整执行了 7 个 quick research v3 节点",
    "finalReport 回答了验证、重复订单、收入确认三个兑现节点",
    "成功结束后 checkpoint 被清理",
  ],
};

console.log(JSON.stringify(output, null, 2));
