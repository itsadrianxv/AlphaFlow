import { describe, expect, it } from "vitest";

import { shouldShowRunDigestBanner } from "~/app/workflows/[runId]/run-investor-layout";
import {
  COMPANY_RESEARCH_TEMPLATE_CODE,
  QUICK_RESEARCH_TEMPLATE_CODE,
} from "~/server/domain/workflow/types";

describe("run-investor-layout", () => {
  it("hides the digest banner for structured company research detail runs", () => {
    expect(
      shouldShowRunDigestBanner({
        templateCode: COMPANY_RESEARCH_TEMPLATE_CODE,
        status: "SUCCEEDED",
        hasCompanyDetailModel: true,
      }),
    ).toBe(false);

    expect(
      shouldShowRunDigestBanner({
        templateCode: COMPANY_RESEARCH_TEMPLATE_CODE,
        status: "PAUSED",
        hasCompanyDetailModel: true,
      }),
    ).toBe(false);
  });

  it("keeps the digest banner for other run layouts", () => {
    expect(
      shouldShowRunDigestBanner({
        templateCode: COMPANY_RESEARCH_TEMPLATE_CODE,
        status: "RUNNING",
        hasCompanyDetailModel: false,
      }),
    ).toBe(true);

    expect(
      shouldShowRunDigestBanner({
        templateCode: QUICK_RESEARCH_TEMPLATE_CODE,
        status: "SUCCEEDED",
        hasCompanyDetailModel: false,
      }),
    ).toBe(true);
  });
});
