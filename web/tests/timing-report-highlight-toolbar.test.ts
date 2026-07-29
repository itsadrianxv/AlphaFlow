import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("TimingReportClient highlight-to-note toolbar", () => {
  const source = readFileSync(
    "app/timing/reports/[cardId]/timing-report-client.tsx",
    "utf8",
  );

  it("wraps timing reports with the floating note toolbar", () => {
    expect(source).toContain(
      'import { HighlightToNote } from "~/app/_components/highlight-to-note";',
    );
    expect(source).toContain("<HighlightToNote");
    expect(source).toContain("floatingToolbar");
  });

  it("records timing report source metadata for saved highlights", () => {
    expect(source).toContain('kind: "timing_report"');
    expect(source).toContain("cardId");
    expect(source).toContain("stockCode: report.report.stockCode");
    expect(source).toContain("stockName: report.report.stockName");
  });
});
