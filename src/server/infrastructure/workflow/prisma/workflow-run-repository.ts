import {
  type Prisma,
  type PrismaClient,
  WorkflowEventType,
  WorkflowNodeRunStatus,
  WorkflowRunStatus,
} from "~/generated/prisma";
import {
  COMPANY_RESEARCH_NODE_KEYS,
  COMPANY_RESEARCH_TEMPLATE_CODE,
  QUICK_RESEARCH_NODE_KEYS,
  QUICK_RESEARCH_TEMPLATE_CODE,
  SCREENING_INSIGHT_PIPELINE_NODE_KEYS,
  SCREENING_INSIGHT_PIPELINE_TEMPLATE_CODE,
  SCREENING_TO_TIMING_NODE_KEYS,
  SCREENING_TO_TIMING_TEMPLATE_CODE,
  TIMING_REVIEW_LOOP_NODE_KEYS,
  TIMING_REVIEW_LOOP_TEMPLATE_CODE,
  TIMING_SIGNAL_PIPELINE_NODE_KEYS,
  TIMING_SIGNAL_PIPELINE_TEMPLATE_CODE,
  WATCHLIST_TIMING_CARDS_PIPELINE_NODE_KEYS,
  WATCHLIST_TIMING_CARDS_PIPELINE_TEMPLATE_CODE,
  WATCHLIST_TIMING_PIPELINE_NODE_KEYS,
  WATCHLIST_TIMING_PIPELINE_TEMPLATE_CODE,
} from "~/server/domain/workflow/types";

const toJson = (value: unknown): Prisma.InputJsonValue =>
  value as Prisma.InputJsonValue;

function buildCheckpointKey(runId: string) {
  return `workflow:checkpoint:${runId}`;
}

export type WorkflowRunDetailRecord = Awaited<
  ReturnType<PrismaWorkflowRunRepository["getRunDetailForUser"]>
>;

export class PrismaWorkflowRunRepository {
  constructor(private readonly prisma: PrismaClient) {}

  getPrismaClient() {
    return this.prisma;
  }

  async getTemplateByCodeAndVersion(code: string, version?: number) {
    if (version !== undefined) {
      return this.prisma.workflowTemplate.findUnique({
        where: {
          code_version: {
            code,
            version,
          },
        },
      });
    }

    return this.prisma.workflowTemplate.findFirst({
      where: {
        code,
        isActive: true,
      },
      orderBy: {
        version: "desc",
      },
    });
  }

  async ensureQuickResearchTemplate() {
    return this.prisma.workflowTemplate.upsert({
      where: {
        code_version: {
          code: QUICK_RESEARCH_TEMPLATE_CODE,
          version: 1,
        },
      },
      create: {
        code: QUICK_RESEARCH_TEMPLATE_CODE,
        version: 1,
        graphConfig: {
          nodes: QUICK_RESEARCH_NODE_KEYS,
        },
        inputSchema: {
          type: "object",
          required: ["query"],
          properties: {
            query: {
              type: "string",
            },
          },
        },
        isActive: true,
      },
      update: {
        graphConfig: {
          nodes: QUICK_RESEARCH_NODE_KEYS,
        },
        isActive: true,
      },
    });
  }

  async ensureCompanyResearchTemplate() {
    return this.prisma.workflowTemplate.upsert({
      where: {
        code_version: {
          code: COMPANY_RESEARCH_TEMPLATE_CODE,
          version: 1,
        },
      },
      create: {
        code: COMPANY_RESEARCH_TEMPLATE_CODE,
        version: 1,
        graphConfig: {
          nodes: COMPANY_RESEARCH_NODE_KEYS,
        },
        inputSchema: {
          type: "object",
          required: ["companyName"],
          properties: {
            companyName: {
              type: "string",
            },
            stockCode: {
              type: "string",
            },
            officialWebsite: {
              type: "string",
            },
            focusConcepts: {
              type: "array",
              items: {
                type: "string",
              },
            },
            keyQuestion: {
              type: "string",
            },
            supplementalUrls: {
              type: "array",
              items: {
                type: "string",
              },
            },
          },
        },
        isActive: true,
      },
      update: {
        graphConfig: {
          nodes: COMPANY_RESEARCH_NODE_KEYS,
        },
        isActive: true,
      },
    });
  }

  async ensureScreeningInsightPipelineTemplate() {
    return this.prisma.workflowTemplate.upsert({
      where: {
        code_version: {
          code: SCREENING_INSIGHT_PIPELINE_TEMPLATE_CODE,
          version: 1,
        },
      },
      create: {
        code: SCREENING_INSIGHT_PIPELINE_TEMPLATE_CODE,
        version: 1,
        graphConfig: {
          nodes: SCREENING_INSIGHT_PIPELINE_NODE_KEYS,
        },
        inputSchema: {
          type: "object",
          required: ["screeningSessionId"],
          properties: {
            screeningSessionId: {
              type: "string",
            },
            maxInsightsPerSession: {
              type: "integer",
            },
          },
        },
        isActive: true,
      },
      update: {
        graphConfig: {
          nodes: SCREENING_INSIGHT_PIPELINE_NODE_KEYS,
        },
        isActive: true,
      },
    });
  }

  async ensureTimingSignalPipelineTemplate() {
    return this.prisma.workflowTemplate.upsert({
      where: {
        code_version: {
          code: TIMING_SIGNAL_PIPELINE_TEMPLATE_CODE,
          version: 1,
        },
      },
      create: {
        code: TIMING_SIGNAL_PIPELINE_TEMPLATE_CODE,
        version: 1,
        graphConfig: {
          nodes: TIMING_SIGNAL_PIPELINE_NODE_KEYS,
        },
        inputSchema: {
          type: "object",
          required: ["stockCode"],
          properties: {
            stockCode: {
              type: "string",
            },
            asOfDate: {
              type: "string",
            },
            presetId: {
              type: "string",
            },
          },
        },
        isActive: true,
      },
      update: {
        graphConfig: {
          nodes: TIMING_SIGNAL_PIPELINE_NODE_KEYS,
        },
        isActive: true,
      },
    });
  }

  async ensureWatchlistTimingCardsPipelineTemplate() {
    return this.prisma.workflowTemplate.upsert({
      where: {
        code_version: {
          code: WATCHLIST_TIMING_CARDS_PIPELINE_TEMPLATE_CODE,
          version: 1,
        },
      },
      create: {
        code: WATCHLIST_TIMING_CARDS_PIPELINE_TEMPLATE_CODE,
        version: 1,
        graphConfig: {
          nodes: WATCHLIST_TIMING_CARDS_PIPELINE_NODE_KEYS,
        },
        inputSchema: {
          type: "object",
          required: ["watchListId"],
          properties: {
            watchListId: {
              type: "string",
            },
            asOfDate: {
              type: "string",
            },
            presetId: {
              type: "string",
            },
          },
        },
        isActive: true,
      },
      update: {
        graphConfig: {
          nodes: WATCHLIST_TIMING_CARDS_PIPELINE_NODE_KEYS,
        },
        isActive: true,
      },
    });
  }

  async ensureWatchlistTimingPipelineTemplate() {
    return this.prisma.workflowTemplate.upsert({
      where: {
        code_version: {
          code: WATCHLIST_TIMING_PIPELINE_TEMPLATE_CODE,
          version: 1,
        },
      },
      create: {
        code: WATCHLIST_TIMING_PIPELINE_TEMPLATE_CODE,
        version: 1,
        graphConfig: {
          nodes: WATCHLIST_TIMING_PIPELINE_NODE_KEYS,
        },
        inputSchema: {
          type: "object",
          required: ["watchListId", "portfolioSnapshotId"],
          properties: {
            watchListId: {
              type: "string",
            },
            portfolioSnapshotId: {
              type: "string",
            },
            asOfDate: {
              type: "string",
            },
            presetId: {
              type: "string",
            },
          },
        },
        isActive: true,
      },
      update: {
        graphConfig: {
          nodes: WATCHLIST_TIMING_PIPELINE_NODE_KEYS,
        },
        isActive: true,
      },
    });
  }

  async ensureScreeningToTimingPipelineTemplate() {
    return this.prisma.workflowTemplate.upsert({
      where: {
        code_version: {
          code: SCREENING_TO_TIMING_TEMPLATE_CODE,
          version: 1,
        },
      },
      create: {
        code: SCREENING_TO_TIMING_TEMPLATE_CODE,
        version: 1,
        graphConfig: {
          nodes: SCREENING_TO_TIMING_NODE_KEYS,
        },
        inputSchema: {
          type: "object",
          required: ["screeningSessionId"],
          properties: {
            screeningSessionId: {
              type: "string",
            },
            candidateLimit: {
              type: "integer",
            },
            asOfDate: {
              type: "string",
            },
            presetId: {
              type: "string",
            },
          },
        },
        isActive: true,
      },
      update: {
        graphConfig: {
          nodes: SCREENING_TO_TIMING_NODE_KEYS,
        },
        isActive: true,
      },
    });
  }

  async ensureTimingReviewLoopTemplate() {
    return this.prisma.workflowTemplate.upsert({
      where: {
        code_version: {
          code: TIMING_REVIEW_LOOP_TEMPLATE_CODE,
          version: 1,
        },
      },
      create: {
        code: TIMING_REVIEW_LOOP_TEMPLATE_CODE,
        version: 1,
        graphConfig: {
          nodes: TIMING_REVIEW_LOOP_NODE_KEYS,
        },
        inputSchema: {
          type: "object",
          properties: {
            date: {
              type: "string",
            },
            limit: {
              type: "integer",
            },
          },
        },
        isActive: true,
      },
      update: {
        graphConfig: {
          nodes: TIMING_REVIEW_LOOP_NODE_KEYS,
        },
        isActive: true,
      },
    });
  }

  async findPendingOrRunningByIdempotency(
    userId: string,
    idempotencyKey: string,
  ) {
    return this.prisma.workflowRun.findFirst({
      where: {
        userId,
        idempotencyKey,
        status: {
          in: [WorkflowRunStatus.PENDING, WorkflowRunStatus.RUNNING],
        },
      },
      orderBy: {
        createdAt: "desc",
      },
    });
  }

  async createRun(params: {
    templateId: string;
    userId: string;
    query: string;
    input: Record<string, unknown>;
    nodeKeys: string[];
    idempotencyKey?: string;
  }) {
    return this.prisma.$transaction(async (tx) => {
      const run = await tx.workflowRun.create({
        data: {
          templateId: params.templateId,
          userId: params.userId,
          query: params.query,
          input: toJson(params.input),
          status: WorkflowRunStatus.PENDING,
          progressPercent: 0,
          checkpointKey: "",
          idempotencyKey: params.idempotencyKey,
        },
      });

      await tx.workflowRun.update({
        where: {
          id: run.id,
        },
        data: {
          checkpointKey: buildCheckpointKey(run.id),
        },
      });

      await tx.workflowNodeRun.createMany({
        data: params.nodeKeys.map((nodeKey) => ({
          runId: run.id,
          nodeKey,
          agentName: nodeKey,
          attempt: 1,
          status: WorkflowNodeRunStatus.PENDING,
        })),
      });

      await tx.workflowEvent.create({
        data: {
          runId: run.id,
          sequence: 1,
          eventType: WorkflowEventType.RUN_CREATED,
          payload: toJson({
            query: params.query,
          }),
          occurredAt: new Date(),
        },
      });

      return run;
    });
  }

  async getRunDetailForUser(runId: string, userId: string) {
    return this.prisma.workflowRun.findFirst({
      where: {
        id: runId,
        userId,
      },
      include: {
        template: true,
        nodeRuns: {
          orderBy: [{ createdAt: "asc" }, { nodeKey: "asc" }],
        },
        events: {
          orderBy: {
            sequence: "asc",
          },
          take: 100,
        },
      },
    });
  }

  async getRunById(runId: string) {
    return this.prisma.workflowRun.findUnique({
      where: {
        id: runId,
      },
      include: {
        template: true,
        nodeRuns: {
          orderBy: [{ createdAt: "asc" }, { nodeKey: "asc" }],
        },
      },
    });
  }

  async listRunningRuns(limit = 20) {
    return this.prisma.workflowRun.findMany({
      where: {
        status: WorkflowRunStatus.RUNNING,
      },
      include: {
        template: true,
      },
      orderBy: {
        startedAt: "asc",
      },
      take: limit,
    });
  }

  async listRunsForUser(params: {
    userId: string;
    limit: number;
    cursor?: string;
    status?: WorkflowRunStatus;
    templateCode?: string;
  }) {
    const records = await this.prisma.workflowRun.findMany({
      where: {
        userId: params.userId,
        status: params.status,
        template: params.templateCode
          ? {
              is: {
                code: params.templateCode,
              },
            }
          : undefined,
      },
      include: {
        template: true,
        nodeRuns: {
          orderBy: {
            createdAt: "asc",
          },
        },
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: params.limit + 1,
      ...(params.cursor
        ? {
            cursor: {
              id: params.cursor,
            },
            skip: 1,
          }
        : {}),
    });

    const hasMore = records.length > params.limit;
    const items = hasMore ? records.slice(0, params.limit) : records;
    const nextCursor = hasMore ? (items[items.length - 1]?.id ?? null) : null;

    return {
      items,
      nextCursor,
    };
  }

  async requestCancellation(runId: string, userId: string) {
    return this.prisma.$transaction(async (tx) => {
      const run = await tx.workflowRun.findFirst({
        where: {
          id: runId,
          userId,
        },
      });

      if (!run) {
        return null;
      }

      if (run.status === WorkflowRunStatus.PENDING) {
        const now = new Date();
        const updated = await tx.workflowRun.update({
          where: {
            id: runId,
          },
          data: {
            status: WorkflowRunStatus.CANCELLED,
            cancellationRequestedAt: now,
            completedAt: now,
            updatedAt: now,
          },
        });

        await this.createEventTx(tx, {
          runId,
          eventType: WorkflowEventType.RUN_CANCEL_REQUESTED,
          payload: { reason: "user_requested" },
        });

        await this.createEventTx(tx, {
          runId,
          eventType: WorkflowEventType.RUN_CANCELLED,
          payload: { reason: "pending_cancelled" },
        });

        return updated;
      }

      if (run.status === WorkflowRunStatus.RUNNING) {
        const updated = await tx.workflowRun.update({
          where: {
            id: runId,
          },
          data: {
            cancellationRequestedAt: new Date(),
          },
        });

        await this.createEventTx(tx, {
          runId,
          eventType: WorkflowEventType.RUN_CANCEL_REQUESTED,
          payload: { reason: "user_requested" },
        });

        return updated;
      }

      return run;
    });
  }

  async claimNextPendingRun(workerId: string) {
    return this.prisma.$transaction(async (tx) => {
      const candidate = await tx.workflowRun.findFirst({
        where: {
          status: WorkflowRunStatus.PENDING,
        },
        orderBy: {
          createdAt: "asc",
        },
      });

      if (!candidate) {
        return null;
      }

      const now = new Date();
      const claimResult = await tx.workflowRun.updateMany({
        where: {
          id: candidate.id,
          status: WorkflowRunStatus.PENDING,
        },
        data: {
          status: WorkflowRunStatus.RUNNING,
          startedAt: candidate.startedAt ?? now,
          updatedAt: now,
        },
      });

      if (claimResult.count === 0) {
        return null;
      }

      await this.createEventTx(tx, {
        runId: candidate.id,
        eventType: WorkflowEventType.RUN_STARTED,
        payload: { workerId },
      });

      return tx.workflowRun.findUnique({
        where: {
          id: candidate.id,
        },
        include: {
          template: true,
        },
      });
    });
  }

  async updateRunProgress(params: {
    runId: string;
    currentNodeKey?: string;
    progressPercent: number;
  }) {
    return this.prisma.workflowRun.update({
      where: {
        id: params.runId,
      },
      data: {
        currentNodeKey: params.currentNodeKey,
        progressPercent: params.progressPercent,
      },
    });
  }

  async findNodeRun(runId: string, nodeKey: string, attempt: number) {
    return this.prisma.workflowNodeRun.findUnique({
      where: {
        runId_nodeKey_attempt: {
          runId,
          nodeKey,
          attempt,
        },
      },
    });
  }

  async markNodeStarted(params: {
    runId: string;
    nodeKey: string;
    agentName: string;
    attempt: number;
    input: Record<string, unknown>;
  }) {
    return this.prisma.$transaction(async (tx) => {
      const nodeRun = await tx.workflowNodeRun.upsert({
        where: {
          runId_nodeKey_attempt: {
            runId: params.runId,
            nodeKey: params.nodeKey,
            attempt: params.attempt,
          },
        },
        create: {
          runId: params.runId,
          nodeKey: params.nodeKey,
          agentName: params.agentName,
          attempt: params.attempt,
          status: WorkflowNodeRunStatus.RUNNING,
          input: toJson(params.input),
          startedAt: new Date(),
        },
        update: {
          status: WorkflowNodeRunStatus.RUNNING,
          input: toJson(params.input),
          startedAt: new Date(),
          errorCode: null,
          errorMessage: null,
        },
      });

      await this.createEventTx(tx, {
        runId: params.runId,
        nodeRunId: nodeRun.id,
        eventType: WorkflowEventType.NODE_STARTED,
        payload: {
          nodeKey: params.nodeKey,
        },
      });

      return nodeRun;
    });
  }

  async addNodeProgressEvent(params: {
    runId: string;
    nodeRunId?: string;
    nodeKey: string;
    payload: Record<string, unknown>;
  }) {
    return this.createEvent({
      runId: params.runId,
      nodeRunId: params.nodeRunId,
      eventType: WorkflowEventType.NODE_PROGRESS,
      payload: {
        nodeKey: params.nodeKey,
        ...params.payload,
      },
    });
  }

  async markNodeSucceeded(params: {
    runId: string;
    nodeRunId: string;
    nodeKey: string;
    output: Record<string, unknown>;
    durationMs: number;
    eventPayload?: Record<string, unknown>;
  }) {
    return this.prisma.$transaction(async (tx) => {
      const nodeRun = await tx.workflowNodeRun.update({
        where: {
          id: params.nodeRunId,
        },
        data: {
          status: WorkflowNodeRunStatus.SUCCEEDED,
          output: toJson(params.output),
          durationMs: params.durationMs,
          completedAt: new Date(),
        },
      });

      await this.createEventTx(tx, {
        runId: params.runId,
        nodeRunId: params.nodeRunId,
        eventType: WorkflowEventType.NODE_SUCCEEDED,
        payload: {
          nodeKey: params.nodeKey,
          durationMs: params.durationMs,
          ...params.eventPayload,
        },
      });

      return nodeRun;
    });
  }

  async markNodeSkipped(params: {
    runId: string;
    nodeRunId: string;
    nodeKey: string;
    output: Record<string, unknown>;
    durationMs: number;
    reason: string;
    eventPayload?: Record<string, unknown>;
  }) {
    return this.prisma.$transaction(async (tx) => {
      const nodeRun = await tx.workflowNodeRun.update({
        where: {
          id: params.nodeRunId,
        },
        data: {
          status: WorkflowNodeRunStatus.SKIPPED,
          output: toJson(params.output),
          durationMs: params.durationMs,
          completedAt: new Date(),
          errorCode: null,
          errorMessage: null,
        },
      });

      await this.createEventTx(tx, {
        runId: params.runId,
        nodeRunId: params.nodeRunId,
        eventType: WorkflowEventType.NODE_SUCCEEDED,
        payload: {
          nodeKey: params.nodeKey,
          durationMs: params.durationMs,
          skipped: true,
          reason: params.reason,
          ...params.eventPayload,
        },
      });

      return nodeRun;
    });
  }

  async markNodeFailed(params: {
    runId: string;
    nodeRunId: string;
    nodeKey: string;
    errorCode: string;
    errorMessage: string;
    durationMs: number;
  }) {
    return this.prisma.$transaction(async (tx) => {
      const nodeRun = await tx.workflowNodeRun.update({
        where: {
          id: params.nodeRunId,
        },
        data: {
          status: WorkflowNodeRunStatus.FAILED,
          errorCode: params.errorCode,
          errorMessage: params.errorMessage,
          durationMs: params.durationMs,
          completedAt: new Date(),
        },
      });

      await this.createEventTx(tx, {
        runId: params.runId,
        nodeRunId: params.nodeRunId,
        eventType: WorkflowEventType.NODE_FAILED,
        payload: {
          nodeKey: params.nodeKey,
          errorCode: params.errorCode,
          errorMessage: params.errorMessage,
        },
      });

      return nodeRun;
    });
  }

  async markRunSucceeded(params: {
    runId: string;
    result: Record<string, unknown>;
  }) {
    return this.prisma.$transaction(async (tx) => {
      const now = new Date();
      const run = await tx.workflowRun.update({
        where: {
          id: params.runId,
        },
        data: {
          status: WorkflowRunStatus.SUCCEEDED,
          progressPercent: 100,
          completedAt: now,
          result: toJson(params.result),
          errorCode: null,
          errorMessage: null,
        },
      });

      await this.createEventTx(tx, {
        runId: params.runId,
        eventType: WorkflowEventType.RUN_SUCCEEDED,
        payload: {
          completedAt: now.toISOString(),
        },
      });

      return run;
    });
  }

  async markRunFailed(params: {
    runId: string;
    errorCode: string;
    errorMessage: string;
  }) {
    return this.prisma.$transaction(async (tx) => {
      const now = new Date();
      const run = await tx.workflowRun.update({
        where: {
          id: params.runId,
        },
        data: {
          status: WorkflowRunStatus.FAILED,
          completedAt: now,
          errorCode: params.errorCode,
          errorMessage: params.errorMessage,
        },
      });

      await this.createEventTx(tx, {
        runId: params.runId,
        eventType: WorkflowEventType.RUN_FAILED,
        payload: {
          errorCode: params.errorCode,
          errorMessage: params.errorMessage,
        },
      });

      return run;
    });
  }

  async markRunCancelled(params: { runId: string; reason: string }) {
    return this.prisma.$transaction(async (tx) => {
      const now = new Date();
      const run = await tx.workflowRun.update({
        where: {
          id: params.runId,
        },
        data: {
          status: WorkflowRunStatus.CANCELLED,
          completedAt: now,
        },
      });

      await this.createEventTx(tx, {
        runId: params.runId,
        eventType: WorkflowEventType.RUN_CANCELLED,
        payload: {
          reason: params.reason,
        },
      });

      return run;
    });
  }

  async isCancellationRequested(runId: string) {
    const run = await this.prisma.workflowRun.findUnique({
      where: {
        id: runId,
      },
      select: {
        cancellationRequestedAt: true,
        status: true,
      },
    });

    if (!run) {
      return false;
    }

    return (
      Boolean(run.cancellationRequestedAt) ||
      run.status === WorkflowRunStatus.CANCELLED
    );
  }

  async loadLatestEventSequence(runId: string) {
    const last = await this.prisma.workflowEvent.findFirst({
      where: {
        runId,
      },
      select: {
        sequence: true,
      },
      orderBy: {
        sequence: "desc",
      },
    });

    return last?.sequence ?? 0;
  }

  async createEvent(params: {
    runId: string;
    eventType: WorkflowEventType;
    payload: Record<string, unknown>;
    nodeRunId?: string;
  }) {
    return this.prisma.$transaction(async (tx) =>
      this.createEventTx(tx, {
        runId: params.runId,
        nodeRunId: params.nodeRunId,
        eventType: params.eventType,
        payload: params.payload,
      }),
    );
  }

  private async createEventTx(
    tx: Prisma.TransactionClient,
    params: {
      runId: string;
      eventType: WorkflowEventType;
      payload: Record<string, unknown>;
      nodeRunId?: string;
    },
  ) {
    const currentSequence = await tx.workflowEvent.findFirst({
      where: {
        runId: params.runId,
      },
      select: {
        sequence: true,
      },
      orderBy: {
        sequence: "desc",
      },
    });

    const nextSequence = (currentSequence?.sequence ?? 0) + 1;

    return tx.workflowEvent.create({
      data: {
        runId: params.runId,
        nodeRunId: params.nodeRunId,
        sequence: nextSequence,
        eventType: params.eventType,
        payload: toJson(params.payload),
        occurredAt: new Date(),
      },
    });
  }

  async getLatestEvent(runId: string) {
    return this.prisma.workflowEvent.findFirst({
      where: {
        runId,
      },
      orderBy: {
        sequence: "desc",
      },
    });
  }
}
