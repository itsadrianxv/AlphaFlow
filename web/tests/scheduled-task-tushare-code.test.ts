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

describe("TuShare 交易日历日期格式", () => {
  it("调用 trade_cal 前把日期转换为 YYYYMMDD", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          rows: [
            {
              exchange: "SSE",
              cal_date: "20260804",
              is_open: 1,
            },
          ],
        }),
        { status: 200 },
      ),
    );
    try {
      const service = new ScheduledTaskSetupService({} as never);
      await service.nextRunAt(
        {
          type: "TRADING_DAY",
          time: "18:00",
          timezone: "Asia/Shanghai",
          marketCalendar: "SSE",
        },
        new Date("2026-08-04T09:00:00.000Z"),
      );

      const request = fetchMock.mock.calls[0]?.[1];
      expect(JSON.parse(String(request?.body))).toMatchObject({
        dataset: "trade_cal",
        params: {
          exchange: "SSE",
          start_date: "20260804",
          end_date: "20260804",
        },
      });
    } finally {
      fetchMock.mockRestore();
    }
  });
});
