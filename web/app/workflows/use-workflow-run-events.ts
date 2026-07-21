"use client";

import { useEffect, useState } from "react";
import type { WorkflowDiagramLiveEvent } from "~/app/workflows/workflow-diagram-runtime";
import { api } from "~/trpc/react";

type WorkflowStreamEvent = {
  runId: string;
  sequence: number;
  type: string;
  nodeKey?: string;
  progressPercent: number;
  timestamp: string;
  payload: Record<string, unknown>;
};

export type WorkflowEventConnectionState =
  | "idle"
  | "connected"
  | "reconnecting";

const refreshEventTypes = new Set([
  "NODE_SUCCEEDED",
  "NODE_FAILED",
  "RUN_PAUSED",
  "RUN_RESUMED",
  "RUN_SUCCEEDED",
  "RUN_FAILED",
  "RUN_CANCELLED",
]);

const terminalEventTypes = new Set([
  "RUN_SUCCEEDED",
  "RUN_FAILED",
  "RUN_CANCELLED",
]);

function parseEvent(value: string): WorkflowStreamEvent | null {
  try {
    const event = JSON.parse(value) as Partial<WorkflowStreamEvent>;
    if (
      typeof event.sequence !== "number" ||
      typeof event.type !== "string" ||
      typeof event.timestamp !== "string"
    ) {
      return null;
    }

    return {
      runId: typeof event.runId === "string" ? event.runId : "",
      sequence: event.sequence,
      type: event.type,
      nodeKey: typeof event.nodeKey === "string" ? event.nodeKey : undefined,
      progressPercent:
        typeof event.progressPercent === "number" ? event.progressPercent : 0,
      timestamp: event.timestamp,
      payload:
        event.payload && typeof event.payload === "object"
          ? (event.payload as Record<string, unknown>)
          : {},
    };
  } catch {
    return null;
  }
}

function toLiveEvent(event: WorkflowStreamEvent): WorkflowDiagramLiveEvent {
  return {
    sequence: event.sequence,
    eventType: event.type,
    nodeKey: event.nodeKey,
    progressPercent: event.progressPercent,
    payload: event.payload,
    occurredAt: event.timestamp,
  };
}

export function useWorkflowRunEvents(params: {
  runId: string;
  enabled: boolean;
}) {
  const utils = api.useUtils();
  const [events, setEvents] = useState<WorkflowDiagramLiveEvent[]>([]);
  const [connectionState, setConnectionState] =
    useState<WorkflowEventConnectionState>("idle");

  useEffect(() => {
    if (!params.enabled) {
      setEvents([]);
      setConnectionState("idle");
      return;
    }

    const eventSource = new EventSource(
      `/api/workflows/runs/${params.runId}/events`,
    );
    let closed = false;

    eventSource.onopen = () => {
      setConnectionState("connected");
    };

    eventSource.onmessage = (message) => {
      const event = parseEvent(message.data);
      if (!event) {
        return;
      }

      setEvents((previous) => {
        if (previous.some((item) => item.sequence === event.sequence)) {
          return previous;
        }

        return [...previous, toLiveEvent(event)].sort(
          (left, right) => left.sequence - right.sequence,
        );
      });

      if (refreshEventTypes.has(event.type)) {
        void utils.workflow.getRun.invalidate({ runId: params.runId });
      }

      if (terminalEventTypes.has(event.type)) {
        closed = true;
        eventSource.close();
        setConnectionState("idle");
      }
    };

    eventSource.onerror = () => {
      if (!closed) {
        setConnectionState("reconnecting");
      }
    };

    return () => {
      closed = true;
      eventSource.close();
    };
  }, [params.enabled, params.runId, utils.workflow.getRun]);

  return { events, connectionState };
}
