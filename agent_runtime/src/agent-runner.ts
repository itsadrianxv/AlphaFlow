import type {
  AgentExecution,
  AgentExecutionSnapshot,
  AgentStopReason,
  AgentUsage,
} from "./agent-execution";
import type {
  AgentRunKind,
  AgentRuntimeSeedMessage,
  UserInputRequest,
} from "./types";

export type AgentRunSkill = {
  id: string;
  versionId?: string;
  contentHash?: string;
  description: string;
  content: string;
  referencesRoot: string;
};

export type AgentSessionSpec = {
  mode: "memory" | "persistent";
  id: string;
  seed: AgentRuntimeSeedMessage[];
};

export type AgentRunPlan = {
  runKind: AgentRunKind;
  runId: string;
  userId: string;
  prompt: string;
  context?: Record<string, unknown>;
  conversationId?: string;
  assistantMessageId?: string;
  execution: AgentExecution;
  skills: AgentRunSkill[];
  session: AgentSessionSpec;
};

export type RunnerEvent =
  | { type: "message.started" }
  | { type: "message.delta"; delta: string }
  | { type: "message.completed"; text: string }
  | { type: "tool.started"; toolCallId: string; toolName: string; inputSummary?: Record<string, unknown> }
  | { type: "tool.completed" | "tool.failed"; toolCallId: string; toolName: string; inputSummary?: Record<string, unknown>; outputSummary?: Record<string, unknown> }
  | { type: "session.compacted"; payload: Record<string, unknown> };

type ModelUsage = { inputTokens: number; outputTokens: number; cost?: number };

export type AgentExecutionOutcome =
  | { kind: "completed"; text: string; usage: ModelUsage; evidenceGaps: string[] }
  | { kind: "waiting_for_input"; inputRequest: UserInputRequest; usage: ModelUsage; evidenceGaps: string[] }
  | { kind: "stopped"; stopReason: Exclude<AgentStopReason, "completed" | "waiting_for_input">; error: { code: string; message: string }; partialText?: string; usage: ModelUsage; evidenceGaps: string[] };

export type AgentExecutionAdapter = {
  execute(params: { plan: AgentRunPlan; signal: AbortSignal; emit: (event: RunnerEvent) => void }): Promise<AgentExecutionOutcome>;
};

export type AgentRunAudit = {
  boundary: AgentExecutionSnapshot;
  skills: Array<{ id: string; versionId?: string; contentHash?: string }>;
  model: AgentExecutionSnapshot["model"];
  toolSummaries: Array<Record<string, unknown>>;
  structuredOutput?: Record<string, unknown>;
  stopReason?: AgentStopReason;
  usage: AgentUsage;
  cost?: { currency: "USD"; micros: number };
  costWarningExceeded: boolean;
  durationMs: number;
  followUpObjects: Array<Record<string, unknown>>;
};

export type AgentCompletedResult = { kind: "completed"; output: { text: string }; evidenceGaps: string[]; audit: AgentRunAudit & { stopReason: "completed" } };
export type AgentWaitingForInputResult = { kind: "waiting_for_input"; inputRequest: UserInputRequest; resumeToken: string; evidenceGaps: string[]; audit: AgentRunAudit & { stopReason: "waiting_for_input" } };
export type AgentStoppedResult = { kind: "stopped"; stopReason: Exclude<AgentStopReason, "completed" | "waiting_for_input">; error: { code: string; message: string }; partialOutput?: { text: string }; evidenceGaps: string[]; audit: AgentRunAudit };
export type AgentRunResult = AgentCompletedResult | AgentWaitingForInputResult | AgentStoppedResult;

export class AgentRunner {
  constructor(private readonly executionAdapter: AgentExecutionAdapter) {}

  async run(params: { plan: AgentRunPlan; signal: AbortSignal; emit: (event: RunnerEvent) => void }): Promise<AgentRunResult> {
    const startedAt = Date.now();
    const { execution } = params.plan;
    const toolSummaries: Array<Record<string, unknown>> = [];
    let lastAssistantText = "";
    const emit = (event: RunnerEvent) => {
      if (event.type === "message.started") execution.observe({ kind: "step" });
      if (event.type === "tool.completed" || event.type === "tool.failed") {
        toolSummaries.push({
          toolCallId: event.toolCallId,
          toolName: event.toolName,
          inputSummary: event.inputSummary,
          outputSummary: event.outputSummary,
          isError: event.type === "tool.failed",
        });
      }
      if (event.type === "message.completed") lastAssistantText = event.text;
      params.emit(event);
    };

    let outcome: AgentExecutionOutcome;
    try {
      outcome = await this.executionAdapter.execute({ plan: params.plan, signal: params.signal, emit });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!params.signal.aborted && !/未授权|扩权|能力|constraint|网络策略/.test(message)) throw error;
      const stopReason = params.signal.aborted ? "cancelled" : "boundary_violation";
      execution.observe({ kind: "duration", durationMs: Date.now() - startedAt });
      execution.pause();
      return {
        kind: "stopped",
        stopReason,
        error: { code: stopReason.toUpperCase(), message },
        partialOutput: lastAssistantText ? { text: lastAssistantText } : undefined,
        evidenceGaps: [],
        audit: this.audit(params.plan, toolSummaries, stopReason),
      };
    }

    execution.observe({
      kind: "model",
      inputTokens: outcome.usage.inputTokens,
      outputTokens: outcome.usage.outputTokens,
      costUsd: outcome.usage.cost,
    });
    execution.observe({ kind: "duration", durationMs: Date.now() - startedAt });
    execution.pause();

    if (outcome.kind === "waiting_for_input") {
      return {
        kind: "waiting_for_input",
        inputRequest: outcome.inputRequest,
        resumeToken: params.plan.runId,
        evidenceGaps: outcome.evidenceGaps,
        audit: this.audit(params.plan, toolSummaries, "waiting_for_input"),
      };
    }
    if (outcome.kind === "stopped") {
      const partialOutput = outcome.partialText ? { text: outcome.partialText } : undefined;
      return {
        kind: "stopped",
        stopReason: outcome.stopReason,
        error: outcome.error,
        partialOutput,
        evidenceGaps: outcome.evidenceGaps,
        audit: this.audit(params.plan, toolSummaries, outcome.stopReason, partialOutput),
      };
    }
    const output = { text: outcome.text };
    return {
      kind: "completed",
      output,
      evidenceGaps: outcome.evidenceGaps,
      audit: this.audit(params.plan, toolSummaries, "completed", output),
    };
  }

  private audit<T extends AgentStopReason>(
    plan: AgentRunPlan,
    toolSummaries: Array<Record<string, unknown>>,
    stopReason: T,
    structuredOutput?: Record<string, unknown>,
  ): AgentRunAudit & { stopReason: T } {
    const observed = plan.execution.audit();
    return {
      boundary: observed.snapshot,
      skills: plan.skills.map(({ id, versionId, contentHash }) => ({ id, versionId, contentHash })),
      model: observed.snapshot.model,
      toolSummaries,
      structuredOutput,
      stopReason,
      usage: observed.usage,
      cost: observed.cost,
      costWarningExceeded: observed.costWarningExceeded,
      durationMs: observed.usage.durationMs,
      followUpObjects: [],
    };
  }
}
