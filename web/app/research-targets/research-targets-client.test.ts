import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("ResearchTargetsClient", () => {
  it("keeps the selectable research target views and nested content visible", () => {
    const source = readFileSync(
      "app/research-targets/research-targets-client.tsx",
      "utf8",
    );

    expect(source).toContain('historyHeading="投研对象"');
    expect(source).toContain("historyItems={historyItems}");
    expect(source).toContain("historyItemLimit={100}");
    expect(source).toContain("收藏公司");
    expect(source).toContain("收藏行业");
    expect(source).toContain("自选股");
    expect(source).toContain("新建投研对象");
    expect(source).toContain("最近笔记");
    expect(source).toContain("财务快照");
    expect(source).toContain("研究报告");
    expect(source).toContain("EditableMarkdownBlock");
    expect(source).toContain("updateArtifact");
    expect(source).not.toContain('title="投研收藏"');
    expect(source).not.toContain("统一管理收藏公司、收藏行业和自选股");
  });
});
