import { env } from "~/env";
import {
  WORKFLOW_ERROR_CODES,
  WorkflowDomainError,
} from "~/server/domain/workflow/errors";

export type DeepSeekClientConfig = {
  apiKey?: string;
  baseUrl?: string;
  model?: string;
  timeoutMs?: number;
};

type DeepSeekMessage = {
  role: "system" | "user";
  content: string;
};

type DeepSeekResponse = {
  choices?: Array<{
    message?: {
      content?: string;
    };
  }>;
};

export class DeepSeekClient {
  private readonly apiKey?: string;
  private readonly baseUrl: string;
  private readonly model: string;
  private readonly timeoutMs: number;

  constructor(config?: DeepSeekClientConfig) {
    this.apiKey = config?.apiKey ?? env.DEEPSEEK_API_KEY;
    this.baseUrl = config?.baseUrl ?? env.DEEPSEEK_BASE_URL;
    this.model = config?.model ?? "deepseek-chat";
    this.timeoutMs = config?.timeoutMs ?? 15_000;
  }

  async complete(messages: DeepSeekMessage[], fallbackText: string) {
    if (!this.apiKey) {
      return fallbackText;
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await fetch(`${this.baseUrl}/chat/completions`, {
        method: "POST",
        signal: controller.signal,
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          model: this.model,
          messages,
          temperature: 0.2,
        }),
      });

      if (!response.ok) {
        throw new WorkflowDomainError(
          WORKFLOW_ERROR_CODES.INTELLIGENCE_DATA_UNAVAILABLE,
          `DeepSeek 请求失败: ${response.status} ${response.statusText}`,
        );
      }

      const data = (await response.json()) as DeepSeekResponse;
      const content = data.choices?.[0]?.message?.content?.trim();

      if (!content) {
        throw new WorkflowDomainError(
          WORKFLOW_ERROR_CODES.INTELLIGENCE_LLM_PARSE_FAILED,
          "DeepSeek 返回空内容",
        );
      }

      return content;
    } catch (error) {
      if (error instanceof WorkflowDomainError) {
        throw error;
      }

      if ((error as Error).name === "AbortError") {
        throw new WorkflowDomainError(
          WORKFLOW_ERROR_CODES.INTELLIGENCE_DATA_UNAVAILABLE,
          `DeepSeek 请求超时 (${this.timeoutMs}ms)`,
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
}
