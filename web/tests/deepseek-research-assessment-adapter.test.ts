import { afterEach, describe, expect, it, vi } from "vitest";
import { DeepSeekResearchAssessmentAdapter } from "~/server/infrastructure/research-assessment/deepseek-research-assessment-adapter";

describe("DeepSeek 四维评估适配器", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("为推理模型请求 JSON mode 并保留足够输出时间", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [{ message: { content: '{"contractVersion":"test"}' } }],
        }),
        { status: 200 },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);
    const adapter = new DeepSeekResearchAssessmentAdapter({
      apiKeys: ["test-key"],
      baseUrl: "https://deepseek.invalid",
      timeoutMs: 10,
    });

    await adapter.complete({
      kind: "GLOBAL",
      model: "deepseek-v4-flash",
      temperature: 0,
      maxInputTokens: 32_000,
      maxOutputTokens: 16_384,
      messages: [{ role: "user", content: "返回评估" }],
    });

    const request = JSON.parse(
      String((fetchMock.mock.calls[0]?.[1] as RequestInit | undefined)?.body),
    ) as { response_format?: { type?: string }; max_tokens?: number };
    expect(request.response_format).toEqual({ type: "json_object" });
    expect(request.max_tokens).toBe(16_384);
  });
});
