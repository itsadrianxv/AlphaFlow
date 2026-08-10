import path from "node:path";
import { AgentRunner, type AgentRunPlan, type AgentRunResult, type RunnerEvent } from "./agent-runner";
import type { RuntimeAgentExecutionFactory } from "./agent-capability-registry";
import type { AgentExecution } from "./agent-execution";
import type { AgentRuntimeRunStore } from "./run-store";
import {
  type ImmediateResearchResultHandler,
  type ScheduledTaskResultHandler,
} from "./run-result-handlers";
import type { SkillRegistry } from "./skill-registry";
import type { AgentRuntimeConfig, StartRunRequest } from "./types";

function resolveSkillIds(request: StartRunRequest) {
  return request.skillIds && request.skillIds.length > 0
    ? request.skillIds
    : [request.skillId];
}

export class AgentRuntimeService {
  private readonly executions = new Map<string, Promise<void>>();

  constructor(
    private readonly dependencies: {
      config: AgentRuntimeConfig;
      skillRegistry: SkillRegistry;
      store: AgentRuntimeRunStore;
      runner: AgentRunner;
      agentExecutionFactory: RuntimeAgentExecutionFactory;
      immediateResultHandler: ImmediateResearchResultHandler;
      scheduledResultHandler: ScheduledTaskResultHandler;
      recoverCandidateSeeds?: () => Promise<void>;
    },
  ) {}

  start(request: StartRunRequest) {
    const existing = this.executions.get(request.runId);
    if (existing) {
      return existing;
    }

    this.dependencies.store.createOrGet(request);
    const turnGeneration =
      this.dependencies.store.getTurnGeneration(request.runId) ?? 0;
    const execution = this.runTurn(request, turnGeneration).finally(() => {
      this.executions.delete(request.runId);
    });
    this.executions.set(request.runId, execution);
    return execution;
  }

  async resume(runId: string) {
    const request = this.dependencies.store.getRequest(runId);
    if (!request) {
      return;
    }
    const existing = this.executions.get(runId);
    if (existing) {
      await existing.catch(() => undefined);
    }
    const resumedRequest = this.dependencies.store.getRequest(runId);
    if (
      resumedRequest &&
      this.dependencies.store.snapshot(runId)?.status === "running"
    ) {
      await this.start(resumedRequest);
    }
  }

  private async runTurn(request: StartRunRequest, turnGeneration: number) {
    const { skillRegistry, store, runner } = this.dependencies;
    await this.dependencies.recoverCandidateSeeds?.().catch((error) => {
      console.error(
        `[agent-runtime] candidate seed recovery skipped: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    });

    const skillIds = resolveSkillIds(request);
    const skills = skillIds
      .map((skillId) =>
        skillRegistry.getWithUserDefinitions(
          skillId,
          request.userSkillDefinitions,
        ),
      )
      .filter((skill): skill is NonNullable<typeof skill> => Boolean(skill));
    const missingSkillId = skillIds.find(
      (skillId) => !skills.some((skill) => skill.name === skillId),
    );
    if (missingSkillId || !skills[0]) {
      store.markFailed(
        request.runId,
        "SKILL_NOT_FOUND",
        missingSkillId ? `Skill 不存在: ${missingSkillId}` : "缺少主 skill",
      );
      return;
    }

    let execution: AgentExecution;
    try {
      execution = this.dependencies.agentExecutionFactory.create(
        request,
        skillIds,
        store.snapshot(request.runId)?.input.executionSnapshot,
      );
    } catch (error) {
      store.markFailed(
        request.runId,
        "EXECUTION_POLICY_INVALID",
        error instanceof Error ? error.message : "Agent 执行策略非法",
      );
      return;
    }
    const plan: AgentRunPlan = {
      runKind: request.runKind,
      runId: request.runId,
      userId: request.userId,
      prompt: request.prompt,
      context: request.context,
      conversationId: request.conversationId,
      assistantMessageId: request.assistantMessageId,
      execution,
      skills: skills.map((skill) => ({
        id: skill.name,
        versionId: request.userSkillDefinitions?.find(
          (definition) => definition.id === skill.name,
        )?.versionId,
        contentHash: request.userSkillDefinitions?.find(
          (definition) => definition.id === skill.name,
        )?.contentHash,
        description: skill.description,
        content: skill.content,
        referencesRoot: path.dirname(skill.filePath),
      })),
      session: {
        mode: request.sessionId ? "persistent" : "memory",
        id: request.sessionId ?? request.runId,
        seed: request.sessionSeed ?? [],
      },
    };

    const abortController = new AbortController();
    store.attachAbortController(request.runId, abortController);
    if (store.snapshot(request.runId)?.status === "cancelled") {
      return;
    }
    store.markRunning(request.runId);
    store.setExecutionSnapshot(request.runId, execution.snapshot);
    store.appendEvent(request.runId, "run.boundary.frozen", {
      boundary: execution.snapshot,
    });

    try {
      if (request.runKind === "scheduled_task") {
        await this.dependencies.scheduledResultHandler.started(request);
      }
      const result = await runner.run({
        plan,
        signal: abortController.signal,
        emit: (event) => this.recordRunnerEvent(request, event),
      });
      store.setExecutionSnapshot(request.runId, result.audit.boundary);

      if (
        !store.isCurrentTurn(request.runId, turnGeneration) ||
        abortController.signal.aborted ||
        store.snapshot(request.runId)?.status === "cancelled"
      ) {
        store.markCancelled(request.runId, "cancel_requested");
        return;
      }
      await this.settle(request, result);
    } catch (error) {
      const message = error instanceof Error ? error.message : "未知错误";
      store.markFailed(request.runId, "AGENT_RUNTIME_FAILED", message);
    }
  }

  private async settle(request: StartRunRequest, result: AgentRunResult) {
    const { store } = this.dependencies;
    if (result.kind === "waiting_for_input") {
      if (request.runKind === "scheduled_task") {
        await this.dependencies.scheduledResultHandler.handle(request, result);
        store.recordAudit(request.runId, result.audit as unknown as Record<string, unknown>);
        store.markFailed(
          request.runId,
          "SCHEDULED_TASK_WAITING_FOR_INPUT",
          "定时任务不能等待用户输入",
        );
        return;
      }
      store.recordAudit(request.runId, result.audit as unknown as Record<string, unknown>);
      store.markWaitingForInput(request.runId, result.inputRequest);
      return;
    }

    if (result.kind === "stopped") {
      if (request.runKind === "scheduled_task") {
        await this.dependencies.scheduledResultHandler.handle(request, result);
      }
      store.recordAudit(request.runId, result.audit as unknown as Record<string, unknown>);
      if (result.stopReason === "cancelled") {
        store.markCancelled(request.runId, "cancel_requested");
      } else {
        store.markFailed(request.runId, result.error.code, result.error.message);
      }
      return;
    }

    let finalOutput: Record<string, unknown>;
    let followUpObjects: Array<Record<string, unknown>> = [];
    if (request.runKind === "scheduled_task") {
      const settled = await this.dependencies.scheduledResultHandler.handle(
        request,
        result,
      );
      if (settled.failure) {
        store.recordAudit(
          request.runId,
          result.audit as unknown as Record<string, unknown>,
        );
        store.markFailed(
          request.runId,
          settled.failure.code,
          settled.failure.message,
        );
        return;
      }
      finalOutput = settled.finalOutput ?? result.output;
    } else {
      const settled = await this.dependencies.immediateResultHandler.handle(
        request,
        result,
      );
      finalOutput = settled.finalOutput;
      followUpObjects = settled.followUpObjects;
      if (followUpObjects.length > 0) {
        store.appendEvent(request.runId, "candidate_seed.queued", {
          mode: "post_response_async",
          idempotent: true,
          count: followUpObjects.length,
          seedKeys: followUpObjects.map((seed) => seed.seedKey),
          accepted: settled.deliveries.filter((item) => item.accepted).length,
          pendingRecovery: settled.deliveries.filter(
            (item) => item.pendingRecovery,
          ).length,
        });
      }
    }

    store.appendEvent(request.runId, "artifact.created", {
      kind: "report",
      title: request.title ?? "投研助手报告",
      contentType: "text/markdown",
      payload: finalOutput,
    });
    store.recordAudit(request.runId, {
      ...result.audit,
      structuredOutput: finalOutput,
      followUpObjects,
    } as unknown as Record<string, unknown>);
    store.markSucceeded(request.runId, finalOutput);
  }

  private recordRunnerEvent(request: StartRunRequest, event: RunnerEvent) {
    const { store } = this.dependencies;
    const messageIdentity = {
      conversationId: request.conversationId,
      assistantMessageId: request.assistantMessageId,
    };
    switch (event.type) {
      case "message.started":
        store.appendEvent(request.runId, "agent.message.start", messageIdentity);
        return;
      case "message.delta":
        store.appendEvent(
          request.runId,
          "agent.message.delta",
          { ...messageIdentity, delta: event.delta },
          event.delta,
        );
        return;
      case "message.completed":
        store.appendEvent(
          request.runId,
          "agent.message",
          { ...messageIdentity, text: event.text },
          event.text,
        );
        return;
      case "tool.started":
        store.appendEvent(request.runId, "tool.call.started", {
          toolCallId: event.toolCallId,
          toolName: event.toolName,
          skillId: request.skillId,
          skillIds: resolveSkillIds(request),
          inputSummary: event.inputSummary,
        });
        return;
      case "tool.completed":
      case "tool.failed":
        store.appendEvent(
          request.runId,
          event.type === "tool.failed"
            ? "tool.call.failed"
            : "tool.call.completed",
          {
            toolCallId: event.toolCallId,
            toolName: event.toolName,
            skillId: request.skillId,
            skillIds: resolveSkillIds(request),
            inputSummary: event.inputSummary,
            outputSummary: event.outputSummary,
            isError: event.type === "tool.failed",
          },
        );
        return;
      case "session.compacted":
        store.appendEvent(request.runId, "session.compacted", event.payload);
    }
  }
}
