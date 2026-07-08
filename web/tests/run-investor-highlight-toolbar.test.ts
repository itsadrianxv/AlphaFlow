import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("RunInvestorClient highlight-to-note toolbar", () => {
  const source = readFileSync(
    "app/workflows/[runId]/run-investor-client.tsx",
    "utf8",
  );

  it("uses the Pi Agent floating toolbar for workflow conclusions", () => {
    const highlightUsages = source.match(/<HighlightToNote[\s\S]*?>/g) ?? [];

    expect(highlightUsages).toHaveLength(2);
    expect(highlightUsages.every((usage) => usage.includes("floatingToolbar")))
      .toBe(true);
  });

  it("does not prefill the last-note target from workflow input", () => {
    expect(source).not.toContain("targetRef={targetRef}");
    expect(source).not.toContain("readTargetRef");
  });
});
