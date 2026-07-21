import { describe, expect, it } from "vitest";
import {
  buildResearchTargetSearchResults,
  createSearchSnippet,
} from "../app/research-targets/research-target-search";

const company = {
  ref: { type: "company" as const, id: "company-1" },
  label: "宁德时代 (300750)",
  description: "动力电池与储能龙头",
  tags: ["新能源", "电池"],
  updatedAt: "2026-07-21T00:00:00.000Z",
};

const industry = {
  ref: { type: "industry" as const, id: "industry-1" },
  label: "人工智能",
  description: "自定义主题",
  tags: [],
  updatedAt: "2026-07-20T00:00:00.000Z",
};

describe("投研收藏搜索", () => {
  it("searches entity fields and groups matches by entity", () => {
    const results = buildResearchTargetSearchResults({
      query: "电池",
      targets: [company, industry],
      notes: [
        {
          id: "note-1",
          targetRef: company.ref,
          title: "电池成本观察",
          kind: null,
          contentMarkdown: "关注单位成本变化",
          rawContent: null,
          source: null,
          tags: [],
          createdAt: "2026-07-21T00:00:00.000Z",
          updatedAt: "2026-07-21T00:00:00.000Z",
        },
      ],
      snapshots: [],
      artifacts: [],
    });

    expect(results).toHaveLength(1);
    expect(results[0]?.target.ref).toEqual(company.ref);
    expect(results[0]?.matches[0]).toMatchObject({ source: "对象" });
  });

  it("searches notes, financial snapshots, and research reports", () => {
    const results = buildResearchTargetSearchResults({
      query: "毛利率",
      targets: [company],
      notes: [],
      snapshots: [
        {
          id: "snapshot-1",
          targetRef: company.ref,
          companyRefs: [{ stockCode: "300750", stockName: "宁德时代" }],
          metricSet: ["毛利率"],
          periodRange: { latest: "2026Q1" },
          rawSnapshot: { metrics: { 毛利率: { value: 25.4 } } },
          source: { provider: "TuShare" },
          createdAt: "2026-07-21T00:00:00.000Z",
        },
      ],
      artifacts: [
        {
          id: "artifact-1",
          targetRef: company.ref,
          financialSnapshotId: null,
          artifactType: "research_report",
          title: "盈利能力研究报告",
          contentType: "text/markdown",
          payload: { markdown: "毛利率改善来自产品结构优化" },
          source: null,
          createdAt: "2026-07-21T00:00:00.000Z",
          updatedAt: "2026-07-21T00:00:00.000Z",
        },
      ],
    });

    expect(results).toHaveLength(1);
    expect(results[0]?.matches.map((match) => match.source)).toEqual([
      "财务快照",
      "研究报告",
    ]);
  });

  it("trims queries and returns a bounded context snippet", () => {
    const text = `${"前置内容 ".repeat(30)}经营现金流改善${" 后置内容".repeat(30)}`;

    expect(createSearchSnippet(text, "  经营现金流改善  ", 12)).toContain(
      "经营现金流改善",
    );
    expect(createSearchSnippet(text, "经营现金流改善", 12).length).toBeLessThan(
      text.length,
    );
  });

  it("returns no results for an empty query", () => {
    expect(
      buildResearchTargetSearchResults({
        query: "  ",
        targets: [company],
        notes: [],
        snapshots: [],
        artifacts: [],
      }),
    ).toEqual([]);
  });
});
