import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  createScreeningRunInputSchema,
  screeningUniverseSchema,
} from "~/contracts/screening";
import { publishScreeningRun } from "~/server/application/screening/screening-run-stream";

describe("筛选运行协议", () => {
  it("支持三种结构化股票池并限制最多三十个指标", () => {
    expect(screeningUniverseSchema.parse({ type: "ALL_A_SHARES" })).toEqual({
      type: "ALL_A_SHARES",
    });
    expect(
      screeningUniverseSchema.parse({
        type: "INDUSTRY",
        industryNames: ["银行"],
      }),
    ).toBeTruthy();
    expect(
      createScreeningRunInputSchema.safeParse({
        workspaceId: "workspace-1",
        universe: { type: "STOCKS", stockCodes: ["600519"] },
        indicatorIds: Array.from({ length: 31 }, (_, index) => `income.x${index}`),
        formulaIds: [],
        timeConfig: {
          periodType: "ANNUAL",
          rangeMode: "PRESET",
          presetKey: "3Y",
        },
        filterRules: [],
      }).success,
    ).toBe(false);
  });

  it("发布稳定的 Redis Stream 字段且不设置 MAXLEN", async () => {
    const xadd = vi.fn().mockResolvedValue("1-0");
    await publishScreeningRun("run-1", { xadd } as never);
    const args = xadd.mock.calls[0] as unknown[];
    expect(args[0]).toBe("screening:runs");
    expect(args[1]).toBe("*");
    expect(args).toContain("schemaVersion");
    expect(args).toContain("eventId");
    expect(args).toContain("runId");
    expect(args).toContain("createdAt");
    expect(args).not.toContain("MAXLEN");
  });

  it("migration 包含 lease、fencing 和结果唯一约束", () => {
    const sql = readFileSync(
      resolve(
        process.cwd(),
        "prisma/migrations/20260728_financial_metrics_screening_runs/migration.sql",
      ),
      "utf8",
    );
    expect(sql).toContain('"fencingToken" BIGINT NOT NULL DEFAULT 0');
    expect(sql).toContain('"leaseExpiresAt" TIMESTAMP(3)');
    expect(sql).toContain('"ScreeningRunResult_runId_stockCode_key"');
    expect(sql).toContain('"ScreeningRunResult_runId_rank_key"');
  });
});
