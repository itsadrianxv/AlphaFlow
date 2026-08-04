export const WORKFLOW_NODE_TIMEOUT_PAUSE_REASON = "node_timeout";

type WorkflowEventLike = {
  eventType: string;
  payload: unknown;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function getLatestWorkflowPauseReason(
  events: readonly WorkflowEventLike[] | null | undefined,
) {
  if (!events) return undefined;
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];
    if (event?.eventType !== "RUN_PAUSED" || !isRecord(event.payload)) {
      continue;
    }
    return typeof event.payload.reason === "string"
      ? event.payload.reason
      : undefined;
  }
  return undefined;
}

export function isNodeTimeoutPausedRun(run: {
  status: string;
  events?: readonly WorkflowEventLike[] | null;
}) {
  return (
    run.status === "PAUSED" &&
    getLatestWorkflowPauseReason(run.events) ===
      WORKFLOW_NODE_TIMEOUT_PAUSE_REASON
  );
}
