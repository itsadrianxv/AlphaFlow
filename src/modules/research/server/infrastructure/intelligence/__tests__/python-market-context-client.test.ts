import { describe, expect, it, vi } from "vitest";
import { WorkflowDomainError } from "~/modules/research/server/domain/workflow/errors";

async function loadClient() {
  process.env.SKIP_ENV_VALIDATION = "1";
  process.env.DATABASE_URL ??= "https://example.com/db";
  process.env.REDIS_URL ??= "redis://127.0.0.1:6379";
  process.env.PYTHON_INTELLIGENCE_SERVICE_URL ??= "http://127.0.0.1:8000";
  process.env.PYTHON_INTELLIGENCE_SERVICE_TIMEOUT_MS ??= "300000";

  const module = await import(
    "~/modules/research/server/infrastructure/intelligence/python-market-context-client"
  );

  return module.PythonMarketContextClient;
}

describe("PythonMarketContextClient", () => {
  it("calls the market context snapshot endpoint and parses the payload", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        data: {
          asOf: "2026-04-18T00:00:00+00:00",
          status: "complete",
          regime: {
            overallTone: "risk_on",
            growthTone: "expansion",
            liquidityTone: "supportive",
            riskTone: "risk_on",
            summary: "景气修复",
            drivers: ["PMI > 50"],
          },
          flow: {
            northboundNetAmount: 1762.62,
            direction: "inflow",
            summary: "北向净流入",
          },
          hotThemes: [
            {
              theme: "AI",
              heatScore: 84,
              whyHot: "催化集中",
              conceptMatches: [],
              candidateStocks: [
                {
                  stockCode: "603019",
                  stockName: "中科曙光",
                  concept: "AI",
                  reason: "热点候选",
                  heat: 81,
                },
              ],
              topNews: [],
            },
          ],
          downstreamHints: {
            workflows: {
              summary: "优先研究高景气主题。",
              suggestedQuestion: "围绕 AI 产业链，当前景气扩散到哪些环节？",
            },
            companyResearch: {
              summary: "优先确认主题兑现路径。",
            },
            screening: {
              summary: "优先从热门主题候选股开始缩小范围。",
              suggestedDraftName: "AI 热门主题候选池",
            },
            timing: {
              summary: "风险偏好偏强。",
            },
          },
          availability: {
            regime: { available: true },
            flow: { available: true },
            hotThemes: { available: true },
          },
        },
      }),
    });

    vi.stubGlobal("fetch", fetchMock);

    const PythonMarketContextClient = await loadClient();
    const client = new PythonMarketContextClient({
      baseUrl: "http://127.0.0.1:8000/api/v1",
      timeoutMs: 500,
    });

    const payload = await client.getSnapshot();

    expect(payload.status).toBe("complete");
    expect(payload.hotThemes[0]?.theme).toBe("AI");
    expect(fetchMock).toHaveBeenCalledWith(
      "http://127.0.0.1:8000/api/v1/market-context/snapshot",
      expect.anything(),
    );
  });

  it("accepts nullable downstream hints and availability warnings from python", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          data: {
            asOf: "2026-04-18T00:00:00+00:00",
            status: "partial",
            regime: {
              overallTone: "unknown",
              growthTone: "unknown",
              liquidityTone: "unknown",
              riskTone: "unknown",
              summary: "macro unavailable",
              drivers: [],
            },
            flow: {
              northboundNetAmount: null,
              direction: "flat",
              summary: "flow unavailable",
            },
            hotThemes: [],
            downstreamHints: {
              workflows: {
                summary: "workflow summary",
                suggestedQuestion: null,
                suggestedDraftName: null,
              },
              companyResearch: {
                summary: "company summary",
                suggestedQuestion: null,
                suggestedDraftName: null,
              },
              screening: {
                summary: "screening summary",
                suggestedQuestion: null,
                suggestedDraftName: null,
              },
              timing: {
                summary: "timing summary",
                suggestedQuestion: null,
                suggestedDraftName: null,
              },
            },
            availability: {
              regime: { available: false, warning: null },
              flow: { available: false, warning: null },
              hotThemes: { available: false, warning: null },
            },
          },
        }),
      }),
    );

    const PythonMarketContextClient = await loadClient();
    const client = new PythonMarketContextClient({
      baseUrl: "http://127.0.0.1:8000/api/v1",
      timeoutMs: 500,
    });

    await expect(client.getSnapshot()).resolves.toMatchObject({
      status: "partial",
      downstreamHints: {
        workflows: {
          suggestedQuestion: null,
          suggestedDraftName: null,
        },
      },
      availability: {
        regime: {
          warning: null,
        },
      },
    });
  });

  it("throws workflow domain error with parsed gateway message", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 503,
        text: async () =>
          JSON.stringify({
            error: {
              code: "provider_unavailable",
              message: "market context unavailable",
            },
          }),
      }),
    );

    const PythonMarketContextClient = await loadClient();
    const client = new PythonMarketContextClient({
      baseUrl: "http://127.0.0.1:8000",
      timeoutMs: 500,
    });

    await expect(client.getSnapshot()).rejects.toBeInstanceOf(
      WorkflowDomainError,
    );
    await expect(client.getSnapshot()).rejects.toThrow(
      "market context unavailable",
    );
  });
});
