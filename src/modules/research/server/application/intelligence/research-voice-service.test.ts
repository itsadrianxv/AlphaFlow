import { describe, expect, it, vi } from "vitest";

function createVoiceContext(
  pageKind: "quick_research" | "company_research" = "quick_research",
) {
  return {
    pageKind,
    currentFields:
      pageKind === "quick_research"
        ? {
            query: "",
            researchGoal: "",
            mustAnswerQuestions: [],
            preferredSources: [],
            freshnessWindowDays: 180,
          }
        : {
            companyName: "",
            stockCode: "",
            keyQuestion: "",
            focusConcepts: [],
            researchGoal: "",
            mustAnswerQuestions: [],
            preferredSources: [],
            freshnessWindowDays: 180,
          },
    starterExamples: ["示例问题一", "示例问题二"],
  };
}

async function loadService() {
  process.env.SKIP_ENV_VALIDATION = "1";
  process.env.DATABASE_URL ??= "https://example.com/db";
  process.env.REDIS_URL ??= "redis://127.0.0.1:6379";
  process.env.PYTHON_INTELLIGENCE_SERVICE_URL ??= "http://127.0.0.1:8000";
  process.env.PYTHON_INTELLIGENCE_SERVICE_TIMEOUT_MS ??= "300000";
  process.env.DEEPSEEK_BASE_URL ??= "https://api.deepseek.com";

  const module = await import(
    "~/modules/research/server/application/intelligence/research-voice-service"
  );

  return module.ResearchVoiceService;
}

function createService(overrides?: {
  transcribe?: ReturnType<typeof vi.fn>;
  isConfigured?: boolean;
  completeContract?: ReturnType<typeof vi.fn>;
  search?: ReturnType<typeof vi.fn>;
}) {
  const transcribe =
    overrides?.transcribe ??
    vi.fn(async () => ({
      transcript: "请分析贵州茅台最近一个月利润变化",
      durationMs: 12_000,
      overallConfidence: 0.91,
      segments: [
        {
          startMs: 0,
          endMs: 12_000,
          text: "请分析贵州茅台最近一个月利润变化",
          confidence: 0.91,
        },
      ],
    }));
  const completeContract =
    overrides?.completeContract ??
    vi
      .fn()
      .mockResolvedValueOnce({
        normalizedPrimaryText: "请分析贵州茅台最近一个月利润变化",
      })
      .mockResolvedValueOnce({
        researchGoal: {
          value: "确认利润变化是否可持续",
          confidence: 0.9,
        },
      });
  const search = overrides?.search ?? vi.fn(async () => []);

  return loadService().then((ResearchVoiceService) => ({
    service: new ResearchVoiceService({
      pythonVoiceTranscriptionClient: {
        transcribe,
      },
      deepSeekClient: {
        isConfigured: () => overrides?.isConfigured ?? true,
        completeContract,
      },
      localStockSearchService: {
        search,
      },
    } as never),
    transcribe,
    completeContract,
    search,
  }));
}

describe("ResearchVoiceService", () => {
  it("degrades low-confidence intake to the primary field only", async () => {
    const { service } = await createService({
      transcribe: vi.fn(async () => ({
        transcript: "分析半导体设备国产替代的关键兑现节点",
        durationMs: 8_000,
        overallConfidence: 0.74,
        segments: [],
      })),
      completeContract: vi
        .fn()
        .mockResolvedValueOnce({
          normalizedPrimaryText: "分析半导体设备国产替代的关键兑现节点",
        })
        .mockResolvedValueOnce({
          researchGoal: {
            value: "验证产业链利润兑现顺序",
            confidence: 0.99,
          },
        }),
    });

    await expect(
      service.processResearchVoice({
        audioBytes: new Uint8Array([1, 2, 3]),
        fileName: "voice.webm",
        mimeType: "audio/webm",
        context: createVoiceContext("quick_research"),
      }),
    ).resolves.toMatchObject({
      normalizedPrimaryText: "分析半导体设备国产替代的关键兑现节点",
      appliedPatch: {
        query: "分析半导体设备国产替代的关键兑现节点",
      },
      confidenceLevel: "low",
      degradedToPrimaryOnly: true,
      appliedFieldKeys: ["query"],
    });
  });

  it("falls back to a compacted transcript when DeepSeek is unavailable", async () => {
    const completeContract = vi.fn();
    const { service } = await createService({
      isConfigured: false,
      completeContract,
      transcribe: vi.fn(async () => ({
        transcript: "  请  分析   创新药 出海 的 核心 兑现 指标  ",
        durationMs: 6_000,
        overallConfidence: 0.88,
        segments: [],
      })),
    });

    await expect(
      service.processResearchVoice({
        audioBytes: new Uint8Array([1, 2, 3]),
        fileName: "voice.webm",
        mimeType: "audio/webm",
        context: createVoiceContext("quick_research"),
      }),
    ).resolves.toMatchObject({
      normalizedPrimaryText: "请 分析 创新药 出海 的 核心 兑现 指标",
      appliedPatch: {
        query: "请 分析 创新药 出海 的 核心 兑现 指标",
      },
      degradedToPrimaryOnly: true,
      appliedFieldKeys: ["query"],
    });
    expect(completeContract).not.toHaveBeenCalled();
  });

  it("autofills company fields only when the company name matches a unique exact local stock result", async () => {
    const { service, search } = await createService({
      search: vi.fn(async () => [
        {
          stockCode: "600519",
          stockName: "贵州茅台",
          market: "SH",
          matchField: "NAME",
        },
      ]),
      completeContract: vi
        .fn()
        .mockResolvedValueOnce({
          normalizedPrimaryText: "贵州茅台最近一个月利润变化是否可持续",
        })
        .mockResolvedValueOnce({
          companyName: {
            value: "贵州茅台",
            confidence: 0.97,
          },
          stockCode: {
            value: "600519",
            confidence: 0.98,
          },
          researchGoal: {
            value: "确认利润改善的持续性",
            confidence: 0.91,
          },
        }),
    });

    await expect(
      service.processResearchVoice({
        audioBytes: new Uint8Array([1, 2, 3]),
        fileName: "voice.webm",
        mimeType: "audio/webm",
        context: createVoiceContext("company_research"),
      }),
    ).resolves.toMatchObject({
      appliedPatch: {
        keyQuestion: "贵州茅台最近一个月利润变化是否可持续",
        companyName: "贵州茅台",
        stockCode: "600519",
        researchGoal: "确认利润改善的持续性",
      },
    });
    expect(search).toHaveBeenCalledWith("贵州茅台", 5);
  });

  it("does not autofill ambiguous company matches", async () => {
    const { service } = await createService({
      search: vi.fn(async () => [
        {
          stockCode: "600000",
          stockName: "浦发银行",
          market: "SH",
          matchField: "NAME",
        },
        {
          stockCode: "000001",
          stockName: "平安银行",
          market: "SZ",
          matchField: "NAME",
        },
      ]),
      completeContract: vi
        .fn()
        .mockResolvedValueOnce({
          normalizedPrimaryText: "银行利润修复还能持续多久",
        })
        .mockResolvedValueOnce({
          companyName: {
            value: "银行",
            confidence: 0.96,
          },
          researchGoal: {
            value: "判断利润修复持续性",
            confidence: 0.9,
          },
        }),
    });

    await expect(
      service.processResearchVoice({
        audioBytes: new Uint8Array([1, 2, 3]),
        fileName: "voice.webm",
        mimeType: "audio/webm",
        context: createVoiceContext("company_research"),
      }),
    ).resolves.toMatchObject({
      appliedPatch: {
        keyQuestion: "银行利润修复还能持续多久",
        researchGoal: "判断利润修复持续性",
      },
      appliedFieldKeys: ["keyQuestion", "researchGoal"],
    });
  });
});
