import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { AgentHarness, type Skill } from "@earendil-works/pi-agent-core";
import { createModels } from "@earendil-works/pi-ai";
import { deepseekProvider } from "@earendil-works/pi-ai/providers/deepseek";
import type {
  AgentExecutionAdapter,
  AgentExecutionOutcome,
  AgentRunPlan,
  AgentRunSkill,
} from "./agent-runner";
import { buildResearchOnlySystemInstruction } from "./research-only-policy";
import {
  extractPiMessageText,
  isScheduledTaskFlowComplete,
  registerPiHarnessEventHandlers,
  resolveScheduledTaskFlowFailure,
  type PiHarnessEventState,
} from "./pi-harness-events";
import { PiSessionAdapter } from "./pi-session-adapter";
import { RestrictedExecutionEnv } from "./restricted-env";
import type { AgentRuntimeConfig } from "./types";

function buildMergedSkill(skills: AgentRunSkill[]): Skill {
  const primary = skills[0];
  if (!primary) {
    throw new Error("缺少主 skill");
  }
  if (skills.length === 1) {
    return {
      name: primary.id,
      description: primary.description,
      content: primary.content,
      filePath: path.join(primary.referencesRoot, "SKILL.md"),
    };
  }

  return {
    name: primary.id,
    description: skills.map((skill) => skill.description).join(" / "),
    filePath: path.join(primary.referencesRoot, "SKILL.md"),
    content: [
      "# 合并 Skill 执行说明",
      "",
      "你需要按用户选择顺序综合使用下列 skill。若要求冲突，优先遵循排在前面的 skill。",
      "",
      ...skills.flatMap((skill, index) => [
        `## Skill ${index + 1}: ${skill.id}`,
        "",
        `description: ${skill.description}`,
        `referencesRoot: ${skill.referencesRoot}`,
        "",
        "```text",
        skill.content,
        "```",
        "",
      ]),
    ].join("\n"),
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
    "回答涉及可能变化的信息时，必须基于当前时间判断资料是否过期。",
    "缺少发布时间、更新时间或数据日期的材料必须降低证据权重并说明不确定性。",
    "只能使用已注册工具，不得访问本地项目文件、环境变量或任意 shell。",
    "缺少会改变研究方向的必要信息时必须调用 ask_user；调用后立即结束本轮。",
    "不得用普通确认文本代替 ask_user，也不得在调用 ask_user 后继续执行工具。",
    "内部投研对象工具只读，不得声称已经修改、删除、保存或加入收藏。",
    buildResearchOnlySystemInstruction(),
    "默认使用中文输出，并在涉及数据、网页或筛选结果时说明来源。",
    "不得输出收益保证或确定性投资承诺。",
  ].join("\n");
}

export class PiHarnessAdapter implements AgentExecutionAdapter {
  constructor(
    private readonly config: AgentRuntimeConfig,
    private readonly sessionAdapter: PiSessionAdapter,
  ) {}

  async execute(params: {
    plan: AgentRunPlan;
    signal: AbortSignal;
    emit: Parameters<AgentExecutionAdapter["execute"]>[0]["emit"];
  }): Promise<AgentExecutionOutcome> {
    const { plan, signal, emit } = params;
    const tempRoot = path.join(os.tmpdir(), "alphaflow-agent-runtime", plan.runId);
    await fs.mkdir(tempRoot, { recursive: true });
    const env = new RestrictedExecutionEnv({
      cwd: tempRoot,
      readRoots: [
        ...new Set([
          ...plan.skills.map((skill) => skill.referencesRoot),
          tempRoot,
        ]),
      ],
      writeRoots: [tempRoot],
    });
    const state: PiHarnessEventState = {
      lastAssistantText: "",
      scheduledDraftBuilt: false,
      toolSummaries: [],
    };
    let usage: { inputTokens: number; outputTokens: number; cost?: number } = {
      inputTokens: 0,
      outputTokens: 0,
    };

    try {
      const session = await this.sessionAdapter.resolve(plan.session);
      const models = createModels();
      models.setProvider(deepseekProvider());
      const executionSnapshot = plan.execution.snapshot;
      const model = models.getModel(
        executionSnapshot.model.provider,
        executionSnapshot.model.id,
      );
      if (!model) {
        return {
          kind: "stopped",
          stopReason: "model_error",
          error: {
            code: "MODEL_NOT_FOUND",
            message: `Pi 模型未注册: ${executionSnapshot.model.provider}/${executionSnapshot.model.id}`,
          },
          usage,
          evidenceGaps: [],
        };
      }

      const tools = [...plan.execution.capabilities()];
      const activeToolNames = tools.map((tool) => tool.name);
      const scheduledTaskInteractive =
        executionSnapshot.interactionMode === "scheduled_task_setup" ||
        executionSnapshot.interactionMode === "scheduled_task_edit";
      const runtimeSkill = buildMergedSkill(plan.skills);
      const harness = new AgentHarness({
        env,
        session,
        models,
        model,
        systemPrompt: resolveSystemPrompt(),
        streamOptions: {
          timeoutMs: scheduledTaskInteractive
            ? Math.min(this.config.modelTimeoutMs, 60_000)
            : this.config.modelTimeoutMs,
          maxRetries: scheduledTaskInteractive ? 0 : this.config.modelMaxRetries,
        },
        resources: { skills: [runtimeSkill] },
        tools,
        activeToolNames,
      });
      signal.addEventListener("abort", () => void harness.abort(), { once: true });
      registerPiHarnessEventHandlers({ harness, emit, state });

      if (plan.session.mode === "persistent") {
        await this.sessionAdapter.compactIfNeeded({
          harness,
          phase: "before",
          emit,
        });
      }
      const context = plan.context
        ? `\n\n附加上下文：\n${JSON.stringify(plan.context, null, 2)}`
        : "";
      const assistantMessage = await harness.skill(
        runtimeSkill.name,
        `${plan.prompt}${context}`,
      );
      const messageUsage = (
        assistantMessage as {
          usage?: {
            input?: number;
            output?: number;
            cost?: { total?: number };
          };
        }
      ).usage;
      usage = {
        inputTokens: messageUsage?.input ?? 0,
        outputTokens: messageUsage?.output ?? 0,
        ...(messageUsage?.cost?.total !== undefined
          ? { cost: messageUsage.cost.total }
          : {}),
      };

      if (state.waitingForInput) {
        return {
          kind: "waiting_for_input",
          inputRequest: state.waitingForInput,
          usage,
          evidenceGaps: [],
        };
      }
      if (signal.aborted) {
        return {
          kind: "stopped",
          stopReason: "cancelled",
          error: { code: "CANCELLED", message: "cancel_requested" },
          partialText: state.lastAssistantText || undefined,
          usage,
          evidenceGaps: [],
        };
      }
      if (scheduledTaskInteractive && !isScheduledTaskFlowComplete(state)) {
        const failure = resolveScheduledTaskFlowFailure(state);
        return {
          kind: "stopped",
          stopReason: "contract_invalid",
          error: { code: failure.errorCode, message: failure.errorMessage },
          partialText: state.lastAssistantText || undefined,
          usage,
          evidenceGaps: [],
        };
      }
      if (plan.session.mode === "persistent") {
        await this.sessionAdapter.compactIfNeeded({
          harness,
          phase: "after",
          emit,
        });
      }
      if (signal.aborted) {
        return {
          kind: "stopped",
          stopReason: "cancelled",
          error: { code: "CANCELLED", message: "cancel_requested" },
          partialText: state.lastAssistantText || undefined,
          usage,
          evidenceGaps: [],
        };
      }
      return {
        kind: "completed",
        text: extractPiMessageText(assistantMessage),
        usage,
        evidenceGaps: [],
      };
    } catch (error) {
      if (state.waitingForInput) {
        return {
          kind: "waiting_for_input",
          inputRequest: state.waitingForInput,
          usage,
          evidenceGaps: [],
        };
      }
      const message = error instanceof Error ? error.message : "未知错误";
      const stopReason = signal.aborted
        ? "cancelled"
        : /未授权|扩权|能力|constraint|网络策略/.test(message)
            ? "boundary_violation"
            : "model_error";
      return {
        kind: "stopped",
        stopReason,
        error: {
          code: stopReason === "model_error" ? "PI_AGENT_FAILED" : stopReason.toUpperCase(),
          message,
        },
        partialText: state.lastAssistantText || undefined,
        usage,
        evidenceGaps: [],
      };
    } finally {
      await env.cleanup();
    }
  }
}
