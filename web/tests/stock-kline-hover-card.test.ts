import { describe, expect, it } from "vitest";
import { buildStockKlinePreviewOption } from "~/app/_components/stock-kline-hover-card";

describe("股票 K 线悬浮图", () => {
  it("使用最近 20 根 K 线的真实低点，不固定为零", () => {
    const option = buildStockKlinePreviewOption(
      [
        {
          tradeDate: "2026-07-03",
          open: 10,
          high: 12,
          low: 8,
          close: 11,
        },
      ],
      "dark",
    );

    const lowPoint = (
      option.series as Array<{ name: string; data: number[] }>
    ).find((series) => series.name === "20日低点");

    expect(lowPoint?.data).toEqual([8]);
  });
});
