import { describe, expect, it } from "vitest";
import {
  COMPANY_RESEARCH_TEMPLATE_CODE,
  QUICK_RESEARCH_TEMPLATE_CODE,
  TIMING_SIGNAL_PIPELINE_TEMPLATE_CODE,
  WATCHLIST_TIMING_PIPELINE_TEMPLATE_CODE,
} from "~/modules/research/server/domain/workflow/types";
import { buildRunDetailHref } from "~/modules/research/ui/industry/run-detail-href";

describe("run-detail-href", () => {
  it("routes company research runs to the company-research module", () => {
    expect(
      buildRunDetailHref({
        runId: "run_company_1",
        templateCode: COMPANY_RESEARCH_TEMPLATE_CODE,
      }),
    ).toBe("/research/runs/run_company_1");
  });

  it("keeps other workflow runs under the workflows module", () => {
    expect(
      buildRunDetailHref({
        runId: "run_workflow_1",
        templateCode: QUICK_RESEARCH_TEMPLATE_CODE,
      }),
    ).toBe("/research/runs/run_workflow_1");
    expect(
      buildRunDetailHref({
        runId: "run_unknown_1",
      }),
    ).toBe("/research/runs/run_unknown_1");
  });

  it("routes timing workflow runs back to the timing module", () => {
    expect(
      buildRunDetailHref({
        runId: "run_timing_1",
        templateCode: TIMING_SIGNAL_PIPELINE_TEMPLATE_CODE,
      }),
    ).toBe("/timing");
    expect(
      buildRunDetailHref({
        runId: "run_watchlist_timing_1",
        templateCode: WATCHLIST_TIMING_PIPELINE_TEMPLATE_CODE,
      }),
    ).toBe("/timing");
  });
});
