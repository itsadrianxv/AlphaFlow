import type { AgentRuntimeConfig } from "./types";

export class PythonGatewayClient {
  private readonly baseUrl: string;
  private readonly timeoutMs: number;

  constructor(config: Pick<AgentRuntimeConfig, "pythonServiceUrl" | "pythonServiceTimeoutMs">) {
    this.baseUrl = config.pythonServiceUrl.replace(/\/$/, "");
    this.timeoutMs = config.pythonServiceTimeoutMs;
  }

  async postJson(
    path: string,
    body: Record<string, unknown>,
    signal?: AbortSignal,
  ) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    const abort = () => controller.abort();

    signal?.addEventListener("abort", abort, { once: true });

    try {
      const response = await fetch(`${this.baseUrl}${path}`, {
        method: "POST",
        signal: controller.signal,
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        const text = await response.text().catch(() => "");
        throw new Error(
          `Python gateway request failed: ${response.status} ${response.statusText}${text ? ` - ${text}` : ""}`,
        );
      }

      return (await response.json()) as unknown;
    } finally {
      clearTimeout(timeout);
      signal?.removeEventListener("abort", abort);
    }
  }
}
