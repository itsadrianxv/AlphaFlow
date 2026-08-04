import { createHash } from "node:crypto";
import { env } from "~/env";
import type {
  ResearchAssessmentLlmAdapter,
  ResearchAssessmentLlmRequest,
  ResearchAssessmentLlmResponse,
} from "~/server/application/research-assessment/research-assessment-service";

type DeepSeekChatResponse = {
  choices?: Array<{ message?: { content?: string } }>;
  usage?: {
    prompt_tokens?: number;
    prompt_cache_hit_tokens?: number;
    completion_tokens?: number;
  };
  error?: { message?: string };
};

type CredentialState = {
  credentialId: string;
  apiKey: string;
  inFlight: number;
  pausedUntil?: number;
};

export class DeepSeekResearchAssessmentAdapter
  implements ResearchAssessmentLlmAdapter
{
  private readonly credentials: CredentialState[];
  private readonly baseUrl: string;
  private readonly timeoutMs: number;

  constructor(input?: {
    apiKeys?: string[];
    baseUrl?: string;
    timeoutMs?: number;
  }) {
    const apiKeys =
      input?.apiKeys ??
      (env.DEEPSEEK_API_KEYS
        ? env.DEEPSEEK_API_KEYS.split(",")
        : [env.DEEPSEEK_API_KEY ?? ""]);
    this.credentials = apiKeys
      .map((key) => key.trim())
      .filter(Boolean)
      .map((apiKey) => ({
        apiKey,
        credentialId: credentialIdFor(apiKey),
        inFlight: 0,
      }));
    this.baseUrl = input?.baseUrl ?? env.DEEPSEEK_BASE_URL;
    this.timeoutMs = Math.max(
      input?.timeoutMs ?? env.DEEPSEEK_TIMEOUT_MS,
      180_000,
    );
  }

  isConfigured() {
    return this.credentials.length > 0;
  }

  async complete(
    request: ResearchAssessmentLlmRequest,
  ): Promise<ResearchAssessmentLlmResponse> {
    const credential = this.selectCredential();
    if (!credential) {
      throw new Error("DeepSeek 四维评估凭据未配置");
    }
    credential.inFlight += 1;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await fetch(`${this.baseUrl}/chat/completions`, {
        method: "POST",
        signal: controller.signal,
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${credential.apiKey}`,
        },
        body: JSON.stringify({
          model: request.model,
          messages: request.repairOf
            ? [
                ...request.messages,
                {
                  role: "user",
                  content: `上一次输出未通过契约：${request.repairOf.validationErrors.join(
                    "；",
                  )}。请只返回修复后的 JSON。`,
                },
              ]
            : request.messages,
          temperature: request.temperature,
          max_tokens: request.maxOutputTokens,
          response_format: { type: "json_object" },
        }),
      });
      const text = await response.text();
      if (!response.ok) {
        if (response.status === 429) {
          credential.pausedUntil = Date.now() + 30_000;
        }
        throw new Error(`DeepSeek 四维评估失败：${response.status} ${text}`);
      }
      const parsed = JSON.parse(text) as DeepSeekChatResponse;
      const rawOutput = parsed.choices?.[0]?.message?.content?.trim();
      if (!rawOutput) {
        throw new Error(parsed.error?.message ?? "DeepSeek 四维评估返回空内容");
      }
      return {
        rawOutput,
        usage: {
          credentialId: credential.credentialId,
          inputTokens: parsed.usage?.prompt_tokens,
          cachedInputTokens: parsed.usage?.prompt_cache_hit_tokens,
          outputTokens: parsed.usage?.completion_tokens,
        },
      };
    } finally {
      clearTimeout(timer);
      credential.inFlight -= 1;
    }
  }

  private selectCredential() {
    const now = Date.now();
    return this.credentials
      .filter((credential) => (credential.pausedUntil ?? 0) <= now)
      .sort((left, right) => left.inFlight - right.inFlight)[0];
  }
}

function credentialIdFor(apiKey: string) {
  return `deepseek:${createHash("sha256")
    .update(apiKey, "utf8")
    .digest("hex")
    .slice(0, 12)}`;
}
