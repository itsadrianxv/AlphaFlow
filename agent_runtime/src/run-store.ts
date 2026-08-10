import type {
  AgentRuntimeEvent,
  AgentRuntimeEventType,
  AgentRunSnapshot,
  AgentRunStatus,
  AgentRuntimeResumeRequest,
  StartRunRequest,
  UserInputRequest,
} from "./types";
import type { AgentExecutionSnapshot } from "./agent-execution";

type Subscriber = (event: AgentRuntimeEvent) => void;

type RunRecord = Omit<AgentRunSnapshot, "events"> & {
  events: AgentRuntimeEvent[];
  subscribers: Set<Subscriber>;
  request: StartRunRequest;
  turnGeneration: number;
  abortController?: AbortController;
  cleanupTimer?: NodeJS.Timeout;
};

export class AgentRuntimeRunStore {
  private readonly runs = new Map<string, RunRecord>();

  constructor(private readonly runTtlMs: number) {}

  createOrGet(request: StartRunRequest) {
    const existing = this.runs.get(request.runId);
    if (existing) {
      return existing;
    }

    const now = new Date().toISOString();
    const run: RunRecord = {
      id: request.runId,
      status: "queued",
      skillId: request.skillId,
      skillIds: request.skillIds,
      title: request.title?.trim() || request.prompt.trim().slice(0, 80),
      input: {
        runKind: request.runKind,
        interactionMode: request.interactionMode,
        prompt: request.prompt,
        skillIds: request.skillIds,
        userSkillDefinitions: request.userSkillDefinitions,
        context: request.context,
      },
      createdAt: now,
      events: [],
      subscribers: new Set(),
      request: { ...request },
      turnGeneration: 0,
    };

    this.runs.set(run.id, run);
    this.appendEvent(run.id, "run.created", {
      skillId: request.skillId,
      skillIds: request.skillIds,
      title: run.title,
    });
    return run;
  }

  get(runId: string) {
    return this.runs.get(runId);
  }

  snapshot(runId: string): AgentRunSnapshot | null {
    const run = this.runs.get(runId);
    if (!run) {
      return null;
    }

    return this.toSnapshot(run);
  }

  list() {
    return [...this.runs.values()].map((run) => this.toSnapshot(run));
  }

  attachAbortController(runId: string, abortController: AbortController) {
    const run = this.runs.get(runId);
    if (run) {
      run.abortController = abortController;
    }
  }

  getRequest(runId: string) {
    const run = this.runs.get(runId);
    return run ? { ...run.request } : null;
  }

  getTurnGeneration(runId: string) {
    return this.runs.get(runId)?.turnGeneration ?? null;
  }

  setExecutionSnapshot(runId: string, snapshot: AgentExecutionSnapshot) {
    const run = this.runs.get(runId);
    if (run) {
      run.input.executionSnapshot = structuredClone(snapshot);
    }
  }

  isCurrentTurn(runId: string, generation: number) {
    return this.runs.get(runId)?.turnGeneration === generation;
  }

  abort(runId: string) {
    const run = this.runs.get(runId);
    if (!run) {
      return false;
    }

    run.abortController?.abort(new Error("用户已请求取消"));
    if (
      run.status === "queued" ||
      run.status === "running" ||
      run.status === "waiting_for_input"
    ) {
      this.markCancelled(runId, "cancel_requested");
    }
    return true;
  }

  markRunning(runId: string) {
    const run = this.runs.get(runId);
    if (!run || run.status !== "queued") {
      return;
    }
    this.updateStatus(runId, "running", { startedAt: true });
    this.appendEvent(runId, "run.started");
  }

  markWaitingForInput(runId: string, request: UserInputRequest) {
    const run = this.runs.get(runId);
    if (!run || (run.status !== "running" && run.status !== "waiting_for_input")) {
      return false;
    }

    if (run.status === "waiting_for_input") {
      return true;
    }

    run.waitingForInput = {
      question: request.question,
      ...(request.options ? { options: request.options.map((option) => ({ ...option })) } : {}),
    };
    run.completedAt = undefined;
    run.status = "waiting_for_input";
    this.appendEvent(runId, "user.input.requested", run.waitingForInput);
    this.appendEvent(runId, "run.waiting_for_input", run.waitingForInput);
    return true;
  }

  resume(runId: string, patch: AgentRuntimeResumeRequest) {
    const run = this.runs.get(runId);
    if (!run) {
      return { kind: "not_found" as const };
    }

    if (run.status === "running") {
      return { kind: "already_running" as const, request: { ...run.request } };
    }

    if (run.status !== "waiting_for_input") {
      return { kind: "invalid_status" as const, status: run.status };
    }

    run.request = {
      ...run.request,
      prompt: patch.prompt,
      userMessageId: patch.userMessageId,
      assistantMessageId: patch.assistantMessageId,
    };
    run.turnGeneration += 1;
    run.input = {
      ...run.input,
      prompt: patch.prompt,
    };
    run.waitingForInput = undefined;
    run.status = "running";
    this.appendEvent(runId, "run.resumed", {
      userMessageId: patch.userMessageId,
      assistantMessageId: patch.assistantMessageId,
    });
    return { kind: "resumed" as const, request: { ...run.request } };
  }

  markSucceeded(runId: string, finalOutput: Record<string, unknown>) {
    const run = this.runs.get(runId);
    if (!run) {
      return;
    }

    if (
      run.status === "cancelled" ||
      run.status === "waiting_for_input" ||
      run.status === "succeeded" ||
      run.status === "failed"
    ) {
      return;
    }

    run.finalOutput = finalOutput;
    this.updateStatus(runId, "succeeded", { completedAt: true });
    this.appendEvent(runId, "run.succeeded", finalOutput);
    this.scheduleCleanup(runId);
  }

  recordAudit(runId: string, audit: Record<string, unknown>) {
    const run = this.runs.get(runId);
    if (!run) {
      return;
    }

    run.audit = audit;
    this.appendEvent(runId, "run.audit.recorded", {
      boundary: audit.boundary,
      skills: audit.skills,
      model: audit.model,
      stopReason: audit.stopReason,
      usage: audit.usage,
      cost: audit.cost,
      durationMs: audit.durationMs,
      toolSummaryCount: Array.isArray(audit.toolSummaries)
        ? audit.toolSummaries.length
        : 0,
    });
  }

  markFailed(runId: string, errorCode: string, errorMessage: string) {
    const run = this.runs.get(runId);
    if (!run) {
      return;
    }

    if (
      run.status === "cancelled" ||
      run.status === "waiting_for_input" ||
      run.status === "succeeded" ||
      run.status === "failed"
    ) {
      return;
    }

    run.errorCode = errorCode;
    run.errorMessage = errorMessage;
    this.updateStatus(runId, "failed", { completedAt: true });
    this.appendEvent(runId, "run.failed", { errorCode, errorMessage });
    this.scheduleCleanup(runId);
  }

  markCancelled(runId: string, reason: string) {
    const run = this.runs.get(runId);
    if (!run) {
      return;
    }

    if (run.status === "cancelled" || run.status === "succeeded" || run.status === "failed") {
      return;
    }

    this.updateStatus(runId, "cancelled", { completedAt: true });
    this.appendEvent(runId, "run.cancelled", { reason });
    this.scheduleCleanup(runId);
  }

  appendEvent(
    runId: string,
    type: AgentRuntimeEventType,
    payload?: Record<string, unknown>,
    message?: string,
  ) {
    const run = this.runs.get(runId);
    if (!run) {
      return null;
    }

    const event: AgentRuntimeEvent = {
      runId,
      sequence: run.events.length + 1,
      type,
      timestamp: new Date().toISOString(),
      message,
      payload,
    };

    run.events.push(event);
    for (const subscriber of run.subscribers) {
      subscriber(event);
    }

    return event;
  }

  subscribe(
    runId: string,
    afterSequence: number,
    subscriber: Subscriber,
  ): (() => void) | null {
    const run = this.runs.get(runId);
    if (!run) {
      return null;
    }

    for (const event of run.events) {
      if (event.sequence > afterSequence) {
        subscriber(event);
      }
    }

    run.subscribers.add(subscriber);

    return () => {
      run.subscribers.delete(subscriber);
    };
  }

  private updateStatus(
    runId: string,
    status: AgentRunStatus,
    timestamps?: { startedAt?: boolean; completedAt?: boolean },
  ) {
    const run = this.runs.get(runId);
    if (!run) {
      return;
    }

    const now = new Date().toISOString();
    run.status = status;

    if (timestamps?.startedAt && !run.startedAt) {
      run.startedAt = now;
    }

    if (timestamps?.completedAt && !run.completedAt) {
      run.completedAt = now;
    }
  }

  private scheduleCleanup(runId: string) {
    const run = this.runs.get(runId);
    if (!run || run.cleanupTimer) {
      return;
    }

    run.cleanupTimer = setTimeout(() => {
      this.runs.delete(runId);
    }, this.runTtlMs);
  }

  private toSnapshot(run: RunRecord): AgentRunSnapshot {
    return {
      id: run.id,
      status: run.status,
      skillId: run.skillId,
      skillIds: run.skillIds,
      title: run.title,
      input: run.input,
      finalOutput: run.finalOutput,
      audit: run.audit,
      errorCode: run.errorCode,
      errorMessage: run.errorMessage,
      createdAt: run.createdAt,
      startedAt: run.startedAt,
      completedAt: run.completedAt,
      waitingForInput: run.waitingForInput,
      events: [...run.events],
    };
  }
}
