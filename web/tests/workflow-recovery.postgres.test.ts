import { randomUUID } from "node:crypto";
import { PrismaClient, WorkflowEventType } from "@prisma/client";
import { afterAll, afterEach, describe, expect, it } from "vitest";
import { WorkflowExecutionService } from "~/server/application/workflow/execution-service";
import {
  WORKFLOW_ERROR_CODES,
  WorkflowDomainError,
} from "~/server/domain/workflow/errors";
import { PrismaAgentConversationRepository } from "~/server/infrastructure/agent-runtime/prisma-agent-conversation-repository";
import { PrismaWorkflowRunRepository } from "~/server/infrastructure/workflow/prisma/workflow-run-repository";

const databaseUrl = process.env.RESEARCH_POSTGRES_CONTRACT_URL;
const describePostgres = databaseUrl ? describe : describe.skip;

describePostgres("工作流恢复 PostgreSQL 回归", () => {
  const db = new PrismaClient({
    datasources: {
      db: {
        url:
          databaseUrl ?? "postgresql://unused:unused@127.0.0.1:1/unused",
      },
    },
  });
  const repository = new PrismaWorkflowRunRepository(db);
  const conversationRepository = new PrismaAgentConversationRepository(db);
  const runIds: string[] = [];
  const templateIds: string[] = [];
  const userIds: string[] = [];

  afterEach(async () => {
    await db.workflowRun.deleteMany({ where: { id: { in: runIds.splice(0) } } });
    await db.workflowTemplate.deleteMany({
      where: { id: { in: templateIds.splice(0) } },
    });
    await db.user.deleteMany({ where: { id: { in: userIds.splice(0) } } });
  });

  afterAll(async () => {
    await db.$disconnect();
  });

  async function createRun() {
    const userId = `workflow-user-${randomUUID()}`;
    const template = await db.workflowTemplate.create({
      data: {
        code: `workflow-recovery-${randomUUID()}`,
        version: 1,
        graphConfig: {},
        inputSchema: {},
      },
    });
    await db.user.create({ data: { id: userId } });
    userIds.push(userId);
    templateIds.push(template.id);

    const run = await repository.createRun({
      templateId: template.id,
      userId,
      query: "工作流恢复并发回归",
      input: {},
      nodeKeys: ["test_node"],
    });
    runIds.push(run.id);
    return { ...run, template };
  }

  it("并发事件写入保持序号连续且唯一", async () => {
    const run = await createRun();

    await Promise.all(
      Array.from({ length: 20 }, (_, index) =>
        repository.createEvent({
          runId: run.id,
          eventType: WorkflowEventType.NODE_PROGRESS,
          payload: { index },
        }),
      ),
    );

    const events = await db.workflowEvent.findMany({
      where: { runId: run.id },
      orderBy: { sequence: "asc" },
    });
    expect(events.map((event) => event.sequence)).toEqual(
      Array.from({ length: 21 }, (_, index) => index + 1),
    );
  });

  it("多个恢复槽只会领取同一个过期运行一次", async () => {
    const run = await createRun();
    await repository.claimNextPendingRun("normal-worker");
    await db.workflowRun.update({
      where: { id: run.id },
      data: { updatedAt: new Date("2000-01-01T00:00:00.000Z") },
    });
    const staleBefore = new Date();

    const claims = await Promise.all(
      Array.from({ length: 10 }, (_, index) =>
        repository.claimRecoverableRunningRun({
          workerId: `recovery-worker-${index}`,
          staleBefore,
        }),
      ),
    );

    expect(claims.filter(Boolean)).toHaveLength(1);
  });

  it("不可恢复的等待消息会转为失败并允许创建新轮次", async () => {
    const run = await createRun();
    const turn = await conversationRepository.createTurn({
      userId: run.userId,
      prompt: "第一条消息",
      skillId: "scheduled-task-edit",
      routingMode: "SCHEDULED_TASK_EDIT",
    });
    await db.workflowRun.update({
      where: { id: run.id },
      data: {
        status: "FAILED",
        errorCode: "WORKFLOW_NODE_EXECUTION_FAILED",
      },
    });
    await db.agentConversationMessage.update({
      where: { id: turn.assistantMessage.id },
      data: {
        status: "WAITING_FOR_INPUT",
        workflowRunId: run.id,
      },
    });

    await expect(
      conversationRepository.resumeWaitingForInput({
        userId: run.userId,
        conversationId: turn.conversation.id,
        prompt: "第二条消息",
        skillId: "scheduled-task-edit",
      }),
    ).resolves.toBeNull();
    await expect(
      db.agentConversationMessage.findUniqueOrThrow({
        where: { id: turn.assistantMessage.id },
      }),
    ).resolves.toMatchObject({
      status: "FAILED",
      errorCode: "AGENT_WAITING_RUN_NOT_RESUMABLE",
    });
  });

  it("用户选择恢复原运行后 runtime 失败会终结新 assistant 消息", async () => {
    const run = await createRun();
    const turn = await conversationRepository.createTurn({
      userId: run.userId,
      prompt: "创建定时任务",
      skillId: "scheduled-task-edit",
      routingMode: "SCHEDULED_TASK_EDIT",
    });
    await conversationRepository.bindAssistantRun({
      messageId: turn.assistantMessage.id,
      runId: run.id,
    });
    await repository.claimNextPendingRun("waiting-worker");
    const nodeRun = await repository.markNodeStarted({
      runId: run.id,
      nodeKey: "test_node",
      agentName: "runtime",
      attempt: 1,
      input: {},
    });
    await repository.markNodeWaitingForInput({
      runId: run.id,
      nodeRunId: nodeRun.id,
      nodeKey: "test_node",
      question: "请选择行情来源",
      options: [
        { label: "按现有行情条件临时构造", value: "temp_proxy" },
      ],
    });
    await repository.markRunPaused({
      runId: run.id,
      currentNodeKey: "test_node",
      progressPercent: 50,
      reason: "user_input_required",
      eventPayload: { question: "请选择行情来源" },
    });
    await conversationRepository.markAssistantWaitingByRun(run.id, {
      question: "请选择行情来源",
      options: [
        { label: "按现有行情条件临时构造", value: "temp_proxy" },
      ],
    });

    const resumed = await conversationRepository.resumeWaitingForInput({
      userId: run.userId,
      conversationId: turn.conversation.id,
      prompt:
        "用户选择：按现有行情条件临时构造（value: temp_proxy）",
      skillId: "scheduled-task-edit",
    });
    expect(resumed).not.toBeNull();
    expect(resumed?.run.id).toBe(run.id);
    expect(resumed?.assistantMessage.status).toBe("PENDING");

    const runtimeFailureGraph = {
      templateCode: run.template.code,
      templateVersion: run.template.version,
      getNodeOrder: () => ["test_node"],
      buildInitialState: () => ({
        runId: run.id,
        userId: run.userId,
        query: run.query,
        progressPercent: 50,
        errors: [],
      }),
      getNodeOutput: () => ({}),
      getNodeEventPayload: () => ({}),
      mergeNodeOutput: (state: Record<string, unknown>) => state,
      getRunResult: () => ({}),
      execute: async (params: {
        hooks?: { onNodeStarted?: (nodeKey: string) => Promise<void> | void };
      }) => {
        await params.hooks?.onNodeStarted?.("test_node");
        throw new WorkflowDomainError(
          WORKFLOW_ERROR_CODES.WORKFLOW_NODE_EXECUTION_FAILED,
          "定时任务未进入等待状态，也未生成可确认草稿",
        );
      },
    };
    const service = new WorkflowExecutionService({
      repository,
      runtimeStore: {
        subscribeToCancellation: async () => async () => undefined,
        loadCheckpoint: async () => null,
        saveCheckpoint: async () => undefined,
        publishEvent: async () => undefined,
        clearCheckpoint: async () => undefined,
      } as never,
      graphs: [runtimeFailureGraph as never],
      agentConversationRepository: conversationRepository,
    });

    await expect(service.executeNextPendingRun("failure-worker")).resolves.toBe(
      true,
    );
    await expect(
      db.workflowRun.findUniqueOrThrow({ where: { id: run.id } }),
    ).resolves.toMatchObject({
      status: "FAILED",
      errorCode: WORKFLOW_ERROR_CODES.WORKFLOW_NODE_EXECUTION_FAILED,
    });
    await expect(
      db.agentConversationMessage.findUniqueOrThrow({
        where: { id: resumed?.assistantMessage.id },
      }),
    ).resolves.toMatchObject({
      status: "FAILED",
      errorCode: WORKFLOW_ERROR_CODES.WORKFLOW_NODE_EXECUTION_FAILED,
      errorMessage: "定时任务未进入等待状态，也未生成可确认草稿",
    });
  });
});
