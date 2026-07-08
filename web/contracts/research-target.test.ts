import { describe, expect, it } from "vitest";
import {
  createFinancialSnapshotInputSchema,
  createResearchNoteInputSchema,
  researchTargetRefSchema,
  updateResearchArtifactInputSchema,
} from "~/contracts/research-target";

const sampleWorkspaceResult = {
  periods: ["2025"],
  indicatorMeta: [
    {
      id: "roe",
      name: "ROE",
      valueType: "PERCENT",
      periodScope: "series",
      retrievalMode: "statement_series",
    },
  ],
  rows: [
    {
      stockCode: "300750",
      stockName: "宁德时代",
      metrics: {
        roe: { byPeriod: { "2025": 18.2 } },
      },
    },
  ],
  latestSnapshotRows: [
    {
      stockCode: "300750",
      stockName: "宁德时代",
      metrics: {
        roe: { value: 18.2, period: "2025" },
      },
    },
  ],
  warnings: [],
  dataStatus: "READY",
  provider: "test",
};

describe("research-target contracts", () => {
  it("accepts the unified target reference types", () => {
    for (const type of [
      "company",
      "industry",
      "watchlist",
      "space",
      "workflow_run",
    ]) {
      expect(
        researchTargetRefSchema.safeParse({ type, id: "target-1" }).success,
      ).toBe(true);
    }

    expect(
      researchTargetRefSchema.safeParse({ type: "screening", id: "x" }).success,
    ).toBe(false);
  });

  it("keeps notes flexible but requires a concrete target and content", () => {
    const result = createResearchNoteInputSchema.safeParse({
      targetRef: { type: "company", id: "company-1" },
      contentMarkdown: "利润率改善需要继续验证。",
      source: { kind: "highlight", runId: "run-1" },
      tags: ["高亮", "风险"],
    });

    expect(result.success).toBe(true);
    expect(
      createResearchNoteInputSchema.safeParse({
        targetRef: { type: "company", id: "company-1" },
        contentMarkdown: "",
      }).success,
    ).toBe(false);
  });

  it("accepts screening financial snapshots for one or many companies", () => {
    const result = createFinancialSnapshotInputSchema.safeParse({
      targetRef: { type: "watchlist", id: "watchlist-1" },
      companyRefs: [{ stockCode: "300750", stockName: "宁德时代" }],
      metricSet: sampleWorkspaceResult.indicatorMeta,
      periodRange: { periods: ["2025"] },
      rawSnapshot: sampleWorkspaceResult,
      source: { kind: "screening_workspace" },
    });

    expect(result.success).toBe(true);
  });

  it("requires concrete markdown when updating a research artifact", () => {
    expect(
      updateResearchArtifactInputSchema.safeParse({
        id: "artifact-1",
        markdown: "## 结论\n\n继续跟踪盈利质量。",
      }).success,
    ).toBe(true);

    expect(
      updateResearchArtifactInputSchema.safeParse({
        id: "artifact-1",
        markdown: "",
      }).success,
    ).toBe(false);
  });
});
