import type { AgentRuntimeConfig } from "./types";

export class WebInternalClient {
  private readonly baseUrl: string;
  private readonly apiSecret: string;
  private readonly timeoutMs: number;

  constructor(
    config: Pick<
      AgentRuntimeConfig,
      "webInternalUrl" | "internalApiSecret" | "toolTimeoutMs"
    >,
  ) {
    this.baseUrl = config.webInternalUrl.replace(/\/$/, "");
    this.apiSecret = config.internalApiSecret;
    this.timeoutMs = config.toolTimeoutMs;
  }

  async postToolOperation(
    body: {
      operation: string;
      runId: string;
      userId: string;
      params: Record<string, unknown>;
    },
    signal?: AbortSignal,
  ) {
    if (!this.apiSecret) {
      throw new Error("缺少 ALPHAFLOW_INTERNAL_API_SECRET");
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    const abort = () => controller.abort();

    signal?.addEventListener("abort", abort, { once: true });

    try {
      const response = await fetch(
        `${this.baseUrl}/api/internal/agent/research-tools`,
        {
          method: "POST",
          signal: controller.signal,
          headers: {
            "Content-Type": "application/json",
            "X-Alphaflow-Internal-Secret": this.apiSecret,
          },
          body: JSON.stringify(body),
        },
      );

      if (!response.ok) {
        const text = await response.text().catch(() => "");
        throw new Error(
          `Web internal request failed: ${response.status} ${response.statusText}${text ? ` - ${text}` : ""}`,
        );
      }

      return (await response.json()) as unknown;
    } finally {
      clearTimeout(timeout);
      signal?.removeEventListener("abort", abort);
    }
  }
}
