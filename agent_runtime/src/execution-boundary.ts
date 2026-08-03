import { summarizeValue } from "./json";
import type { AgentRuntimeConfig, StartRunRequest } from "./types";

export type AgentStopReason =
  | "completed"
  | "waiting_for_input"
  | "cancelled"
  | "budget_exhausted"
  | "boundary_violation"
  | "contract_invalid"
  | "tool_error"
  | "model_error";

export type AgentNetworkPolicy = {
  allowPublicHttp: boolean;
  denyPrivateNetwork: boolean;
  allowCredentials: false;
  allowedSchemes: Array<"http" | "https">;
};

export type AgentBudget = {
  maxSteps: number;
  maxTimeMs: number;
  maxInputTokens: number;
  maxOutputTokens: number;
  maxToolCalls: number;
  maxConcurrentSubtasks: number;
};

export type AgentExecutionBoundary = {
  boundaryVersion: "agent-boundary.v1";
  runId: string;
  parentRunId?: string;
  objective: string;
  inputSnapshot: {
    id: string;
    hash: string;
    summary: Record<string, unknown>;
  };
  idempotencyKey: string;
  skillIds: string[];
  allowedCapabilities: string[];
  networkPolicy: AgentNetworkPolicy;
  budget: AgentBudget;
  model: {
    provider: string;
    id: string;
  };
};

export type AgentBudgetUsage = {
  steps: number;
  inputTokens: number;
  outputTokens: number;
  toolCalls: number;
  subtasksStarted: number;
};

export type AgentRunAudit = {
  boundary: AgentExecutionBoundary;
  toolSummaries: Array<Record<string, unknown>>;
  structuredOutput?: Record<string, unknown>;
  stopReason?: AgentStopReason;
  usage: AgentBudgetUsage;
  followUpObjects: Array<Record<string, unknown>>;
};

const DEFAULT_NETWORK_POLICY: AgentNetworkPolicy = {
  allowPublicHttp: true,
  denyPrivateNetwork: true,
  allowCredentials: false,
  allowedSchemes: ["http", "https"],
};

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  }
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function hashSnapshot(value: unknown) {
  let hash = 0x811c9dc5;
  for (const char of stableStringify(value)) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 0x01000193);
  }
  return `fnv1a32:${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

function positiveInteger(value: unknown, fallback: number, max = Number.MAX_SAFE_INTEGER) {
  return typeof value === "number" && Number.isInteger(value) && value > 0
    ? Math.min(value, max)
    : fallback;
}

function parseBudget(raw: unknown, config: AgentRuntimeConfig): AgentBudget {
  const value =
    raw && typeof raw === "object" && !Array.isArray(raw)
      ? (raw as Record<string, unknown>)
      : {};
  return {
    maxSteps: positiveInteger(value.maxSteps, 24, 200),
    maxTimeMs: positiveInteger(value.maxTimeMs, config.modelTimeoutMs, config.modelTimeoutMs),
    maxInputTokens: positiveInteger(value.maxInputTokens, 32_000, 256_000),
    maxOutputTokens: positiveInteger(value.maxOutputTokens, 8_000, 64_000),
    maxToolCalls: positiveInteger(
      value.maxToolCalls,
      config.maxToolCallsPerRun,
      config.maxToolCallsPerRun,
    ),
    maxConcurrentSubtasks: positiveInteger(value.maxConcurrentSubtasks, 1, 8),
  };
}

function parseNetworkPolicy(raw: unknown): AgentNetworkPolicy {
  const value =
    raw && typeof raw === "object" && !Array.isArray(raw)
      ? (raw as Record<string, unknown>)
      : {};
  const schemes = Array.isArray(value.allowedSchemes)
    ? value.allowedSchemes.flatMap((scheme): Array<"http" | "https"> => {
        if (scheme === "http" || scheme === "http:") return ["http"];
        if (scheme === "https" || scheme === "https:") return ["https"];
        return [];
      })
    : DEFAULT_NETWORK_POLICY.allowedSchemes;

  return {
    allowPublicHttp:
      typeof value.allowPublicHttp === "boolean"
        ? value.allowPublicHttp
        : DEFAULT_NETWORK_POLICY.allowPublicHttp,
    denyPrivateNetwork:
      typeof value.denyPrivateNetwork === "boolean"
        ? value.denyPrivateNetwork
        : typeof value.allowPrivateNetwork === "boolean"
          ? !value.allowPrivateNetwork
          : DEFAULT_NETWORK_POLICY.denyPrivateNetwork,
    allowCredentials: false,
    allowedSchemes: schemes.length > 0 ? schemes : DEFAULT_NETWORK_POLICY.allowedSchemes,
  };
}

function normalizeCapabilities(request: StartRunRequest) {
  const capabilities =
    request.allowedCapabilities && request.allowedCapabilities.length > 0
      ? request.allowedCapabilities
      : request.skillIds ?? [request.skillId];
  return [...new Set(capabilities.map((item) => item.trim()).filter(Boolean))].sort();
}

export function createExecutionBoundary(
  request: StartRunRequest,
  config: AgentRuntimeConfig,
): AgentExecutionBoundary {
  const rawBoundary =
    request.executionBoundary &&
    typeof request.executionBoundary === "object" &&
    !Array.isArray(request.executionBoundary)
      ? request.executionBoundary
      : {};
  const objective =
    typeof rawBoundary.objective === "string" && rawBoundary.objective.trim()
      ? rawBoundary.objective.trim()
      : request.title?.trim() || request.prompt.trim().slice(0, 160);
  const snapshot = {
    prompt: request.prompt,
    context: request.context,
    skillIds: request.skillIds ?? [request.skillId],
  };
  const snapshotId =
    typeof rawBoundary.inputSnapshotId === "string" && rawBoundary.inputSnapshotId.trim()
      ? rawBoundary.inputSnapshotId.trim()
      : request.runId;

  return {
    boundaryVersion: "agent-boundary.v1",
    runId: request.runId,
    parentRunId:
      typeof rawBoundary.parentRunId === "string" && rawBoundary.parentRunId.trim()
        ? rawBoundary.parentRunId.trim()
        : undefined,
    objective,
    inputSnapshot: {
      id: snapshotId,
      hash:
        typeof rawBoundary.inputSnapshotHash === "string" &&
        rawBoundary.inputSnapshotHash.trim()
          ? rawBoundary.inputSnapshotHash.trim()
          : hashSnapshot(snapshot),
      summary: summarizeValue(snapshot, 1200),
    },
    idempotencyKey:
      typeof rawBoundary.idempotencyKey === "string" &&
      rawBoundary.idempotencyKey.trim()
        ? rawBoundary.idempotencyKey.trim()
        : request.runId,
    skillIds: [...new Set(request.skillIds ?? [request.skillId])],
    allowedCapabilities: normalizeCapabilities(request),
    networkPolicy: parseNetworkPolicy(
      rawBoundary.networkPolicy ?? request.networkPolicy,
    ),
    budget: parseBudget(rawBoundary.budget, config),
    model: {
      provider: config.modelProvider,
      id: config.modelId,
    },
  };
}

export class AgentBudgetController {
  private readonly startedAt = Date.now();
  private readonly usage: AgentBudgetUsage = {
    steps: 0,
    inputTokens: 0,
    outputTokens: 0,
    toolCalls: 0,
    subtasksStarted: 0,
  };

  constructor(private readonly boundary: AgentExecutionBoundary) {}

  recordStep() {
    this.assertWithinBudget("步骤预算已耗尽", { steps: 1 });
    this.usage.steps += 1;
  }

  recordToolCall(toolName: string) {
    if (!this.boundary.allowedCapabilities.includes(toolName)) {
      throw new Error(`能力未授权: ${toolName}`);
    }
    this.assertWithinBudget(`工具调用预算已耗尽: ${toolName}`, {
      toolCalls: 1,
    });
    this.usage.toolCalls += 1;
  }

  recordModelUsage(inputTokens = 0, outputTokens = 0) {
    const inputDelta = Math.max(0, inputTokens);
    const outputDelta = Math.max(0, outputTokens);
    this.assertWithinBudget("Token 预算已耗尽", {
      inputTokens: inputDelta,
      outputTokens: outputDelta,
    });
    this.usage.inputTokens += inputDelta;
    this.usage.outputTokens += outputDelta;
  }

  reserveSubtask(childCapabilities: string[]) {
    const unauthorized = childCapabilities.find(
      (capability) => !this.boundary.allowedCapabilities.includes(capability),
    );
    if (unauthorized) {
      throw new Error(`子任务不能扩权: ${unauthorized}`);
    }
    this.assertWithinBudget("子任务并发预算已耗尽", { subtasksStarted: 1 });
    this.usage.subtasksStarted += 1;
    return {
      allowedCapabilities: [...this.boundary.allowedCapabilities],
      budget: this.boundary.budget,
    };
  }

  snapshotUsage(): AgentBudgetUsage {
    return { ...this.usage };
  }

  private assertWithinBudget(
    message: string,
    delta: Partial<AgentBudgetUsage> = {},
  ) {
    const elapsedMs = Date.now() - this.startedAt;
    if (
      this.usage.steps + (delta.steps ?? 0) > this.boundary.budget.maxSteps ||
      this.usage.toolCalls + (delta.toolCalls ?? 0) >
        this.boundary.budget.maxToolCalls ||
      this.usage.inputTokens + (delta.inputTokens ?? 0) >
        this.boundary.budget.maxInputTokens ||
      this.usage.outputTokens + (delta.outputTokens ?? 0) >
        this.boundary.budget.maxOutputTokens ||
      this.usage.subtasksStarted + (delta.subtasksStarted ?? 0) >
        this.boundary.budget.maxConcurrentSubtasks ||
      elapsedMs > this.boundary.budget.maxTimeMs
    ) {
      throw new Error(message);
    }
  }
}
