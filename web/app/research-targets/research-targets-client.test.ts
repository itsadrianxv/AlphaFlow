import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

function noteContentSource(source: string) {
  const start = source.indexOf("{targetNotes.map((note)");
  const end = source.indexOf("{showSnapshots ?", start);
  return source.slice(start, end);
}

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

  it("在笔记正文后展示关联思维导图", () => {
    const source = readFileSync(
      "app/research-targets/research-targets-client.tsx",
      "utf8",
    );
    const noteSource = noteContentSource(source);

    expect(noteSource.indexOf("<EditableMarkdownBlock")).toBeGreaterThan(-1);
    expect(noteSource.indexOf("<ResearchNoteMindMapLinks")).toBeGreaterThan(
      noteSource.indexOf("<EditableMarkdownBlock"),
    );
  });
});
