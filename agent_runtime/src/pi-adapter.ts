import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  AgentHarness,
  estimateContextTokens,
  InMemorySessionRepo,
  JsonlSessionRepo,
  type AgentHarnessEvent,
  type AgentMessage,
  type Skill,
  type Session,
  type JsonlSessionMetadata,
} from "@earendil-works/pi-agent-core";
import { createModels } from "@earendil-works/pi-ai";
import { deepseekProvider } from "@earendil-works/pi-ai/providers/deepseek";
import { asJsonObject, summarizeValue } from "./json";
import { PythonGatewayClient } from "./python-gateway-client";
import { RestrictedExecutionEnv } from "./restricted-env";
import type { SkillRegistry } from "./skill-registry";
import { createInternalTools } from "./tool-policy";
import type { AgentRuntimeConfig, StartRunRequest } from "./types";
import type { AgentRuntimeRunStore } from "./run-store";

function extractMessageText(message: AgentMessage | unknown) {
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

function createSeedMessage(role: "user" | "assistant", content: string): AgentMessage {
  if (role === "user") {
    return {
      role,
      content: [{ type: "text", text: content }],
      timestamp: Date.now(),
    };
  }

  return {
    role,
    content: [{ type: "text", text: content }],
    api: "seed",
    provider: "seed",
    model: "seed",
    stopReason: "stop",
    timestamp: Date.now(),
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
  };
}

function resolveSystemPrompt() {
  return [
    "你运行在 AlphaFlow agent-runtime sidecar 中。",
    "只能使用已注册工具，不要尝试访问本地项目文件、环境变量或任意 shell。",
    "默认使用中文输出，并在涉及数据、网页或筛选结果时说明来源。",
    "不得输出买卖建议、收益保证或确定性投资承诺。",
  ].join("\n");
}

function mapHarnessEvent(
  store: AgentRuntimeRunStore,
  request: StartRunRequest,
  event: AgentHarnessEvent<Skill>,
  state: { lastAssistantText: string },
) {
  if (event.type === "message_start" && event.message.role === "assistant") {
    state.lastAssistantText = "";
    store.appendEvent(request.runId, "agent.message.start", {
      conversationId: request.conversationId,
      assistantMessageId: request.assistantMessageId,
    });
    return;
  }

  if (event.type === "message_update" && event.message.role === "assistant") {
    const text = extractMessageText(event.message);
    if (text.length > state.lastAssistantText.length) {
      const delta = text.slice(state.lastAssistantText.length);
      state.lastAssistantText = text;
      store.appendEvent(
        request.runId,
        "agent.message.delta",
        {
          conversationId: request.conversationId,
          assistantMessageId: request.assistantMessageId,
          delta,
          text,
        },
        delta,
      );
    }
    return;
  }

  if (event.type === "message_end") {
    if (event.message.role !== "assistant") {
      return;
    }
    const text = extractMessageText(event.message);
    if (text.trim()) {
      state.lastAssistantText = text.trim();
      store.appendEvent(
        request.runId,
        "agent.message",
        {
          text: text.trim(),
          conversationId: request.conversationId,
          assistantMessageId: request.assistantMessageId,
        },
        text.trim(),
      );
    }
    return;
  }

  if (event.type === "tool_call") {
    store.appendEvent(request.runId, "tool.call.started", {
      toolCallId: event.toolCallId,
      toolName: event.toolName,
      skillId: request.skillId,
      inputSummary: summarizeValue(event.input, 1000),
    });
    return;
  }

  if (event.type === "tool_result") {
    const payload = {
      toolCallId: event.toolCallId,
      toolName: event.toolName,
      skillId: request.skillId,
      inputSummary: summarizeValue(event.input, 1000),
      outputSummary: summarizeValue(
        {
          content: event.content,
          details: event.details,
        },
        1400,
      ),
      isError: event.isError,
    };

    store.appendEvent(
      request.runId,
      event.isError ? "tool.call.failed" : "tool.call.completed",
      payload,
    );
  }
}

export class PiAdapter {
  private readonly pythonGatewayClient: PythonGatewayClient;
  private readonly sessionRepo: JsonlSessionRepo;

  constructor(
    private readonly config: AgentRuntimeConfig,
    private readonly skillRegistry: SkillRegistry,
    private readonly store: AgentRuntimeRunStore,
  ) {
    this.pythonGatewayClient = new PythonGatewayClient(config);
    const sessionEnv = new RestrictedExecutionEnv({
      cwd: process.cwd(),
      readRoots: [process.cwd(), path.resolve(config.sessionRoot)],
      writeRoots: [path.resolve(config.sessionRoot)],
    });
    this.sessionRepo = new JsonlSessionRepo({
      fs: sessionEnv,
      sessionsRoot: path.resolve(config.sessionRoot),
    });
  }

  private async resolveSession(
    request: StartRunRequest,
    tempRoot: string,
  ): Promise<Session> {
    if (!request.sessionId) {
      const sessionRepo = new InMemorySessionRepo();
      return sessionRepo.create({ id: request.runId });
    }

    const cwd = `conversation:${request.sessionId}`;
    const existing = (await this.sessionRepo.list({ cwd })).find(
      (metadata: JsonlSessionMetadata) => metadata.id === request.sessionId,
    );
    const session =
      existing ??
      (await this.sessionRepo
        .create({
          id: request.sessionId,
          cwd,
        })
        .then(async (createdSession) => {
          for (const seed of request.sessionSeed ?? []) {
            const content = seed.content.trim();
            if (content) {
              await createdSession.appendMessage(
                createSeedMessage(seed.role, content),
              );
            }
          }
          return null;
        }));

    if (session) {
      return this.sessionRepo.open(session);
    }

    const metadata = (await this.sessionRepo.list({ cwd })).find(
      (item) => item.id === request.sessionId,
    );
    if (!metadata) {
      const fallbackRepo = new InMemorySessionRepo();
      return fallbackRepo.create({ id: request.runId });
    }
    return this.sessionRepo.open(metadata);
  }

  private async compactIfNeeded(
    harness: AgentHarness<Skill>,
    runId: string,
    phase: "before" | "after",
  ) {
    try {
      const context = await (harness as unknown as {
        session?: { buildContext(): Promise<{ messages: AgentMessage[] }> };
      }).session?.buildContext();
      const tokenCount = context
        ? estimateContextTokens(context.messages)
        : undefined;
      if (
        typeof tokenCount === "number" &&
        tokenCount > this.config.compactionTokenThreshold
      ) {
        const result = await harness.compact(
          "保留用户明确表达的偏好、分析对象、关键结论、待验证问题和已经完成的工具结果摘要。",
        );
        this.store.appendEvent(runId, "session.compacted", {
          phase,
          tokenCount,
          summary: result.summary,
          firstKeptEntryId: result.firstKeptEntryId,
          tokensBefore: result.tokensBefore,
        });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.store.appendEvent(runId, "session.compacted", {
        phase,
        skipped: true,
        reason: message,
      });
    }
  }

  async start(request: StartRunRequest) {
    const skill = this.skillRegistry.get(request.skillId);
    if (!skill) {
      this.store.markFailed(
        request.runId,
        "SKILL_NOT_FOUND",
        `Skill 不存在: ${request.skillId}`,
      );
      return;
    }

    const abortController = new AbortController();
    this.store.attachAbortController(request.runId, abortController);
    this.store.markRunning(request.runId);

    const tempRoot = path.join(os.tmpdir(), "alphaflow-agent-runtime", request.runId);
    await fs.mkdir(tempRoot, { recursive: true });

    const env = new RestrictedExecutionEnv({
      cwd: tempRoot,
      readRoots: [path.dirname(skill.filePath), tempRoot],
      writeRoots: [tempRoot],
    });
    const session = await this.resolveSession(request, tempRoot);
    const models = createModels();
    models.setProvider(deepseekProvider());
    const model = models.getModel(this.config.modelProvider, this.config.modelId);

    if (!model) {
      this.store.markFailed(
        request.runId,
        "MODEL_NOT_FOUND",
        `Pi 模型未注册: ${this.config.modelProvider}/${this.config.modelId}`,
      );
      return;
    }

    const harness = new AgentHarness({
      env,
      session,
      models,
      model,
      systemPrompt: resolveSystemPrompt(),
      streamOptions: {
        timeoutMs: this.config.modelTimeoutMs,
        maxRetries: this.config.modelMaxRetries,
      },
      resources: {
        skills: [skill],
      },
      tools: createInternalTools({
        pythonGatewayClient: this.pythonGatewayClient,
        maxToolCalls: this.config.maxToolCallsPerRun,
        toolTimeoutMs: this.config.toolTimeoutMs,
      }),
      activeToolNames: [
        "internal_web_search",
        "internal_web_fetch",
        "internal_concept_match",
        "internal_screening_query",
      ],
    });

    abortController.signal.addEventListener(
      "abort",
      () => {
        void harness.abort();
      },
      { once: true },
    );

    const eventState = { lastAssistantText: "" };
    harness.subscribe((event) => {
      mapHarnessEvent(this.store, request, event, eventState);
    });

    try {
      if (request.sessionId) {
        await this.compactIfNeeded(harness, request.runId, "before");
      }
      const context = request.context
        ? `\n\n附加上下文：\n${JSON.stringify(request.context, null, 2)}`
        : "";
      const assistantMessage = await harness.skill(
        request.skillId,
        `${request.prompt}${context}`,
      );
      if (request.sessionId) {
        await this.compactIfNeeded(harness, request.runId, "after");
      }
      const text = extractMessageText(assistantMessage);
      const finalOutput = {
        text,
        skillId: request.skillId,
        generatedAt: new Date().toISOString(),
        context: asJsonObject(request.context),
      };

      this.store.appendEvent(request.runId, "artifact.created", {
        kind: "report",
        title: request.title ?? "投研助手报告",
        contentType: "text/markdown",
        payload: finalOutput,
      });
      this.store.markSucceeded(request.runId, finalOutput);
    } catch (error) {
      if (abortController.signal.aborted) {
        this.store.markCancelled(request.runId, "cancel_requested");
        return;
      }

      const message = error instanceof Error ? error.message : "未知错误";
      this.store.markFailed(request.runId, "PI_AGENT_FAILED", message);
    } finally {
      await env.cleanup();
    }
  }
}
