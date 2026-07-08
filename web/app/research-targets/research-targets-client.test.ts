import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("ResearchTargetsClient", () => {
  it("keeps the unified research target sections visible", () => {
    const source = readFileSync(
      "app/research-targets/research-targets-client.tsx",
      "utf8",
    );

    expect(source).toContain("收藏公司");
    expect(source).toContain("收藏行业");
    expect(source).toContain("自选股");
    expect(source).toContain("最近笔记");
    expect(source).toContain("财务快照");
    expect(source).toContain("研究报告");
  });
});
