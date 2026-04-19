import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock(
  "~/app/opportunity-intelligence/opportunity-intelligence-client",
  () => ({
    OpportunityIntelligenceClient: () =>
      React.createElement(
        "div",
        { "data-testid": "opportunity-intelligence-client" },
        "opportunity-intelligence",
      ),
  }),
);

describe("OpportunityIntelligencePage", () => {
  it("renders the dedicated opportunity intelligence client inside suspense", async () => {
    const { default: OpportunityIntelligencePage } = await import(
      "~/app/opportunity-intelligence/page"
    );

    const markup = renderToStaticMarkup(
      React.createElement(OpportunityIntelligencePage),
    );

    expect(markup).toContain("opportunity-intelligence-client");
  });
});
