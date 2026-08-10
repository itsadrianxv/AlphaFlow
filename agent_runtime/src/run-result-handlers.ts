import type { AgentCompletedResult, AgentRunResult } from "./agent-runner";
import { asJsonObject } from "./json";
import {
  buildImmediateResearchCandidateSeeds,
  enforceResearchOnlyFinalText,
} from "./research-only-policy";
import type { StartRunRequest } from "./types";
import type { ScheduledTaskEvent } from "./scheduled-task-events";

export type CandidateSeedDeliveryResult = {
  accepted: boolean;
  pendingRecovery: boolean;
};

export type CandidateSeedSink = {
  enqueue(seed: Record<string, unknown>): Promise<CandidateSeedDeliveryResult>;
};

export class ImmediateResearchResultHandler {
  constructor(private readonly candidateSeedSink: CandidateSeedSink) {}

  async handle(request: StartRunRequest, result: AgentCompletedResult) {
    const researchOnly = enforceResearchOnlyFinalText({
      prompt: request.prompt,
      text: result.output.text,
    });
    const finalOutput: Record<string, unknown> = {
      text: researchOnly.text,
      skillId: request.skillId,
      skillIds: request.skillIds ?? [request.skillId],
      userSkillDefinitions: request.userSkillDefinitions?.map((skill) => ({
        id: skill.id,
        versionId: skill.versionId,
        version: skill.version,
        contentHash: skill.contentHash,
      })),
      generatedAt: new Date().toISOString(),
      context: asJsonObject(request.context),
      researchOnly: {
        mode: "research_only",
        blockedExecutableRequest: researchOnly.blocked,
        categories: researchOnly.categories,
        removedLineCount: researchOnly.removedLineCount,
      },
    };
    const followUpObjects =
      request.interactionMode === "research"
        ? buildImmediateResearchCandidateSeeds({
            runId: request.runId,
            prompt: request.prompt,
            toolSummaries: result.audit.toolSummaries,
          })
        : [];
    const deliveries = await Promise.all(
      followUpObjects.map((seed) => this.candidateSeedSink.enqueue(seed)),
    );

    return { finalOutput, followUpObjects, deliveries };
  }
}

export type ScheduledTaskResultWriter = {
  persistScheduledTaskResult(
    executionId: string,
    body: Record<string, unknown>,
  ): Promise<unknown>;
};

export type ScheduledTaskEventSink = {
  publish(
    event: Omit<ScheduledTaskEvent, "eventId" | "occurredAt">,
  ): Promise<unknown>;
};

function parseScheduledOutput(text: string) {
  const candidate = text
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "");
  try {
    const parsed = JSON.parse(candidate) as Record<string, unknown>;
    return {
      title: typeof parsed.title === "string" ? parsed.title : "定时任务",
      summary: typeof parsed.summary === "string" ? parsed.summary : text,
      body: typeof parsed.body === "string" ? parsed.body : text,
      evidence: Array.isArray(parsed.evidence) ? parsed.evidence : [],
      quality:
        parsed.quality && typeof parsed.quality === "object"
          ? parsed.quality
          : { status: "OK", warnings: [] },
    };
  } catch {
    return {
      title: "定时任务",
      summary: text,
      body: text,
      evidence: [],
      quality: {
        status: "DEGRADED",
        warnings: ["Agent 未返回结构化 JSON"],
      },
    };
  }
}

export class ScheduledTaskResultHandler {
  constructor(
    private readonly writer: ScheduledTaskResultWriter,
    private readonly eventSink: ScheduledTaskEventSink,
  ) {}

  async started(request: StartRunRequest) {
    await this.publish(request, "execution.started", "running");
  }

  async handle(request: StartRunRequest, result: AgentRunResult) {
    const scheduledTask = request.scheduledTask;
    if (!scheduledTask) {
      throw new Error("定时任务运行缺少 scheduledTask context");
    }

    if (result.kind === "completed") {
      const parsed = parseScheduledOutput(result.output.text);
      try {
        await this.writer.persistScheduledTaskResult(scheduledTask.executionId, {
          runId: request.runId,
          status: "SUCCEEDED",
          ...parsed,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        await this.writer
          .persistScheduledTaskResult(scheduledTask.executionId, {
            runId: request.runId,
            status: "FAILED",
            error: { message },
          })
          .catch(() => undefined);
        await this.publish(request, "execution.failed", "failed", message);
        return {
          finalOutput: undefined,
          failure: {
            code: "SCHEDULED_TASK_SETTLEMENT_FAILED",
            message,
          },
        };
      }
      await this.publish(request, "execution.succeeded", "succeeded");
      return { finalOutput: { text: result.output.text, ...parsed } };
    }

    const cancelled =
      result.kind === "stopped" && result.stopReason === "cancelled";
    const message =
      result.kind === "waiting_for_input"
        ? "定时任务不能等待用户输入"
        : result.error.message;
    await this.writer
      .persistScheduledTaskResult(scheduledTask.executionId, {
        runId: request.runId,
        status: cancelled ? "CANCELLED" : "FAILED",
        error: { message },
      })
      .catch(() => undefined);
    await this.publish(
      request,
      cancelled ? "execution.cancelled" : "execution.failed",
      cancelled ? "cancelled" : "failed",
      message,
    );
    return { finalOutput: undefined };
  }

  private async publish(
    request: StartRunRequest,
    eventType: ScheduledTaskEvent["eventType"],
    status: string,
    errorMessage?: string,
  ) {
    const scheduledTask = request.scheduledTask;
    if (!scheduledTask) {
      throw new Error("定时任务运行缺少 scheduledTask context");
    }
    await this.eventSink
      .publish({
        eventType,
        executionId: scheduledTask.executionId,
        taskId: scheduledTask.taskId,
        taskVersionId: scheduledTask.taskVersionId,
        runId: request.runId,
        status,
        resultRef: scheduledTask.executionId,
        attempt: "1",
        ...(errorMessage ? { errorMessage } : {}),
      })
      .catch(() => undefined);
  }
}
