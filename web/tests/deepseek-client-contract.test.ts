import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { DeepSeekClient } from "~/server/infrastructure/intelligence/deepseek-client";

describe("DeepSeek 结构化输出契约", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("普通文本补全不请求 JSON mode", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({ choices: [{ message: { content: "普通文本" } }] }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);
    const client = new DeepSeekClient({
      apiKey: "test-key",
      baseUrl: "https://deepseek.invalid",
    });

    await client.complete([{ role: "user", content: "返回普通文本" }], "fallback");

    const request = JSON.parse(
      String((fetchMock.mock.calls[0]?.[1] as RequestInit | undefined)?.body),
    ) as { response_format?: { type?: string } };
    expect(request.response_format).toBeUndefined();
  });

  it("message.content 为空时使用 reasoning_content 作为正文", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: "",
                reasoning_content: "推理字段中的可展示正文",
              },
            },
          ],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);
    const client = new DeepSeekClient({
      apiKey: "test-key",
      baseUrl: "https://deepseek.invalid",
    });

    await expect(
      client.complete([{ role: "user", content: "返回正文" }], "fallback"),
    ).resolves.toBe("推理字段中的可展示正文");
  });

  it("从带尾注的响应提取完整 JSON 对象并请求 JSON mode", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content:
                  '{"contractVersion":"test.v1","result":{"text":"包含 { 括号 }"}}\n以上为裁定结果。',
              },
            },
          ],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);
    const schema = z
      .object({
        contractVersion: z.literal("test.v1"),
        result: z.object({ text: z.string() }).strict(),
      })
      .strict();
    const client = new DeepSeekClient({
      apiKey: "test-key",
      baseUrl: "https://deepseek.invalid",
    });

    const result = await client.completeContract(
      [{ role: "user", content: "返回测试契约" }],
      { contractVersion: "test.v1", result: { text: "fallback" } },
      schema,
    );

    expect(result.result.text).toBe("包含 { 括号 }");
    const request = JSON.parse(
      String((fetchMock.mock.calls[0]?.[1] as RequestInit | undefined)?.body),
    ) as { response_format?: { type?: string } };
    expect(request.response_format).toEqual({ type: "json_object" });
  });
});
