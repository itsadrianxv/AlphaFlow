import type { Prisma, PrismaClient } from "@prisma/client";
import type { AgentRuntimeEvent } from "~/server/infrastructure/agent-runtime/agent-runtime-client";

const toJson = (value: unknown): Prisma.InputJsonValue =>
  value as Prisma.InputJsonValue;

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function readString(payload: Record<string, unknown>, key: string) {
  const value = payload[key];
  return typeof value === "string" ? value : undefined;
}

function readNumber(payload: Record<string, unknown>, key: string) {
  const value = payload[key];
  return typeof value === "number" && Number.isFinite(value)
    ? Math.round(value)
    : undefined;
}

export class PrismaAgentRuntimeRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async listToolCalls(workflowRunId: string) {
    return this.prisma.agentToolCall.findMany({
      where: { workflowRunId },
      orderBy: { createdAt: "asc" },
    });
  }

  async listArtifacts(workflowRunId: string) {
    return this.prisma.agentArtifact.findMany({
      where: { workflowRunId },
      orderBy: { createdAt: "asc" },
    });
  }

  async recordRuntimeEvent(workflowRunId: string, event: AgentRuntimeEvent) {
    if (
      event.type === "tool.call.started" ||
      event.type === "tool.call.completed" ||
      event.type === "tool.call.failed"
    ) {
      await this.recordToolCallEvent(workflowRunId, event);
      return;
    }

    if (event.type === "artifact.created") {
      await this.recordArtifactEvent(workflowRunId, event);
    }
  }

  private async recordToolCallEvent(
    workflowRunId: string,
    event: AgentRuntimeEvent,
  ) {
    const payload = asRecord(event.payload);
    const externalToolCallId =
      readString(payload, "toolCallId") ?? `${event.sequence}`;
    const toolName = readString(payload, "toolName") ?? "unknown_tool";
    const skillId = readString(payload, "skillId") ?? "unknown_skill";
    const existing = await this.prisma.agentToolCall.findFirst({
      where: {
        workflowRunId,
        externalToolCallId,
      },
    });
    const status =
      event.type === "tool.call.started"
        ? "running"
        : event.type === "tool.call.completed"
          ? "succeeded"
          : "failed";
    const data = {
      skillId,
      toolName,
      inputSummary: payload.inputSummary
        ? toJson(payload.inputSummary)
        : undefined,
      outputSummary: payload.outputSummary
        ? toJson(payload.outputSummary)
        : undefined,
      status,
      durationMs: readNumber(payload, "durationMs"),
      errorCode: readString(payload, "errorCode"),
      errorMessage: readString(payload, "errorMessage"),
    };

    if (existing) {
      await this.prisma.agentToolCall.update({
        where: { id: existing.id },
        data,
      });
      return;
    }

    await this.prisma.agentToolCall.create({
      data: {
        workflowRunId,
        externalToolCallId,
        ...data,
      },
    });
  }

  private async recordArtifactEvent(
    workflowRunId: string,
    event: AgentRuntimeEvent,
  ) {
    const payload = asRecord(event.payload);

    await this.prisma.agentArtifact.create({
      data: {
        workflowRunId,
        kind: readString(payload, "kind") ?? "report",
        title: readString(payload, "title") ?? "Agent artifact",
        contentType: readString(payload, "contentType") ?? "application/json",
        uri: readString(payload, "uri"),
        payload: payload.payload ? toJson(payload.payload) : toJson(payload),
      },
    });
  }
}
