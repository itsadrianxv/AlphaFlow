import { describe, expect, it } from "vitest";

import { formatOpportunityAsOf } from "~/app/opportunity-intelligence/format-as-of";

describe("formatOpportunityAsOf", () => {
  it("supports legacy YYYYMMDD market context timestamps", () => {
    expect(() => formatOpportunityAsOf("20260418")).not.toThrow();
    expect(formatOpportunityAsOf("20260418")).not.toBe("-");
  });

  it("returns a placeholder for invalid timestamps", () => {
    expect(formatOpportunityAsOf("not-a-date")).toBe("-");
  });
});
