import type {
  AgentRuntimeEvent,
  AgentRuntimeEventType,
  AgentRunSnapshot,
  AgentRunStatus,
  StartRunRequest,
} from "./types";

type Subscriber = (event: AgentRuntimeEvent) => void;

type RunRecord = Omit<AgentRunSnapshot, "events"> & {
  events: AgentRuntimeEvent[];
  subscribers: Set<Subscriber>;
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
        prompt: request.prompt,
        skillIds: request.skillIds,
        context: request.context,
      },
      createdAt: now,
      events: [],
      subscribers: new Set(),
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

  abort(runId: string) {
    const run = this.runs.get(runId);
    if (!run) {
      return false;
    }

    run.abortController?.abort();
    return true;
  }

  markRunning(runId: string) {
    this.updateStatus(runId, "running", { startedAt: true });
    this.appendEvent(runId, "run.started");
  }

  markSucceeded(runId: string, finalOutput: Record<string, unknown>) {
    const run = this.runs.get(runId);
    if (!run) {
      return;
    }

    run.finalOutput = finalOutput;
    this.updateStatus(runId, "succeeded", { completedAt: true });
    this.appendEvent(runId, "run.succeeded", finalOutput);
    this.scheduleCleanup(runId);
  }

  markFailed(runId: string, errorCode: string, errorMessage: string) {
    const run = this.runs.get(runId);
    if (!run) {
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
      errorCode: run.errorCode,
      errorMessage: run.errorMessage,
      createdAt: run.createdAt,
      startedAt: run.startedAt,
      completedAt: run.completedAt,
      events: [...run.events],
    };
  }
}
