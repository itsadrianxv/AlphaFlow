import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

describe("OpportunityIntelligencePage", () => {
  it("renders a stable migration landing page for legacy opportunity intelligence links", async () => {
    const { default: OpportunityIntelligencePage } = await import(
      "~/app/opportunity-intelligence/page"
    );

    const markup = renderToStaticMarkup(
      React.createElement(OpportunityIntelligencePage),
    );

    expect(markup).toContain("机会研判入口已迁移");
    expect(markup).toContain('href="/workflows"');
    expect(markup).toContain('href="/screening"');
    expect(markup).toContain('href="/timing"');
  });
});
