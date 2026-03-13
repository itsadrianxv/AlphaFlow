import { describe, expect, it, vi } from "vitest";
import { WorkflowDomainError } from "~/server/domain/workflow/errors";

async function loadClient() {
  process.env.SKIP_ENV_VALIDATION = "1";
  process.env.DATABASE_URL ??= "https://example.com/db";
  process.env.REDIS_URL ??= "redis://127.0.0.1:6379";
  process.env.PYTHON_INTELLIGENCE_SERVICE_URL ??= "http://127.0.0.1:8000";
  process.env.PYTHON_INTELLIGENCE_SERVICE_TIMEOUT_MS ??= "30000";

  const module = await import(
    "~/server/infrastructure/intelligence/python-intelligence-data-client"
  );

  return module.PythonIntelligenceDataClient;
}

describe("PythonIntelligenceDataClient", () => {
  it("unwraps v1 intelligence theme news payloads", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        data: {
          theme: "算力",
          newsItems: [
            {
              id: "news-1",
              title: "算力板块景气回升",
              summary: "测试摘要",
              source: "akshare",
              publishedAt: "2026-03-10T08:00:00+00:00",
              sentiment: "positive",
              relevanceScore: 0.82,
              relatedStocks: ["603019"],
            },
          ],
        },
      }),
    });

    vi.stubGlobal("fetch", fetchMock);

    const PythonIntelligenceDataClient = await loadClient();
    const client = new PythonIntelligenceDataClient({
      baseUrl: "http://127.0.0.1:8000",
      timeoutMs: 500,
    });

    const payload = await client.getThemeNews({ theme: "算力", limit: 5 });

    expect(payload).toHaveLength(1);
    expect(payload[0]?.id).toBe("news-1");
    expect(fetchMock).toHaveBeenCalledWith(
      "http://127.0.0.1:8000/api/v1/intelligence/themes/%E7%AE%97%E5%8A%9B/news?days=7&limit=5",
      expect.anything(),
    );
  });

  it("uses v1 market candidates endpoint", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        data: {
          theme: "算力",
          candidates: [
            {
              stockCode: "603019",
              stockName: "中科曙光",
              reason: "来自概念板块",
              heat: 83,
              concept: "算力租赁",
            },
          ],
        },
      }),
    });

    vi.stubGlobal("fetch", fetchMock);

    const PythonIntelligenceDataClient = await loadClient();
    const client = new PythonIntelligenceDataClient({
      baseUrl: "http://127.0.0.1:8000/api",
      timeoutMs: 500,
    });

    const payload = await client.getCandidates({ theme: "算力", limit: 6 });

    expect(payload).toHaveLength(1);
    expect(payload[0]?.stockCode).toBe("603019");
    expect(fetchMock).toHaveBeenCalledWith(
      "http://127.0.0.1:8000/api/v1/market/themes/%E7%AE%97%E5%8A%9B/candidates?limit=6",
      expect.anything(),
    );
  });

  it("uses standardized batch evidence endpoint", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        data: {
          items: [
            {
              stockCode: "603019",
              companyName: "中科曙光",
              concept: "算力",
              evidenceSummary: "测试证据",
              catalysts: [],
              risks: [],
              credibilityScore: 72,
              updatedAt: "2026-03-10T08:00:00+00:00",
            },
          ],
          errors: [],
        },
      }),
    });

    vi.stubGlobal("fetch", fetchMock);

    const PythonIntelligenceDataClient = await loadClient();
    const client = new PythonIntelligenceDataClient({
      baseUrl: "http://127.0.0.1:8000/api/v1",
      timeoutMs: 500,
    });

    const payload = await client.getEvidenceBatch({
      stockCodes: ["603019"],
      concept: "算力",
    });

    expect(payload).toHaveLength(1);
    expect(payload[0]?.stockCode).toBe("603019");
    expect(fetchMock).toHaveBeenCalledWith(
      "http://127.0.0.1:8000/api/v1/intelligence/stocks/evidence/batch",
      expect.objectContaining({
        method: "POST",
      }),
    );
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
              message: "上游 provider 不可用: timeout",
            },
          }),
      }),
    );

    const PythonIntelligenceDataClient = await loadClient();
    const client = new PythonIntelligenceDataClient({
      baseUrl: "http://127.0.0.1:8000",
      timeoutMs: 500,
    });

    await expect(client.getEvidence("603019", "算力")).rejects.toBeInstanceOf(
      WorkflowDomainError,
    );
    await expect(client.getEvidence("603019", "算力")).rejects.toThrow(
      "上游 provider 不可用: timeout",
    );
  });
});
