import {
  RunCancelledError,
  WORKFLOW_ERROR_CODES,
  WorkflowDomainError,
  WorkflowPauseError,
} from "~/server/domain/workflow/errors";
import type {
  PiAgentRunGraphState,
  PiAgentRunInput,
  PiAgentRunNodeKey,
  WorkflowGraphState,
  WorkflowNodeKey,
} from "~/server/domain/workflow/types";
import {
  PI_AGENT_RUN_NODE_KEYS,
  PI_AGENT_RUN_TEMPLATE_CODE,
} from "~/server/domain/workflow/types";
import type { AgentRuntimeClient } from "~/server/infrastructure/agent-runtime/agent-runtime-client";
import type { PrismaAgentConversationRepository } from "~/server/infrastructure/agent-runtime/prisma-agent-conversation-repository";
import type { PrismaAgentRuntimeRepository } from "~/server/infrastructure/agent-runtime/prisma-agent-runtime-repository";
import type {
  WorkflowGraphBuildInitialStateParams,
  WorkflowGraphExecutionHooks,
  WorkflowGraphRunner,
} from "~/server/infrastructure/workflow/langgraph/workflow-graph";

function isTerminalRuntimeEvent(type: string) {
  return (
    type === "run.succeeded" ||
    type === "run.failed" ||
    type === "run.cancelled"
  );
}

function parseUserInputRequest(payload: Record<string, unknown> | undefined) {
  if (
    !payload ||
    typeof payload.question !== "string" ||
    !payload.question.trim()
  ) {
    return undefined;
  }

  const options = Array.isArray(payload.options)
    ? payload.options.filter(
        (option): option is { label: string; value: string } =>
          Boolean(
            option &&
              typeof option === "object" &&
              typeof (option as { label?: unknown }).label === "string" &&
              typeof (option as { value?: unknown }).value === "string",
          ),
      )
    : undefined;

  return {
    question: payload.question.trim(),
    ...(options && options.length > 0 ? { options } : {}),
  };
}

function progressForNode(nodeKey: PiAgentRunNodeKey) {
  const index = PI_AGENT_RUN_NODE_KEYS.indexOf(nodeKey);
  return Math.round(((index + 1) / PI_AGENT_RUN_NODE_KEYS.length) * 100);
}

function throwIfAborted(signal?: AbortSignal) {
  if (!signal?.aborted) {
    return;
  }

  const reason = signal.reason;
  if (reason instanceof Error) {
    throw reason;
  }

  throw new Error("工作流执行已中止");
}

export class PiAgentRuntimeLangGraph implements WorkflowGraphRunner {
  readonly templateCode = PI_AGENT_RUN_TEMPLATE_CODE;
  readonly templateVersion = 1;

  constructor(
    private readonly deps: {
      agentRuntimeClient: AgentRuntimeClient;
      agentRuntimeRepository: PrismaAgentRuntimeRepository;
      agentConversationRepository?: PrismaAgentConversationRepository;
    },
  ) {}

  getNodeOrder(): string[] {
    return [...PI_AGENT_RUN_NODE_KEYS];
  }

  buildInitialState(
    params: WorkflowGraphBuildInitialStateParams,
  ): PiAgentRunGraphState {
    return {
      runId: params.runId,
      userId: params.userId,
      query: params.query,
      progressPercent: params.progressPercent,
      currentNodeKey: undefined,
      lastCompletedNodeKey: undefined,
      errors: [],
      agentInput: params.input as PiAgentRunInput,
      preparedTask: undefined,
      runtimeEvents: [],
      finalOutput: undefined,
      artifactIds: [],
      toolCallCount: 0,
    };
  }

  async execute(params: {
    initialState: WorkflowGraphState;
    startNodeIndex?: number;
    hooks?: WorkflowGraphExecutionHooks;
    signal?: AbortSignal;
  }): Promise<WorkflowGraphState> {
    let state = params.initialState as PiAgentRunGraphState;
    const startNodeIndex = params.startNodeIndex ?? 0;

    for (
      let index = startNodeIndex;
      index < PI_AGENT_RUN_NODE_KEYS.length;
      index += 1
    ) {
      throwIfAborted(params.signal);
      const nodeKey = PI_AGENT_RUN_NODE_KEYS[index];
      if (!nodeKey) {
        continue;
      }

      state = {
        ...state,
        currentNodeKey: nodeKey,
      };
      await params.hooks?.onNodeStarted?.(nodeKey);

      if (nodeKey === "prepare_agent_task") {
        state = await this.prepareAgentTask(state, params.hooks);
      } else if (nodeKey === "execute_agent_runtime") {
        state = await this.executeAgentRuntime(
          state,
          params.hooks,
          params.signal,
        );
      } else {
        state = await this.persistAgentResult(state, params.hooks);
      }

      state = {
        ...state,
        currentNodeKey: nodeKey,
        lastCompletedNodeKey: nodeKey,
        progressPercent: progressForNode(nodeKey),
      };
      await params.hooks?.onNodeSucceeded?.(nodeKey, state);
    }

    return state;
  }

  getNodeOutput(nodeKey: WorkflowNodeKey, state: WorkflowGraphState) {
    const agentState = state as PiAgentRunGraphState;

    if (nodeKey === "prepare_agent_task") {
      return {
        preparedTask: agentState.preparedTask,
      };
    }

    if (nodeKey === "execute_agent_runtime") {
      return {
        runtimeEvents: agentState.runtimeEvents,
        finalOutput: agentState.finalOutput,
        toolCallCount: agentState.toolCallCount,
      };
    }

    return {
      artifactIds: agentState.artifactIds,
    };
  }

  getNodeEventPayload(nodeKey: WorkflowNodeKey, state: WorkflowGraphState) {
    const agentState = state as PiAgentRunGraphState;

    if (nodeKey === "execute_agent_runtime") {
      return {
        eventCount: agentState.runtimeEvents.length,
        toolCallCount: agentState.toolCallCount,
      };
    }

    if (nodeKey === "persist_agent_result") {
      return {
        artifactCount: agentState.artifactIds.length,
      };
    }

    return {};
  }

  mergeNodeOutput(
    state: WorkflowGraphState,
    nodeKey: WorkflowNodeKey,
    output: Record<string, unknown>,
  ) {
    return {
      ...state,
      ...output,
      currentNodeKey: nodeKey,
      lastCompletedNodeKey: nodeKey,
    };
  }

  getRunResult(state: WorkflowGraphState): Record<string, unknown> {
    const agentState = state as PiAgentRunGraphState;

    return {
      finalOutput: agentState.finalOutput,
      artifactIds: agentState.artifactIds,
      toolCallCount: agentState.toolCallCount,
      eventCount: agentState.runtimeEvents.length,
    };
  }

  private async prepareAgentTask(
    state: PiAgentRunGraphState,
    hooks?: WorkflowGraphExecutionHooks,
  ) {
    const skillIds =
      state.agentInput.skillIds && state.agentInput.skillIds.length > 0
        ? state.agentInput.skillIds
        : [state.agentInput.skillId];
    const title =
      state.agentInput.title?.trim() ||
      state.agentInput.prompt.trim().slice(0, 80);
    const preparedTask = {
      skillId: state.agentInput.skillId,
      skillIds,
      prompt: state.agentInput.prompt,
      title,
      conversationId: state.agentInput.conversationId,
      userMessageId: state.agentInput.userMessageId,
      assistantMessageId: state.agentInput.assistantMessageId,
      executionBoundary: state.agentInput.executionBoundary,
    };
    const nextState: PiAgentRunGraphState = {
      ...state,
      preparedTask,
    };

    await hooks?.onNodeProgress?.("prepare_agent_task", {
      message: "Pi agent task prepared",
      skillId: preparedTask.skillId,
      skillIds: preparedTask.skillIds,
      title,
    });

    return nextState;
  }

  private async executeAgentRuntime(
    state: PiAgentRunGraphState,
    hooks?: WorkflowGraphExecutionHooks,
    signal?: AbortSignal,
  ) {
    const task = state.preparedTask;
    if (!task) {
      throw new WorkflowDomainError(
        WORKFLOW_ERROR_CODES.WORKFLOW_NODE_EXECUTION_FAILED,
        "Pi agent task 尚未准备",
      );
    }

    const startedRuntimeRun = await this.deps.agentRuntimeClient.startRun(
      {
        runId: state.runId,
        userId: state.userId,
        sessionId: task.conversationId,
        conversationId: task.conversationId,
        userMessageId: task.userMessageId,
        assistantMessageId: task.assistantMessageId,
        skillId: task.skillId,
        skillIds: task.skillIds,
        prompt: task.prompt,
        title: task.title,
        context: state.agentInput.context,
        executionBoundary: task.executionBoundary,
        sessionSeed: task.conversationId
          ? await this.deps.agentConversationRepository?.getSeedMessages(
              task.conversationId,
            )
          : undefined,
      },
      signal,
    );

    if (startedRuntimeRun.status === "waiting_for_input") {
      await this.deps.agentRuntimeClient.resumeRun(
        state.runId,
        {
          prompt: task.prompt,
          userMessageId: task.userMessageId ?? "",
          assistantMessageId: task.assistantMessageId ?? "",
        },
        signal,
      );
    }

    const streamAbort = new AbortController();
    const abortStream = () => streamAbort.abort(signal?.reason);
    if (signal?.aborted) {
      abortStream();
    } else {
      signal?.addEventListener("abort", abortStream, { once: true });
    }
    let runtimeEvents = [...state.runtimeEvents];
    let toolCallCount = state.toolCallCount;
    let waitingForInput = state.waitingForInput;

    try {
      for await (const event of this.deps.agentRuntimeClient.streamRunEvents({
        runId: state.runId,
        afterSequence: runtimeEvents.at(-1)?.sequence ?? 0,
        signal: streamAbort.signal,
      })) {
        runtimeEvents = [...runtimeEvents, event];
        await this.deps.agentRuntimeRepository.recordRuntimeEvent(
          state.runId,
          event,
        );

        if (event.type === "tool.call.started") {
          toolCallCount += 1;
        }

        if (event.type === "agent.message.delta" && task.assistantMessageId) {
          const delta =
            event.payload && typeof event.payload.delta === "string"
              ? event.payload.delta
              : "";
          await this.deps.agentConversationRepository?.appendAssistantDelta(
            task.assistantMessageId,
            delta,
          );
        }

        if (event.type === "agent.message.start" && task.assistantMessageId) {
          await this.deps.agentConversationRepository?.markAssistantStreaming(
            task.assistantMessageId,
          );
        }

        if (event.type === "user.input.requested") {
          waitingForInput = parseUserInputRequest(event.payload);
          if (waitingForInput) {
            await this.deps.agentConversationRepository?.markAssistantWaitingByRun(
              state.runId,
              waitingForInput,
            );
          }
        }

        await hooks?.onNodeProgress?.("execute_agent_runtime", {
          piEventType: event.type,
          piSequence: event.sequence,
          message: event.message,
          payload: event.payload ?? {},
        });

        if (event.type === "run.waiting_for_input") {
          const request =
            parseUserInputRequest(event.payload) ?? waitingForInput;
          if (request) {
            throw new WorkflowPauseError(
              "Pi agent 正在等待用户补充信息",
              "user_input_required",
              {
                currentNodeKey: "execute_agent_runtime",
                waitingForInput: request,
                runtimeEvents,
                toolCallCount,
              },
            );
          }
        }

        if (isTerminalRuntimeEvent(event.type)) {
          break;
        }
      }
    } finally {
      streamAbort.abort();
      signal?.removeEventListener("abort", abortStream);
    }

    throwIfAborted(signal);
    const runtimeRun = await this.deps.agentRuntimeClient.getRun(
      state.runId,
      signal,
    );

    if (runtimeRun.status === "waiting_for_input") {
      const request =
        runtimeRun.waitingForInput ??
        parseUserInputRequest(runtimeEvents.at(-1)?.payload) ??
        waitingForInput;
      if (request) {
        throw new WorkflowPauseError(
          "Pi agent 正在等待用户补充信息",
          "user_input_required",
          {
            currentNodeKey: "execute_agent_runtime",
            waitingForInput: request,
            runtimeEvents,
            toolCallCount,
          },
        );
      }
    }

    if (runtimeRun.status === "failed") {
      if (task.assistantMessageId) {
        await this.deps.agentConversationRepository?.markAssistantFailed({
          messageId: task.assistantMessageId,
          status: "FAILED",
          errorCode: runtimeRun.errorCode,
          errorMessage: runtimeRun.errorMessage ?? "Pi agent-runtime 执行失败",
        });
      }
      throw new WorkflowDomainError(
        WORKFLOW_ERROR_CODES.WORKFLOW_NODE_EXECUTION_FAILED,
        runtimeRun.errorMessage ?? "Pi agent-runtime 执行失败",
      );
    }

    if (runtimeRun.status === "cancelled") {
      if (task.assistantMessageId) {
        await this.deps.agentConversationRepository?.markAssistantFailed({
          messageId: task.assistantMessageId,
          status: "CANCELLED",
          errorCode: "PI_AGENT_CANCELLED",
          errorMessage: "Pi agent-runtime 已取消",
        });
      }
      throw new RunCancelledError("Pi agent-runtime 已取消");
    }

    if (task.assistantMessageId) {
      const finalText =
        runtimeRun.finalOutput &&
        typeof runtimeRun.finalOutput.text === "string"
          ? runtimeRun.finalOutput.text
          : "";
      await this.deps.agentConversationRepository?.markAssistantSucceeded({
        messageId: task.assistantMessageId,
        content: finalText,
        metadata: {
          runId: state.runId,
          skillId: task.skillId,
          skillIds: task.skillIds,
          generatedAt:
            runtimeRun.finalOutput &&
            typeof runtimeRun.finalOutput.generatedAt === "string"
              ? runtimeRun.finalOutput.generatedAt
              : new Date().toISOString(),
        },
      });
    }

    return {
      ...state,
      runtimeEvents,
      waitingForInput,
      finalOutput: runtimeRun.finalOutput,
      toolCallCount,
    };
  }

  private async persistAgentResult(
    state: PiAgentRunGraphState,
    hooks?: WorkflowGraphExecutionHooks,
  ) {
    const artifacts = await this.deps.agentRuntimeRepository.listArtifacts(
      state.runId,
    );
    await hooks?.onNodeProgress?.("persist_agent_result", {
      message: "Pi agent artifacts persisted",
      artifactCount: artifacts.length,
    });

    return {
      ...state,
      artifactIds: artifacts.map((artifact) => artifact.id),
    };
  }
}
