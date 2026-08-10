import type {
  AgentHarness,
  AgentHarnessEvent,
  AgentMessage,
  Skill,
} from "@earendil-works/pi-agent-core";
import type { RunnerEvent } from "./agent-runner";
import { summarizeValue } from "./json";
import type { UserInputRequest } from "./types";

export type PiHarnessEventState = {
  lastAssistantText: string;
  lastToolError?: string;
  waitingForInput?: UserInputRequest;
  scheduledDraftBuilt: boolean;
  scheduleValidationStatus?: string;
  toolSummaries: Array<Record<string, unknown>>;
  seenToolCallIds?: Set<string>;
  seenToolResultIds?: Set<string>;
};

export function extractPiMessageText(message: AgentMessage | unknown) {
  if (!message || typeof message !== "object") {
    return "";
  }

  const content = (message as { content?: unknown }).content;
  if (!Array.isArray(content)) {
    return "";
  }

  return content
    .map((block) => {
      if (
        block &&
        typeof block === "object" &&
        (block as { type?: unknown }).type === "text"
      ) {
        return String((block as { text?: unknown }).text ?? "");
      }
      return "";
    })
    .filter(Boolean)
    .join("\n");
}

export function mapPiHarnessEvent(
  event: AgentHarnessEvent<Skill>,
  state: PiHarnessEventState,
  emit: (event: RunnerEvent) => void,
) {
  if (event.type === "message_start" && event.message.role === "assistant") {
    state.lastAssistantText = "";
    emit({ type: "message.started" });
    return undefined;
  }

  if (event.type === "message_update" && event.message.role === "assistant") {
    const text = extractPiMessageText(event.message);
    if (text.length > state.lastAssistantText.length) {
      const delta = text.slice(state.lastAssistantText.length);
      state.lastAssistantText = text;
      emit({ type: "message.delta", delta });
    }
    return undefined;
  }

  if (event.type === "message_end") {
    if (event.message.role !== "assistant") {
      return undefined;
    }
    const text = extractPiMessageText(event.message).trim();
    if (text) {
      state.lastAssistantText = text;
      emit({ type: "message.completed", text });
    }
    return undefined;
  }

  if (event.type === "tool_call") {
    const seen = state.seenToolCallIds ?? (state.seenToolCallIds = new Set());
    if (seen.has(event.toolCallId)) {
      return undefined;
    }
    seen.add(event.toolCallId);
    emit({
      type: "tool.started",
      toolCallId: event.toolCallId,
      toolName: event.toolName,
      inputSummary: summarizeValue(event.input, 1000),
    });
    return undefined;
  }

  if (event.type !== "tool_result") {
    return undefined;
  }

  const inputSummary = summarizeValue(event.input, 1000);
  const outputSummary = summarizeValue(
    { content: event.content, details: event.details },
    1400,
  );
  const seen = state.seenToolResultIds ?? (state.seenToolResultIds = new Set());
  if (!seen.has(event.toolCallId)) {
    seen.add(event.toolCallId);
    state.toolSummaries.push({
      toolCallId: event.toolCallId,
      toolName: event.toolName,
      inputSummary,
      outputSummary,
      isError: event.isError,
    });
    if (event.isError) {
      state.lastToolError = outputSummary.preview;
    }

    emit({
      type: event.isError ? "tool.failed" : "tool.completed",
      toolCallId: event.toolCallId,
      toolName: event.toolName,
      inputSummary,
      outputSummary,
    });
  }

  if (
    !event.isError &&
    (event.toolName === "build_scheduled_task_draft" ||
      event.toolName === "build_scheduled_task_edit_draft")
  ) {
    state.scheduledDraftBuilt = true;
  }

  if (
    !event.isError &&
    event.toolName === "validate_schedule" &&
    event.details &&
    typeof event.details === "object"
  ) {
    const feasibility = (event.details as { feasibility?: unknown }).feasibility;
    if (feasibility && typeof feasibility === "object") {
      const status = (feasibility as { status?: unknown }).status;
      if (typeof status === "string") {
        state.scheduleValidationStatus = status;
      }
    }
  }

  if (
    event.toolName !== "ask_user" ||
    event.isError ||
    !event.details ||
    typeof event.details !== "object"
  ) {
    return undefined;
  }

  const details = event.details as { question?: unknown; options?: unknown };
  if (typeof details.question !== "string" || !details.question.trim()) {
    return undefined;
  }
  const options = Array.isArray(details.options)
    ? details.options
        .filter(
          (option): option is { label: string; value: string } =>
            Boolean(
              option &&
                typeof option === "object" &&
                typeof (option as { label?: unknown }).label === "string" &&
                typeof (option as { value?: unknown }).value === "string",
            ),
        )
        .map((option) => ({ label: option.label, value: option.value }))
    : undefined;
  const inputRequest: UserInputRequest = {
    question: details.question.trim(),
    ...(options && options.length > 0 ? { options } : {}),
  };
  state.waitingForInput = inputRequest;
  return inputRequest;
}

export function registerPiHarnessEventHandlers(params: {
  harness: AgentHarness;
  emit: (event: RunnerEvent) => void;
  state: PiHarnessEventState;
}) {
  const { harness, emit, state } = params;
  harness.subscribe((event) => {
    mapPiHarnessEvent(event, state, emit);
  });
  harness.on("tool_call", (event) => {
    mapPiHarnessEvent(event, state, emit);
    return undefined;
  });
  harness.on("tool_result", (event) => {
    const waitingRequest = mapPiHarnessEvent(event, state, emit);
    if (!waitingRequest && !state.waitingForInput) {
      return undefined;
    }
    void harness.abort().catch(() => undefined);
    return { terminate: true };
  });
}

export function isScheduledTaskFlowComplete(state: PiHarnessEventState) {
  return (
    state.scheduledDraftBuilt || state.scheduleValidationStatus === "UNSUPPORTED"
  );
}

export function resolveScheduledTaskFlowFailure(state: PiHarnessEventState) {
  if (state.lastToolError) {
    return {
      errorCode: "SCHEDULED_TASK_TOOL_FAILED",
      errorMessage: `定时任务工具执行失败：${state.lastToolError}`,
    };
  }

  return {
    errorCode: "SCHEDULED_TASK_FLOW_INCOMPLETE",
    errorMessage: "定时任务未进入等待状态，也未生成可确认草稿",
  };
}
