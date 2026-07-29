import { z } from "zod";
import { env } from "~/env";
import {
  WORKFLOW_ERROR_CODES,
  WorkflowDomainError,
} from "~/server/domain/workflow/errors";

const agentRuntimeSkillSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  category: z.string().default("个股研究"),
  type: z.enum(["prompt", "tool"]),
  permissions: z.array(z.string()),
});

const agentRuntimeEventSchema = z.object({
  runId: z.string(),
  sequence: z.number().int(),
  type: z.string(),
  timestamp: z.string(),
  message: z.string().optional(),
  payload: z.record(z.unknown()).optional(),
});

const agentRuntimeRunSchema = z.object({
  id: z.string(),
  status: z.enum([
    "queued",
    "running",
    "waiting_for_input",
    "succeeded",
    "failed",
    "cancelled",
  ]),
  skillId: z.string(),
  skillIds: z.array(z.string()).optional(),
  title: z.string(),
  input: z.object({
    prompt: z.string(),
    skillIds: z.array(z.string()).optional(),
    context: z.record(z.unknown()).optional(),
  }),
  finalOutput: z.record(z.unknown()).optional(),
  errorCode: z.string().optional(),
  errorMessage: z.string().optional(),
  createdAt: z.string(),
  startedAt: z.string().optional(),
  completedAt: z.string().optional(),
  waitingForInput: z
    .object({
      question: z.string(),
      options: z
        .array(z.object({ label: z.string(), value: z.string() }))
        .max(6)
        .optional(),
    })
    .optional(),
  events: z.array(agentRuntimeEventSchema),
});

const listSkillsResponseSchema = z.object({
  items: z.array(agentRuntimeSkillSchema),
  diagnostics: z.array(z.string()).default([]),
});

export type AgentRuntimeSkill = z.infer<typeof agentRuntimeSkillSchema>;
export type AgentRuntimeEvent = z.infer<typeof agentRuntimeEventSchema>;
export type AgentRuntimeRun = z.infer<typeof agentRuntimeRunSchema>;

export type StartAgentRuntimeRunInput = {
  runId: string;
  userId: string;
  sessionId?: string;
  conversationId?: string;
  userMessageId?: string;
  assistantMessageId?: string;
  skillId: string;
  skillIds: string[];
  prompt: string;
  title?: string;
  context?: Record<string, unknown>;
  sessionSeed?: Array<{
    role: "user" | "assistant";
    content: string;
    skillId?: string;
  }>;
};

export type ResumeAgentRuntimeRunInput = {
  prompt: string;
  userMessageId: string;
  assistantMessageId: string;
};

function normalizeBaseUrl(rawBaseUrl: string) {
  return rawBaseUrl.replace(/\/$/, "");
}

function toWorkflowError(error: unknown) {
  if (error instanceof WorkflowDomainError) {
    return error;
  }

  const message =
    error instanceof Error ? error.message : "未知 agent-runtime 错误";
  return new WorkflowDomainError(
    WORKFLOW_ERROR_CODES.WORKFLOW_NODE_EXECUTION_FAILED,
    message,
  );
}

function parseSseChunk(chunk: string) {
  const dataLines = chunk
    .split(/\r?\n/)
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice("data:".length).trimStart());

  if (dataLines.length === 0) {
    return null;
  }

  return agentRuntimeEventSchema.parse(JSON.parse(dataLines.join("\n")));
}

export class AgentRuntimeClient {
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly cancelTimeoutMs: number;

  constructor(config?: {
    baseUrl?: string;
    timeoutMs?: number;
    cancelTimeoutMs?: number;
  }) {
    this.baseUrl = normalizeBaseUrl(config?.baseUrl ?? env.AGENT_RUNTIME_URL);
    this.timeoutMs = config?.timeoutMs ?? env.AGENT_RUNTIME_TIMEOUT_MS;
    this.cancelTimeoutMs =
      config?.cancelTimeoutMs ?? env.AGENT_RUNTIME_CANCEL_TIMEOUT_MS;
  }

  async listSkills() {
    return listSkillsResponseSchema.parse(await this.requestJson("/skills"));
  }

  async startRun(input: StartAgentRuntimeRunInput, signal?: AbortSignal) {
    return agentRuntimeRunSchema.parse(
      await this.requestJson(
        "/runs",
        {
          method: "POST",
          body: JSON.stringify(input),
        },
        signal,
      ),
    );
  }

  async getRun(runId: string, signal?: AbortSignal) {
    return agentRuntimeRunSchema.parse(
      await this.requestJson(`/runs/${runId}`, undefined, signal),
    );
  }

  async resumeRun(
    runId: string,
    input: ResumeAgentRuntimeRunInput,
    signal?: AbortSignal,
  ) {
    return agentRuntimeRunSchema.parse(
      await this.requestJson(
        `/runs/${runId}/resume`,
        {
          method: "POST",
          body: JSON.stringify(input),
        },
        signal,
      ),
    );
  }

  async cancelRun(runId: string) {
    await this.requestJson(`/runs/${runId}/cancel`, {
      method: "POST",
      body: JSON.stringify({}),
    }, undefined, this.cancelTimeoutMs);
  }

  async *streamRunEvents(params: {
    runId: string;
    afterSequence?: number;
    signal?: AbortSignal;
  }): AsyncGenerator<AgentRuntimeEvent> {
    const query =
      typeof params.afterSequence === "number"
        ? `?afterSequence=${params.afterSequence}`
        : "";
    const response = await fetch(
      `${this.baseUrl}/runs/${params.runId}/events${query}`,
      {
        signal: params.signal,
        headers: {
          Accept: "text/event-stream",
        },
      },
    ).catch((error) => {
      throw toWorkflowError(error);
    });

    if (!response.ok || !response.body) {
      const errorText = await response.text().catch(() => "");
      throw new WorkflowDomainError(
        WORKFLOW_ERROR_CODES.WORKFLOW_NODE_EXECUTION_FAILED,
        `agent-runtime SSE 连接失败: ${response.status} ${response.statusText}${errorText ? ` - ${errorText}` : ""}`,
      );
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    try {
      while (true) {
        const result = await reader.read();
        if (result.done) {
          break;
        }

        buffer += decoder.decode(result.value, { stream: true });
        const chunks = buffer.split(/\n\n/);
        buffer = chunks.pop() ?? "";

        for (const chunk of chunks) {
          const event = parseSseChunk(chunk);
          if (event) {
            yield event;
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
  }

  private async requestJson(
    path: string,
    init?: RequestInit,
    parentSignal?: AbortSignal,
    timeoutMs = this.timeoutMs,
  ) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    const abortFromParent = () => controller.abort(parentSignal?.reason);

    if (parentSignal?.aborted) {
      abortFromParent();
    } else {
      parentSignal?.addEventListener("abort", abortFromParent, {
        once: true,
      });
    }

    try {
      const response = await fetch(`${this.baseUrl}${path}`, {
        ...init,
        signal: controller.signal,
        headers: {
          "Content-Type": "application/json",
          ...init?.headers,
        },
      });

      if (!response.ok) {
        const errorText = await response.text().catch(() => "");
        throw new WorkflowDomainError(
          WORKFLOW_ERROR_CODES.WORKFLOW_NODE_EXECUTION_FAILED,
          `agent-runtime 请求失败: ${response.status} ${response.statusText}${errorText ? ` - ${errorText}` : ""}`,
        );
      }

      return await response.json();
    } catch (error) {
      throw toWorkflowError(error);
    } finally {
      clearTimeout(timeout);
      parentSignal?.removeEventListener("abort", abortFromParent);
    }
  }
}
