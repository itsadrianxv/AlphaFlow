import { describe, expect, it } from "vitest";
import {
  HOMEPAGE_BASELINE_PHASES,
  buildHomepageBaselineManifestItems,
} from "~/server/application/homepage/homepage-baseline-bootstrap";

describe("首页专业市场基线清单项构造", () => {
  it.each(HOMEPAGE_BASELINE_PHASES)(
    "%s 阶段新闻域使用带时区的 published_at 截止点，其他域仍使用 trade_date",
    (phase) => {
      const items = buildHomepageBaselineManifestItems(phase, "2026-08-01");

      const newsItem = items.find((item) => item.datasetKey === "news.major");
      expect(newsItem?.targetDataCutoffKey).toBe("published_at");
      expect(newsItem?.targetDataCutoffJson).toEqual({
        key: "published_at",
        value: "2026-08-01T23:59:59+08:00",
      });

      const marketItem = items.find((item) => item.datasetKey === "market_snapshot");
      expect(marketItem?.targetDataCutoffKey).toBe("trade_date");
      expect(marketItem?.targetDataCutoffJson).toEqual({
        key: "trade_date",
        value: "2026-08-01",
      });
    },
  );
});
