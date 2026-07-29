import { describe, expect, it, vi } from "vitest";
import { ScheduledTaskSetupService } from "~/server/application/scheduled-task/scheduled-task-setup-service";
import { validateTuShareStockCode } from "~/server/domain/scheduled-task/contracts";

const capability = {
  id: "tushare.fina_mainbz",
  provider: "tushare",
  executionTool: "internal_tushare_dataset",
  dataset: "fina_mainbz",
  available: true,
  allowedParameters: ["ts_code", "period", "start_date", "end_date"],
  maxRows: 500,
  maxLookbackDays: 365,
};

describe("TuShare 股票代码防护", () => {
  it("只接受带交易所后缀的代码", () => {
    expect(validateTuShareStockCode("601138")).toContain("完整 TuShare");
    expect(validateTuShareStockCode("601138.SH")).toBeNull();
    expect(validateTuShareStockCode("000001.SZ")).toBeNull();
    expect(validateTuShareStockCode("920001.BJ")).toBeNull();
  });

  it("草稿验证阶段阻止裸代码", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify(capability), { status: 200 }),
    );
    try {
      const service = new ScheduledTaskSetupService({} as never);
      const result = await service.validateDraft({
        name: "代码校验测试",
        userPrompt: "查询工业富联主营业务",
        schedule: { type: "DAILY", time: "12:12", timezone: "Asia/Shanghai" },
        dataSources: [{ provider: "tushare", capability: "tushare.fina_mainbz", parameters: { ts_code: "601138", period: "20251231" } }],
        output: { format: "MARKDOWN", includeEvidence: true },
        delivery: { type: "SAVE_ONLY" },
      });
      expect(result.feasibility.blockingIssues).toContain(
        "tushare.fina_mainbz 的 ts_code 必须是完整 TuShare 代码，例如 601138.SH、000001.SZ 或 920001.BJ",
      );
      expect(fetchMock).toHaveBeenCalled();
    } finally {
      fetchMock.mockRestore();
    }
  });
});
