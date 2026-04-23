import { performance } from "node:perf_hooks";

process.env.SKIP_ENV_VALIDATION = process.env.SKIP_ENV_VALIDATION ?? "1";
process.env.DATABASE_URL = process.env.DATABASE_URL ?? "https://example.com/db";
process.env.REDIS_URL = process.env.REDIS_URL ?? "redis://127.0.0.1:6379";
process.env.PYTHON_INTELLIGENCE_SERVICE_URL =
  process.env.WORKFLOW_REPRO_BASE_URL ??
  process.env.PYTHON_INTELLIGENCE_SERVICE_URL ??
  "http://127.0.0.1:8000";
process.env.PYTHON_INTELLIGENCE_SERVICE_TIMEOUT_MS =
  process.env.WORKFLOW_REPRO_TIMEOUT_MS ??
  process.env.PYTHON_INTELLIGENCE_SERVICE_TIMEOUT_MS ??
  "300000";
const DISABLE_DEEPSEEK =
  (process.env.WORKFLOW_REPRO_DISABLE_DEEPSEEK ?? "1") !== "0";
if (DISABLE_DEEPSEEK) {
  process.env.DEEPSEEK_API_KEY = "";
}

const QUESTION = "半导体设备国产替代，未来 12 个月最关键的兑现节点是什么";
const USER_ID = "user_1";
const WORKER_ID = "notebook_worker";
const CREATED_AT = new Date("2026-03-19T00:00:00.000Z");
const researchPreferences = {
  researchGoal:
    "判断半导体设备国产替代在未来 12 个月最关键的兑现节点，并确认问题是否会在 intelligence 数据服务上超时。",
  mustAnswerQuestions: [
    QUESTION,
    "workflow 最终是否会抛出 INTELLIGENCE_DATA_UNAVAILABLE",
    "超时发生前 workflow 走到了哪个节点",
  ],
  preferredSources: [
    "company announcement",
    "fab capex guidance",
    "industry media",
  ],
  freshnessWindowDays: 365,
};
const BASE_URL = process.env.PYTHON_INTELLIGENCE_SERVICE_URL;
const TIMEOUT_MS = Number(process.env.PYTHON_INTELLIGENCE_SERVICE_TIMEOUT_MS);
const PRECHECK_TIMEOUT_MS = Number(
  process.env.WORKFLOW_PRECHECK_TIMEOUT_MS ?? "5000",
);

const { WorkflowEventType, WorkflowNodeRunStatus, WorkflowRunStatus } =
  await import("@prisma/client");
const { WorkflowCommandService } = await import(
  "~/modules/research/server/application/workflow/command-service"
);
const { WorkflowExecutionService } = await import(
  "~/modules/research/server/application/workflow/execution-service"
);
const { ConfidenceAnalysisService } = await import(
  "~/modules/research/server/application/intelligence/confidence-analysis-service"
);
const { IntelligenceAgentService } = await import(
  "~/modules/research/server/application/intelligence/intelligence-agent-service"
);
const { QuickResearchWorkflowService } = await import(
  "~/modules/research/server/application/intelligence/quick-research-workflow-service"
);
const { WORKFLOW_ERROR_CODES } = await import("~/modules/research/server/domain/workflow/errors");
const { QUICK_RESEARCH_TEMPLATE_CODE, QUICK_RESEARCH_NODE_KEYS } =
  await import("~/modules/research/server/domain/workflow/types");
const { DeepSeekClient } = await import(
  "~/modules/research/server/infrastructure/intelligence/deepseek-client"
);
const { PythonConfidenceAnalysisClient } = await import(
  "~/modules/research/server/infrastructure/intelligence/python-confidence-analysis-client"
);
const { PythonIntelligenceDataClient } = await import(
  "~/modules/research/server/infrastructure/intelligence/python-intelligence-data-client"
);
const { QuickResearchLangGraph } = await import(
  "~/modules/research/server/workflows/langgraph/quick-research-graph"
);

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
  failure:
    | {
        errorCode: string;
        errorMessage: string;
      }
    | null;
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
    errorCode?: string;
    errorMessage?: string;
  }>;
};

function unwrapErrorChain(error: unknown) {
  const chain: string[] = [];
  let current =
    error instanceof Error
      ? error
      : new Error(typeof error === "string" ? error : JSON.stringify(error));
  const seen = new Set<Error>();

  while (current && !seen.has(current)) {
    seen.add(current);
    chain.push(`${current.name}: ${current.message}`);

    if (current.cause instanceof Error) {
      current = current.cause;
      continue;
    }

    const context = (current as Error & { context?: unknown }).context;
    if (context instanceof Error) {
      current = context;
      continue;
    }

    break;
  }

  return chain;
}

async function probeHttp(path: string) {
  const started = performance.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PRECHECK_TIMEOUT_MS);

  try {
    const response = await fetch(`${BASE_URL}${path}`, {
      signal: controller.signal,
    });
    const text = await response.text();

    return {
      path,
      ok: response.ok,
      status: response.status,
      elapsedMs: Math.round(performance.now() - started),
      preview: text.slice(0, 240),
      error: null,
    };
  } catch (error) {
    return {
      path,
      ok: false,
      status: null,
      elapsedMs: Math.round(performance.now() - started),
      preview: "",
      error: unwrapErrorChain(error).join(" | "),
    };
  } finally {
    clearTimeout(timer);
  }
}

function createRepositoryHarness(graph: { templateVersion: number }) {
  const template = {
    id: "template_quick_v3",
    code: QUICK_RESEARCH_TEMPLATE_CODE,
    version: graph.templateVersion,
    graphConfig: {
      nodes: [...QUICK_RESEARCH_NODE_KEYS],
      researchDefaults: {
        allowClarification: false,
      },
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

      const reusable =
        run.userId === userId &&
        run.idempotencyKey === idempotencyKey &&
        (run.status === WorkflowRunStatus.PENDING ||
          run.status === WorkflowRunStatus.RUNNING);

      return reusable
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
        failure: null,
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
        nodeRun.errorCode = params.errorCode;
        nodeRun.errorMessage = params.errorMessage;
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
      run.failure = null;
      recordEvent(WorkflowEventType.RUN_SUCCEEDED, {
        completedAt: CREATED_AT.toISOString(),
      });
    },
    async markRunFailed(params: { errorCode: string; errorMessage: string }) {
      if (!run) {
        return;
      }

      run.status = WorkflowRunStatus.FAILED;
      run.failure = {
        errorCode: params.errorCode,
        errorMessage: params.errorMessage,
      };
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
    getLatestEvent: () => latestEvent,
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

async function main() {
  const preflight = await Promise.all([
    probeHttp("/health"),
    probeHttp(
      `/api/v1/intelligence/themes/${encodeURIComponent(QUESTION)}/news?days=7&limit=5`,
    ),
  ]);

  const deepSeekClient = new DeepSeekClient();
  const dataClient = new PythonIntelligenceDataClient({
    baseUrl: BASE_URL,
    timeoutMs: TIMEOUT_MS,
  });
  const confidenceAnalysisService = new ConfidenceAnalysisService({
    client: new PythonConfidenceAnalysisClient({
      baseUrl: BASE_URL,
      timeoutMs: TIMEOUT_MS,
    }),
  });
  const intelligenceService = new IntelligenceAgentService({
    deepSeekClient,
    dataClient,
    confidenceAnalysisService,
  });
  const workflowService = new QuickResearchWorkflowService({
    client: deepSeekClient,
    intelligenceService,
  });
const graph = new QuickResearchLangGraph(workflowService);
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
    idempotencyKey: `workflow-repro:${QUESTION}`,
  });

  const executionService = new WorkflowExecutionService({
    repository: repositoryHarness.repository as never,
    runtimeStore: runtimeStoreHarness.runtimeStore as never,
    graphs: [graph],
  });

  const startedAt = performance.now();
  const picked = await executionService.executeNextPendingRun(WORKER_ID);
  const elapsedMs = Math.round(performance.now() - startedAt);

  const run = repositoryHarness.getRun();
  const failedNode =
    run?.nodeRuns.find((nodeRun) => nodeRun.status === WorkflowNodeRunStatus.FAILED) ??
    null;
  const timeoutMessage = `Intelligence 数据服务请求超时 (${TIMEOUT_MS}ms)`;
  const reproducedTimeout =
    run?.failure?.errorCode === WORKFLOW_ERROR_CODES.INTELLIGENCE_DATA_UNAVAILABLE &&
    run.failure.errorMessage.includes(timeoutMessage);

  return {
    config: {
      question: QUESTION,
      baseUrl: BASE_URL,
      timeoutMs: TIMEOUT_MS,
      precheckTimeoutMs: PRECHECK_TIMEOUT_MS,
      deepSeekDisabled: DISABLE_DEEPSEEK,
      deepSeekConfigured: deepSeekClient.isConfigured(),
      templateCode: QUICK_RESEARCH_TEMPLATE_CODE,
      templateVersion: graph.templateVersion,
    },
    preflight,
    workflow: {
      picked,
      elapsedMs,
      startedStatus: startResult.status,
      finalStatus: run?.status ?? null,
      currentNodeKey: run?.currentNodeKey ?? null,
      progressPercent: run?.progressPercent ?? null,
      runFailure: run?.failure ?? null,
      failedNode: failedNode
        ? {
            nodeKey: failedNode.nodeKey,
            status: failedNode.status,
            errorCode: failedNode.errorCode ?? null,
            errorMessage: failedNode.errorMessage ?? null,
          }
        : null,
      nodeRuns:
        run?.nodeRuns.map((nodeRun) => ({
          nodeKey: nodeRun.nodeKey,
          status: nodeRun.status,
          errorCode: nodeRun.errorCode ?? null,
          errorMessage: nodeRun.errorMessage ?? null,
        })) ?? [],
      latestEvent: repositoryHarness.getLatestEvent(),
      publishedEventTypes: runtimeStoreHarness.publishedEvents.map(
        (event) => event.type,
      ),
      checkpointCleared: runtimeStoreHarness.getCheckpoint() === null,
      reproducedTimeout,
      expectedTimeoutMessage: timeoutMessage,
    },
  };
}

try {
  const output = await main();
  console.log(JSON.stringify(output, null, 2));
} catch (error) {
  console.log(
    JSON.stringify(
      {
        fatalError: unwrapErrorChain(error),
      },
      null,
      2,
    ),
  );
  process.exitCode = 1;
}
