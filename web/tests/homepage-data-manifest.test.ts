import { describe, expect, it } from "vitest";
import { resolveHomepageGateStatus } from "~/server/application/homepage/homepage-data-manifest-service";

const readySettlement = {
  settlementStatus: "READY",
  qualityStatus: "NORMAL",
  actualDataCutoffKey: "2026-08-03",
};

describe("首页数据清单门控投影", () => {
  it("必需项未结算时为 PENDING", () => {
    expect(
      resolveHomepageGateStatus([
        {
          required: true,
          emptyPolicy: "REQUIRE_NON_EMPTY",
          targetDataCutoffKey: "2026-08-03",
          settlement: null,
        },
      ]),
    ).toBe("PENDING");
  });

  it("必需项失败、降级或截止点不足时为 BLOCKED", () => {
    expect(
      resolveHomepageGateStatus([
        {
          required: true,
          emptyPolicy: "REQUIRE_NON_EMPTY",
          targetDataCutoffKey: "2026-08-03",
          settlement: {
            settlementStatus: "FAILED",
            qualityStatus: "ISOLATED",
            actualDataCutoffKey: "2026-08-03",
          },
        },
      ]),
    ).toBe("BLOCKED");
    expect(
      resolveHomepageGateStatus([
        {
          required: true,
          emptyPolicy: "REQUIRE_NON_EMPTY",
          targetDataCutoffKey: "2026-08-03",
          settlement: {
            settlementStatus: "READY",
            qualityStatus: "NORMAL",
            actualDataCutoffKey: "2026-08-02",
          },
        },
      ]),
    ).toBe("BLOCKED");
  });

  it("必需项合法空且允许空结果时可 READY", () => {
    expect(
      resolveHomepageGateStatus([
        {
          required: true,
          emptyPolicy: "ALLOW_EMPTY",
          targetDataCutoffKey: "2026-08-03",
          settlement: {
            settlementStatus: "EMPTY",
            qualityStatus: "NORMAL",
            actualDataCutoffKey: "2026-08-03",
          },
        },
      ]),
    ).toBe("READY");
  });

  it("必需项达标但可选项受限时为 READY_WITH_LIMITATION", () => {
    expect(
      resolveHomepageGateStatus([
        {
          required: true,
          emptyPolicy: "REQUIRE_NON_EMPTY",
          targetDataCutoffKey: "2026-08-03",
          settlement: readySettlement,
        },
        {
          required: false,
          emptyPolicy: "REQUIRE_NON_EMPTY",
          targetDataCutoffKey: "2026-08-03",
          settlement: {
            settlementStatus: "FAILED",
            qualityStatus: "ISOLATED",
            actualDataCutoffKey: "2026-08-03",
          },
        },
      ]),
    ).toBe("READY_WITH_LIMITATION");
  });
});
