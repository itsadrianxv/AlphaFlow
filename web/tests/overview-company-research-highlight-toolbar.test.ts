import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("概览与公司研究页高亮工具栏", () => {
  const overviewSource = readFileSync("app/page.tsx", "utf8");
  const companyResearchSource = readFileSync(
    "app/company-research/company-research-client.tsx",
    "utf8",
  );

  it("概览页严格只保留双视图和对话框，不挂载高亮工具栏", () => {
    expect(overviewSource).not.toContain("HighlightToNote");
    expect(overviewSource).not.toContain('kind: "overview"');
    expect(overviewSource).toContain("<OverviewWorkspace signedIn={signedIn} />");
  });

  it("在公司研究页使用浮动工具栏并保留研究对象上下文", () => {
    expect(companyResearchSource).toContain("<HighlightToNote");
    expect(companyResearchSource).toContain("floatingToolbar");
    expect(companyResearchSource).toContain('kind: "company_research"');
    expect(companyResearchSource).toContain("stockCode: searchParams.get");
    expect(companyResearchSource).toContain("companyName: companyName.trim()");
  });
});
