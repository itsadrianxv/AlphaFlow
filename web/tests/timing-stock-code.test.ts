import { afterEach, describe, expect, it, vi } from "vitest";
import { PythonTimingDataClient } from "~/server/infrastructure/timing/python-timing-data-client";
import { toTimingStockCode } from "~/server/infrastructure/timing/stock-code";

afterEach(() => vi.restoreAllMocks());

describe("Timing 股票代码格式", () => {
  it("为深市和沪市六位代码补 TuShare 交易所后缀", () => {
    expect(toTimingStockCode("300124")).toBe("300124.SZ");
    expect(toTimingStockCode("601138")).toBe("601138.SH");
  });

  it("保留已经带后缀的代码，并识别北交所代码", () => {
    expect(toTimingStockCode("601138.SH")).toBe("601138.SH");
    expect(toTimingStockCode("430047")).toBe("430047.BJ");
  });

  it("请求 bars 时发送带交易所后缀的代码", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(JSON.stringify({ data: {} }), { status: 200 }));
    const client = new PythonTimingDataClient({
      baseUrl: "http://timing.test/api/v1/timing",
      timeoutMs: 1000,
    });

    await client.getBars({ stockCode: "300124", timeframe: "DAILY" });

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/stocks/300124.SZ/bars"),
      expect.objectContaining({ headers: { "Content-Type": "application/json" } }),
    );
  });
});
