import type { ZodError, ZodType } from "zod";
import {
  WORKFLOW_ERROR_CODES,
  WorkflowDomainError,
} from "~/modules/research/server/domain/workflow/errors";
import { env } from "~/platform/env";

export type DeepSeekClientConfig = {
  apiKey?: string;
  baseUrl?: string;
  model?: string;
  timeoutMs?: number;
};

export type DeepSeekBudgetPolicy = {
  contextLimitHint?: number;
  maxRetries?: number;
  truncateStrategy?: Array<"keep_tail" | "drop_low_priority" | "trim_messages">;
  prioritySections?: string[];
};

export type DeepSeekRequestOptions = {
  model?: string;
  maxOutputTokens?: number;
  timeoutMs?: number;
  budgetPolicy?: DeepSeekBudgetPolicy;
  maxStructuredOutputRetries?: number;
};

export type DeepSeekMessage = {
  role: "system" | "user";
  content: string;
};

type DeepSeekResponse = {
  choices?: Array<{
    message?: {
      content?: string;
    };
  }>;
  error?: {
    message?: string;
    code?: string;
  };
};

const MODEL_CONTEXT_LIMIT_HINTS: Record<string, number> = {
  "deepseek-chat": 64_000,
  "deepseek-reasoner": 64_000,
};

const MODEL_TIMEOUT_MINIMUMS: Partial<Record<string, number>> = {
  "deepseek-chat": 45_000,
  "deepseek-reasoner": 60_000,
};

function extractJsonCandidate(content: string): string {
  const fencedMatch = content.match(/```json\s*([\s\S]*?)```/i);

  if (fencedMatch?.[1]) {
    return fencedMatch[1].trim();
  }

  const firstBracketIndex = [content.indexOf("{"), content.indexOf("[")]
    .filter((index) => index >= 0)
    .sort((left, right) => left - right)[0];

  if (firstBracketIndex === undefined) {
    return content.trim();
  }

  return content.slice(firstBracketIndex).trim();
}

function isTokenLimitError(message: string) {
  const normalized = message.toLowerCase();
  return (
    normalized.includes("context length") ||
    normalized.includes("maximum context") ||
    normalized.includes("too long") ||
    normalized.includes("token")
  );
}

function formatSchemaIssues(error: ZodError) {
  return error.issues
    .slice(0, 6)
    .map((issue) => {
      const path = issue.path.length > 0 ? issue.path.join(".") : "root";
      return `${path}: ${issue.message}`;
    })
    .join("; ");
}

function isStructuredOutputRecoverableError(error: unknown) {
  return (
    error instanceof WorkflowDomainError &&
    (error.code === WORKFLOW_ERROR_CODES.INTELLIGENCE_LLM_PARSE_FAILED ||
      error.code === WORKFLOW_ERROR_CODES.INTELLIGENCE_DATA_UNAVAILABLE)
  );
}

export class DeepSeekClient {
  private readonly apiKey?: string;
  private readonly baseUrl: string;
  private readonly model: string;
  private readonly timeoutMs: number;

  constructor(config?: DeepSeekClientConfig) {
    this.apiKey = config?.apiKey ?? env.DEEPSEEK_API_KEY;
    this.baseUrl = config?.baseUrl ?? env.DEEPSEEK_BASE_URL;
    this.model = config?.model ?? "deepseek-chat";
    this.timeoutMs = config?.timeoutMs ?? env.DEEPSEEK_TIMEOUT_MS;
  }

  isConfigured() {
    return Boolean(this.apiKey);
  }

  private getContextLimitHint(
    modelName: string,
    explicitHint?: number,
  ): number | undefined {
    if (typeof explicitHint === "number" && Number.isFinite(explicitHint)) {
      return explicitHint;
    }

    return MODEL_CONTEXT_LIMIT_HINTS[modelName];
  }

  private resolveTimeoutMs(modelName: string, explicitTimeoutMs?: number) {
    if (
      typeof explicitTimeoutMs === "number" &&
      Number.isFinite(explicitTimeoutMs) &&
      explicitTimeoutMs > 0
    ) {
      return explicitTimeoutMs;
    }

    return Math.max(this.timeoutMs, MODEL_TIMEOUT_MINIMUMS[modelName] ?? 0);
  }

  private truncateMessages(
    messages: DeepSeekMessage[],
    modelName: string,
    budgetPolicy?: DeepSeekBudgetPolicy,
  ) {
    const contextLimitHint = this.getContextLimitHint(
      modelName,
      budgetPolicy?.contextLimitHint,
    );

    if (!contextLimitHint) {
      return messages;
    }

    const maxChars = Math.max(1200, contextLimitHint * 3);
    const truncateStrategy = budgetPolicy?.truncateStrategy ?? [
      "drop_low_priority",
      "keep_tail",
      "trim_messages",
    ];

    let nextMessages = [...messages];
    for (const strategy of truncateStrategy) {
      const totalChars = nextMessages.reduce(
        (sum, message) => sum + message.content.length,
        0,
      );

      if (totalChars <= maxChars) {
        return nextMessages;
      }

      if (strategy === "drop_low_priority") {
        const prioritySections = (budgetPolicy?.prioritySections ?? []).filter(
          Boolean,
        );
        const systemMessages = nextMessages.filter(
          (message) => message.role === "system",
        );
        const prioritizedMessages = nextMessages.filter(
          (message) =>
            message.role !== "system" &&
            prioritySections.some((keyword) =>
              message.content.toLowerCase().includes(keyword.toLowerCase()),
            ),
        );
        const tailMessages = nextMessages
          .filter((message) => message.role !== "system")
          .slice(-2);

        nextMessages = [
          ...systemMessages,
          ...prioritizedMessages,
          ...tailMessages,
        ]
          .filter(
            (message, index, array) =>
              array.findIndex(
                (candidate) =>
                  candidate.role === message.role &&
                  candidate.content === message.content,
              ) === index,
          )
          .slice(0, Math.max(2, nextMessages.length));
        continue;
      }

      if (strategy === "keep_tail") {
        const systemMessages = nextMessages.filter(
          (message) => message.role === "system",
        );
        const tailMessages = nextMessages
          .filter((message) => message.role !== "system")
          .slice(-3);
        nextMessages = [...systemMessages, ...tailMessages];
        continue;
      }

      const perMessageLimit = Math.max(
        280,
        Math.floor(maxChars / Math.max(1, nextMessages.length)),
      );
      nextMessages = nextMessages.map((message) => ({
        ...message,
        content:
          message.content.length > perMessageLimit
            ? `${message.content.slice(0, perMessageLimit)}\n...[truncated]`
            : message.content,
      }));
    }

    return nextMessages;
  }

  async complete(
    messages: DeepSeekMessage[],
    fallbackText: string,
    options?: DeepSeekRequestOptions,
  ) {
    if (!this.apiKey) {
      return fallbackText;
    }

    const modelName = options?.model ?? this.model;
    const timeoutMs = this.resolveTimeoutMs(modelName, options?.timeoutMs);
    const maxRetries = options?.budgetPolicy?.maxRetries ?? 0;
    let nextMessages = [...messages];
    let currentAttempt = 0;

    while (currentAttempt <= maxRetries) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);

      try {
        const response = await fetch(`${this.baseUrl}/chat/completions`, {
          method: "POST",
          signal: controller.signal,
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${this.apiKey}`,
          },
          body: JSON.stringify({
            model: modelName,
            messages: nextMessages,
            temperature: 0.2,
            max_tokens: options?.maxOutputTokens,
          }),
        });

        if (!response.ok) {
          const responseText = await response.text();

          if (currentAttempt < maxRetries && isTokenLimitError(responseText)) {
            currentAttempt += 1;
            nextMessages = this.truncateMessages(
              nextMessages,
              modelName,
              options?.budgetPolicy,
            );
            continue;
          }

          throw new WorkflowDomainError(
            WORKFLOW_ERROR_CODES.INTELLIGENCE_DATA_UNAVAILABLE,
            `DeepSeek 请求失败: ${response.status} ${response.statusText}${responseText ? ` - ${responseText}` : ""}`,
          );
        }

        const data = (await response.json()) as DeepSeekResponse;
        const content = data.choices?.[0]?.message?.content?.trim();

        if (!content) {
          throw new WorkflowDomainError(
            WORKFLOW_ERROR_CODES.INTELLIGENCE_LLM_PARSE_FAILED,
            data.error?.message || "DeepSeek 返回空内容",
          );
        }

        return content;
      } catch (error) {
        if (error instanceof WorkflowDomainError) {
          if (currentAttempt < maxRetries && isTokenLimitError(error.message)) {
            currentAttempt += 1;
            nextMessages = this.truncateMessages(
              nextMessages,
              modelName,
              options?.budgetPolicy,
            );
            continue;
          }

          throw error;
        }

        if ((error as Error).name === "AbortError") {
          throw new WorkflowDomainError(
            WORKFLOW_ERROR_CODES.INTELLIGENCE_DATA_UNAVAILABLE,
            `DeepSeek 请求超时 (${timeoutMs}ms)`,
          );
        }

        throw new WorkflowDomainError(
          WORKFLOW_ERROR_CODES.INTELLIGENCE_DATA_UNAVAILABLE,
          `DeepSeek 请求异常: ${(error as Error).message}`,
        );
      } finally {
        clearTimeout(timer);
      }
    }

    return fallbackText;
  }

  async completeJson<T>(
    messages: DeepSeekMessage[],
    fallbackValue: T,
    options?: DeepSeekRequestOptions,
  ): Promise<T> {
    const maxStructuredOutputRetries = options?.maxStructuredOutputRetries ?? 0;
    let currentAttempt = 0;
    let currentMessages = [...messages];

    while (currentAttempt <= maxStructuredOutputRetries) {
      let raw: string;
      try {
        raw = await this.complete(
          currentMessages,
          JSON.stringify(fallbackValue),
          options,
        );
      } catch (error) {
        if (!isStructuredOutputRecoverableError(error)) {
          throw error;
        }

        if (currentAttempt >= maxStructuredOutputRetries) {
          return fallbackValue;
        }

        currentAttempt += 1;
        currentMessages = [
          ...messages,
          {
            role: "user",
            content:
              "Previous output was empty or unusable. Return valid JSON only.",
          },
        ];
        continue;
      }

      try {
        return JSON.parse(extractJsonCandidate(raw)) as T;
      } catch {
        if (currentAttempt >= maxStructuredOutputRetries) {
          return fallbackValue;
        }

        currentAttempt += 1;
        currentMessages = [
          ...messages,
          {
            role: "user",
            content: "?????? JSON????????????",
          },
        ];
      }
    }

    return fallbackValue;
  }

  async completeContract<T>(
    messages: DeepSeekMessage[],
    fallbackValue: T,
    schema: ZodType<T>,
    options?: DeepSeekRequestOptions,
  ): Promise<T> {
    const maxStructuredOutputRetries = options?.maxStructuredOutputRetries ?? 0;
    let currentAttempt = 0;
    let currentMessages = [...messages];
    const normalizedFallback = schema.safeParse(fallbackValue);
    const safeFallback = normalizedFallback.success
      ? normalizedFallback.data
      : fallbackValue;

    while (currentAttempt <= maxStructuredOutputRetries) {
      let raw: string;
      try {
        raw = await this.complete(
          currentMessages,
          JSON.stringify(safeFallback),
          options,
        );
      } catch (error) {
        if (!isStructuredOutputRecoverableError(error)) {
          throw error;
        }

        if (currentAttempt >= maxStructuredOutputRetries) {
          return safeFallback;
        }

        currentAttempt += 1;
        currentMessages = [
          ...messages,
          {
            role: "user",
            content:
              "Previous output was empty or unusable. Return valid JSON only and preserve the requested schema.",
          },
        ];
        continue;
      }

      try {
        const parsedJson = JSON.parse(extractJsonCandidate(raw)) as unknown;
        const validated = schema.safeParse(parsedJson);
        if (validated.success) {
          return validated.data;
        }

        if (currentAttempt >= maxStructuredOutputRetries) {
          return safeFallback;
        }

        currentAttempt += 1;
        currentMessages = [
          ...messages,
          {
            role: "user",
            content: `Previous JSON did not satisfy the contract. Fix these issues and return JSON only: ${formatSchemaIssues(
              validated.error,
            )}`,
          },
        ];
      } catch {
        if (currentAttempt >= maxStructuredOutputRetries) {
          return safeFallback;
        }

        currentAttempt += 1;
        currentMessages = [
          ...messages,
          {
            role: "user",
            content:
              "Previous output was not valid JSON. Return valid JSON only and preserve the requested schema.",
          },
        ];
      }
    }

    return safeFallback;
  }
}
