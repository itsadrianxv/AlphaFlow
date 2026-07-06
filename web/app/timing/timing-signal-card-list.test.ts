import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { TimingSignalCardList } from "~/app/timing/timing-signal-card-list";

describe("TimingSignalCardList", () => {
  it("renders a report link for each signal card", () => {
    const markup = renderToStaticMarkup(
      React.createElement(TimingSignalCardList, {
        cards: [
          {
            id: "ck12345678901234567890123",
            stockCode: "600519",
            stockName: "贵州茅台",
            actionBias: "ADD",
            sourceType: "single",
            summary: "Constructive structure.",
            confidence: 83,
            createdAt: new Date("2026-03-06T10:00:00.000Z"),
            signalSnapshot: {
              asOfDate: "2026-03-06",
              indicators: {
                rsi: { value: 64 },
                macd: { histogram: 8 },
                volumeRatio20: 1.64,
              },
            },
          },
        ],
      }),
    );

    expect(markup).toContain("/timing/reports/ck12345678901234567890123");
    expect(markup).toContain("查看报告");
  });
});
