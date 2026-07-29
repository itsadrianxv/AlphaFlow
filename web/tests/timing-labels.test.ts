import { describe, expect, it } from "vitest";
import {
  formatTimingEngineLabel,
  formatTimingNarrative,
} from "~/app/timing/timing-labels";

describe("模型预测界面文案", () => {
  it("将预测引擎显示为模型预测", () => {
    expect(formatTimingEngineLabel("kronosForecast")).toBe("模型预测");
  });

  it("隐藏叙事中的 Kronos 名称", () => {
    const narratives = [
      "Kronos 预测暂不可用，辅助权重按 0 处理。",
      "Kronos forecast unavailable; auxiliary weight treated as 0.",
      "Kronos forecast: expected return is positive.",
      "Kronos forecast is bullish.",
    ];

    for (const narrative of narratives) {
      const formatted = formatTimingNarrative(narrative);
      expect(formatted).not.toContain("Kronos");
      expect(formatted).toContain("模型");
    }
  });
});
