import { describe, expect, it, vi } from "vitest";
import {
  fingerprintHomePageSelection,
  resolveHomePageSelection,
} from "~/server/application/homepage/home-page-selection";

describe("首页偏好选择", () => {
  it("规范化对象键顺序后生成稳定指纹", () => {
    expect(fingerprintHomePageSelection({ b: 2, a: { d: 4, c: 3 } })).toBe(
      fingerprintHomePageSelection({ a: { c: 3, d: 4 }, b: 2 }),
    );
  });

  it("冻结最近更新的自选股、公司和行业", async () => {
    const updatedAt = new Date("2026-08-01T08:00:00.000Z");
    const db = {
      watchList: {
        findFirst: vi.fn(async () => ({
          id: "watch-1",
          name: "核心自选",
          stocks: [{ stockCode: "600000", stockName: "浦发银行" }],
          updatedAt,
        })),
      },
      savedCompany: {
        findFirst: vi.fn(async () => ({
          id: "company-1",
          stockCode: "000001",
          companyName: "平安银行",
          updatedAt,
        })),
      },
      savedIndustry: {
        findFirst: vi.fn(async () => ({
          id: "industry-1",
          name: "银行",
          source: "申万",
          updatedAt,
        })),
      },
    };

    const result = await resolveHomePageSelection(db as never, "user-1");

    expect(result.personalized).toBe(true);
    expect(result.selection).toMatchObject({
      watchList: { id: "watch-1" },
      company: { id: "company-1" },
      industry: { id: "industry-1" },
    });
    expect(result.selection).not.toHaveProperty("watchList.updatedAt");
    expect(db.watchList.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ orderBy: { updatedAt: "desc" } }),
    );
  });
});
