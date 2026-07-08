import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("IndustryConclusionDetail rounded card style", () => {
  const source = readFileSync(
    "app/workflows/[runId]/industry-conclusion-detail.tsx",
    "utf8",
  );

  it("renders the conclusion detail inside a rounded card", () => {
    expect(source).toContain('data-industry-conclusion-detail="true"');
    expect(source).toContain("rounded-[16px]");
    expect(source).toContain("shadow-[var(--app-shadow-sm)]");
  });

  it("rounds and clips nested metric and navigation regions", () => {
    expect(source).toContain("overflow-hidden rounded-[14px]");
    expect(source).toContain("grid overflow-hidden border-b");
  });
});
