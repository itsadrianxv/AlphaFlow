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
import { WebInternalClient } from "./web-internal-client";
import { ScheduledTaskEventPublisher } from "./scheduled-task-events";

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

function parseScheduledOutput(text: string) {
  const candidate = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  try {
    const parsed = JSON.parse(candidate) as Record<string, unknown>;
    return {
      title: typeof parsed.title === "string" ? parsed.title : "定时任务",
      summary: typeof parsed.summary === "string" ? parsed.summary : text,
      body: typeof parsed.body === "string" ? parsed.body : text,
      evidence: Array.isArray(parsed.evidence) ? parsed.evidence : [],
      quality: parsed.quality && typeof parsed.quality === "object" ? parsed.quality : { status: "OK", warnings: [] },
    };
  } catch {
    return { title: "定时任务", summary: text, body: text, evidence: [], quality: { status: "DEGRADED", warnings: ["Agent 未返回结构化 JSON"] } };
  }
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

function resolveSystemPrompt(now = new Date()) {
  const currentIso = now.toISOString();
  const currentLocal = new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    dateStyle: "full",
    timeStyle: "long",
  }).format(now);
  return [
    "你运行在 AlphaFlow agent-runtime sidecar 中。",
    `当前日期时间：${currentLocal}`,
    `当前时间 ISO：${currentIso}`,
    "默认时区：Asia/Shanghai。",
    "回答涉及新闻、价格、政策、法规、公司信息、人物任职、产品版本、API 文档、市场行情、财报、公告、排名等可能变化的信息时，必须基于上述当前时间判断资料是否过期。",
    "如果搜索结果、网页或工具返回内容缺少发布时间、更新时间或数据日期，必须降低其证据权重，并在回答中说明不确定性。",
    "只能使用已注册工具，不要尝试访问本地项目文件、环境变量或任意 shell。",
    "当用户提到“我的收藏”“我的行业”“我的公司”“我的自选股”“已有笔记”或“已保存报告”时，优先使用内部投研对象工具读取当前用户授权范围内的对象。",
    "仅在用户明确提出分析、比较、补充、风险、催化、跟踪指标或类似请求时，才基于投研对象继续调用行情、财务、事件、资金流等市场数据工具；普通列举或查看请求不要主动补行情财务。",
    "内部投研对象工具是只读工具，不得声称已经保存、修改、删除或加入收藏；如果用户要求保存，只输出可保存的文本草稿并说明当前运行不会写入收藏。",
    "默认使用中文输出，并在涉及数据、网页或筛选结果时说明来源。",
    "不得输出买卖建议、收益保证或确定性投资承诺。",
  ].join("\n");
}

function resolveSkillIds(request: StartRunRequest) {
  return request.skillIds && request.skillIds.length > 0
    ? request.skillIds
    : [request.skillId];
}

function buildMergedSkill(skills: Skill[]): Skill {
  if (skills.length === 1 && skills[0]) {
    return skills[0];
  }

  const primary = skills[0];
  if (!primary) {
    throw new Error("缺少主 skill");
  }

  const content = [
    "# 合并 Skill 执行说明",
    "",
    "你需要按用户选择顺序综合使用下列 skill。若不同 skill 的要求冲突，优先遵循排在前面的 skill，并在结论中保持一致口径。",
    "",
    ...skills.flatMap((skill, index) => [
      `## Skill ${index + 1}: ${skill.name}`,
      "",
      `description: ${skill.description}`,
      `referencesRoot: ${path.dirname(skill.filePath)}`,
      "",
      "```text",
      skill.content,
      "```",
      "",
    ]),
  ].join("\n");

  return {
    ...primary,
    description: skills.map((skill) => skill.description).join(" / "),
    content,
  };
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
      skillIds: resolveSkillIds(request),
      inputSummary: summarizeValue(event.input, 1000),
    });
    return;
  }

  if (event.type === "tool_result") {
    const payload = {
      toolCallId: event.toolCallId,
      toolName: event.toolName,
      skillId: request.skillId,
      skillIds: resolveSkillIds(request),
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
  private readonly webInternalClient: WebInternalClient;
  private readonly sessionRepo: JsonlSessionRepo;
  private readonly scheduledEvents: ScheduledTaskEventPublisher;

  constructor(
    private readonly config: AgentRuntimeConfig,
    private readonly skillRegistry: SkillRegistry,
    private readonly store: AgentRuntimeRunStore,
  ) {
    this.pythonGatewayClient = new PythonGatewayClient(config);
    this.webInternalClient = new WebInternalClient(config);
    this.scheduledEvents = new ScheduledTaskEventPublisher(config);
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
    const skillIds = resolveSkillIds(request);
    const skills = skillIds
      .map((skillId) => this.skillRegistry.get(skillId))
      .filter((skill): skill is Skill => Boolean(skill));
    const missingSkillId = skillIds.find(
      (skillId) => !skills.some((skill) => skill.name === skillId),
    );

    if (missingSkillId) {
      this.store.markFailed(
        request.runId,
        "SKILL_NOT_FOUND",
        `Skill 不存在: ${missingSkillId}`,
      );
      return;
    }

    if (!skills[0]) {
      this.store.markFailed(request.runId, "SKILL_NOT_FOUND", "缺少主 skill");
      return;
    }

    const runtimeSkill = buildMergedSkill(skills);

    const abortController = new AbortController();
    this.store.attachAbortController(request.runId, abortController);
    this.store.markRunning(request.runId);
    const scheduledContext = request.context as Record<string, unknown> | undefined;
    const executionId = typeof scheduledContext?.executionId === "string" ? scheduledContext.executionId : undefined;
    const taskId = typeof scheduledContext?.taskId === "string" ? scheduledContext.taskId : "";
    const taskVersionId = typeof scheduledContext?.taskVersionId === "string" ? scheduledContext.taskVersionId : "";
    const publishScheduled = (eventType: "execution.started" | "execution.succeeded" | "execution.failed" | "execution.cancelled", status: string, error?: string) => executionId && taskId && taskVersionId ? this.scheduledEvents.publish({ eventType, executionId, taskId, taskVersionId, runId: request.runId, status, resultRef: executionId, attempt: "1", ...(error ? { errorMessage: error } : {}) }).catch((publishError) => { this.store.appendEvent(request.runId, "run.failed", { event: "scheduled_event_publish_failed", error: publishError instanceof Error ? publishError.message : String(publishError) }); }) : Promise.resolve();
    await publishScheduled("execution.started", "running");

    const tempRoot = path.join(os.tmpdir(), "alphaflow-agent-runtime", request.runId);
    await fs.mkdir(tempRoot, { recursive: true });

    const env = new RestrictedExecutionEnv({
      cwd: tempRoot,
      readRoots: [
        ...new Set([
          ...skills.map((skill) => path.dirname(skill.filePath)),
          tempRoot,
        ]),
      ],
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

    const allToolNames = [
        "internal_web_search", "internal_web_fetch", "internal_concept_match", "internal_screening_query",
        "internal_research_targets_list", "internal_research_target_detail", "internal_research_notes_list",
        "internal_research_artifacts_list", "internal_watchlist_detail", "internal_stock_search", "internal_stock_profile",
        "internal_stock_bars", "internal_stock_daily_basic", "internal_index_market", "internal_index_constituents",
        "internal_moneyflow", "internal_market_events", "internal_shareholder_events", "internal_financial_statements",
        "internal_financial_indicators", "internal_earnings_events", "internal_fund_market", "internal_convertible_bond_market", "internal_macro_rates",
      ];
    const activeToolNames = request.allowedCapabilities?.length
      ? allToolNames.filter((name) => request.allowedCapabilities?.includes(name))
      : allToolNames;
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
        skills: [runtimeSkill],
      },
      tools: createInternalTools({
        pythonGatewayClient: this.pythonGatewayClient,
        webInternalClient: this.webInternalClient,
        runId: request.runId,
        userId: request.userId,
        maxToolCalls: this.config.maxToolCallsPerRun,
        toolTimeoutMs: this.config.toolTimeoutMs,
      }),
      activeToolNames,
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
        runtimeSkill.name,
        `${request.prompt}${context}`,
      );
      if (request.sessionId) {
        await this.compactIfNeeded(harness, request.runId, "after");
      }
      const text = extractMessageText(assistantMessage);
      const finalOutput = {
        text,
        skillId: request.skillId,
        skillIds,
        generatedAt: new Date().toISOString(),
        context: asJsonObject(request.context),
      };
      if (executionId) {
        await this.webInternalClient.persistScheduledTaskResult(executionId, { runId: request.runId, status: "SUCCEEDED", ...parseScheduledOutput(text) });
        await publishScheduled("execution.succeeded", "succeeded");
      }

      this.store.appendEvent(request.runId, "artifact.created", {
        kind: "report",
        title: request.title ?? "投研助手报告",
        contentType: "text/markdown",
        payload: finalOutput,
      });
      this.store.markSucceeded(request.runId, finalOutput);
    } catch (error) {
      if (abortController.signal.aborted) {
        if (executionId) {
          await this.webInternalClient.persistScheduledTaskResult(executionId, { runId: request.runId, status: "CANCELLED", error: { message: "cancel_requested" } }).catch(() => undefined);
          await publishScheduled("execution.cancelled", "cancelled", "cancel_requested");
        }
        this.store.markCancelled(request.runId, "cancel_requested");
        return;
      }

      const message = error instanceof Error ? error.message : "未知错误";
      if (executionId) {
        await this.webInternalClient.persistScheduledTaskResult(executionId, { runId: request.runId, status: "FAILED", error: { message } }).catch(() => undefined);
        await publishScheduled("execution.failed", "failed", message);
      }
      this.store.markFailed(request.runId, "PI_AGENT_FAILED", message);
    } finally {
      await env.cleanup();
    }
  }
}
