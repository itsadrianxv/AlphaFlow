import {
  AgentExecutionFactory,
  type AgentExecution,
  type AgentExecutionSnapshot,
} from "./agent-execution";
import type { PythonGatewayClient } from "./python-gateway-client";
import {
  createScheduledTaskSetupTools,
  SCHEDULED_TASK_SETUP_TOOL_NAMES,
} from "./scheduled-task-setup-tools";
import { createInternalTools, STANDARD_INTERNAL_TOOL_NAMES } from "./tool-policy";
import type { AgentRuntimeConfig, StartRunRequest } from "./types";
import type { WebInternalClient } from "./web-internal-client";

export const AGENT_MODE_CAPABILITIES = {
  research: [...STANDARD_INTERNAL_TOOL_NAMES],
  scheduled_task_setup: [...SCHEDULED_TASK_SETUP_TOOL_NAMES, "ask_user"],
  scheduled_task_edit: [...SCHEDULED_TASK_SETUP_TOOL_NAMES, "ask_user"],
  scheduled_task_execution: [
    ...STANDARD_INTERNAL_TOOL_NAMES.filter((name) => name !== "ask_user"),
    "internal_tushare_dataset",
  ],
} as const;

export class RuntimeAgentExecutionFactory {
  constructor(
    private readonly dependencies: {
      config: AgentRuntimeConfig;
      pythonGatewayClient: PythonGatewayClient;
      webInternalClient: WebInternalClient;
    },
  ) {}

  create(request: StartRunRequest, skillIds: string[], snapshot?: AgentExecutionSnapshot): AgentExecution {
    const { config, pythonGatewayClient, webInternalClient } = this.dependencies;
    const registry = new AgentExecutionFactory({
      modeCapabilities: AGENT_MODE_CAPABILITIES,
      createAdapters: () => [
        ...createInternalTools({
          pythonGatewayClient,
          webInternalClient,
          runId: request.runId,
          userId: request.userId,
          toolTimeoutMs: config.toolTimeoutMs,
        }),
        ...(request.conversationId
          ? createScheduledTaskSetupTools({
              webInternalClient,
              runId: request.runId,
              userId: request.userId,
              conversationId: request.conversationId,
              timeoutMs: Math.min(config.toolTimeoutMs, 30_000),
            })
          : []),
      ],
    });

    return registry.create({
      runId: request.runId,
      userId: request.userId,
      objective: request.title?.trim() || request.prompt.trim().slice(0, 160),
      input: {
        prompt: request.prompt,
        ...(request.context ? { context: request.context } : {}),
      },
      skillIds,
      interactionMode: request.interactionMode,
      policy: request.policy,
      model: { provider: config.modelProvider, id: config.modelId },
      snapshot,
    });
  }
}
