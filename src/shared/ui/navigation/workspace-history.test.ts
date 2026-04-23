import { describe, expect, it } from "vitest";
import {
  TIMING_SIGNAL_PIPELINE_TEMPLATE_CODE,
  WATCHLIST_TIMING_PIPELINE_TEMPLATE_CODE,
} from "~/modules/research/server/domain/workflow/types";
import {
  buildTimingReportHistoryItems,
  buildWorkflowRunHistoryItems,
} from "~/shared/ui/navigation/workspace-history";

describe("workspace history", () => {
  it("builds timing report history items that point to report pages", () => {
    expect(
      buildTimingReportHistoryItems([
        {
          id: "ck12345678901234567890123",
          stockCode: "600519",
          stockName: "贵州茅台",
        },
      ]),
    ).toEqual([
      {
        id: "ck12345678901234567890123",
        title: "择时信号卡 - 600519",
        href: "/timing/reports/ck12345678901234567890123",
      },
    ]);
  });

  it("routes timing workflow history items to the timing module instead of old workflow detail pages", () => {
    expect(
      buildWorkflowRunHistoryItems([
        {
          id: "run_timing_1",
          query: "择时信号卡 - 600519",
          templateCode: TIMING_SIGNAL_PIPELINE_TEMPLATE_CODE,
        },
        {
          id: "run_watchlist_timing_1",
          query: "自选股组合建议 - 测试列表",
          templateCode: WATCHLIST_TIMING_PIPELINE_TEMPLATE_CODE,
        },
      ]),
    ).toEqual([
      {
        id: "run_timing_1",
        title: "择时信号卡 - 600519",
        href: "/timing",
      },
      {
        id: "run_watchlist_timing_1",
        title: "自选股组合建议 - 测试列表",
        href: "/timing",
      },
    ]);
  });
});
