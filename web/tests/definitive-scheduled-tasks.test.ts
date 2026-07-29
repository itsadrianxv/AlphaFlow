import ExcelJS from "exceljs";
import { describe, expect, it, vi } from "vitest";
import { publishDefinitiveTaskRun } from "~/server/application/scheduled-task/definitive-task-run-stream";
import { buildScoringWorkbook } from "~/server/application/scheduled-task/scoring-excel-service";
import { deterministicExecutionPlanSchema } from "~/server/domain/scheduled-task/contracts";

const plan = {
  schemaVersion: 1,
  type: "deterministic_scoring",
  universe: { type: "stocks", stockCodes: ["600519"] },
  data: { adjustment: "qfq" },
  indicators: [
    {
      id: "macd_default",
      type: "macd",
      timeframes: ["daily"],
      params: { fast: 12, slow: 26, signal: 9 },
    },
  ],
  rules: [
    {
      id: "macd_positive",
      name: "MACD 柱为正",
      condition: {
        timeframe: "daily",
        metric: "macd_default.histogram",
        operator: "gt",
        value: 0,
      },
      points: 15,
    },
  ],
  selection: { minScore: 10, limit: 20 },
};

describe("确定性定时评分任务", () => {
  it("校验并填充执行计划默认值", () => {
    const parsed = deterministicExecutionPlanSchema.parse(plan);
    expect(parsed.type).toBe("deterministic_scoring");
    expect(parsed.indicators[0]?.type).toBe("macd");
    expect(
      deterministicExecutionPlanSchema.safeParse({
        ...plan,
        universe: { type: "stocks", stockCodes: ["600519.SH"] },
      }).success,
    ).toBe(false);
  });

  it("Redis 消息只包含执行标识", async () => {
    const xadd = vi.fn().mockResolvedValue("1-0");
    await publishDefinitiveTaskRun("execution-1", { xadd } as never);
    const args = xadd.mock.calls[0] as unknown[];
    expect(args).toEqual([
      "definitive-task:runs",
      "*",
      "schemaVersion",
      "1",
      "executionId",
      "execution-1",
      "enqueuedAt",
      expect.any(String),
    ]);
  });

  it("生成三张工作表并防止公式注入", async () => {
    const buffer = await buildScoringWorkbook({
      taskName: "评分任务",
      executionId: "execution-1",
      scheduledAt: new Date("2026-07-29T10:00:00Z"),
      summary: { type: "SCORING_REPORT", asOfDate: "2026-07-29" },
      rules: [
        { id: "macd_positive", name: "MACD 柱为正", points: 15 },
      ],
      rows: [
        {
          stockCode: "600519",
          stockName: "=HYPERLINK(\"bad\")",
          rank: 1,
          selected: true,
          evaluationStatus: "FULL",
          score: 15,
          maxScore: 15,
          ruleResults: {
            macd_positive: {
              status: "MATCHED",
              awardedPoints: 15,
              observations: {
                "daily.macd_default.histogram": { current: 0.42 },
              },
            },
          },
        },
      ],
    });
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer);
    expect(workbook.worksheets.map((sheet) => sheet.name)).toEqual([
      "评分总览",
      "规则说明",
      "执行信息",
    ]);
    expect(workbook.getWorksheet("评分总览")?.getCell("D2").value).toBe(
      "'=HYPERLINK(\"bad\")",
    );
  });
});
