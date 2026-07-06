import { describe, expect, it, vi } from "vitest";
import { WorkflowCommandService } from "~/server/application/workflow/command-service";
import {
  WORKFLOW_ERROR_CODES,
  type WorkflowDomainError,
} from "~/server/domain/workflow/errors";
import { TIMING_SIGNAL_PIPELINE_TEMPLATE_CODE } from "~/server/domain/workflow/types";

describe("WorkflowCommandService", () => {
  it("rejects legacy industry research template versions", async () => {
    const getTemplateByCodeAndVersion = vi.fn(async () => ({
      id: "tpl_v2",
      code: "industry_research",
      version: 2,
      graphConfig: {
        nodes: ["agent0_clarify_scope"],
      },
    }));
    const createRun = vi.fn();
    const repository = {
      getTemplateByCodeAndVersion,
      createRun,
    };
    const service = new WorkflowCommandService(repository as never);

    await expect(
      service.startIndustryResearch({
        userId: "user_1",
        query: "AI infra",
        templateVersion: 2,
      }),
    ).rejects.toMatchObject({
      code: WORKFLOW_ERROR_CODES.WORKFLOW_TEMPLATE_NOT_FOUND,
    } satisfies Partial<WorkflowDomainError>);
    expect(createRun).not.toHaveBeenCalled();
  });

  it("refreshes legacy timing signal v1 templates before creating runs", async () => {
    const legacyTemplate = {
      id: "tpl_timing_v1",
      code: TIMING_SIGNAL_PIPELINE_TEMPLATE_CODE,
      version: 1,
      graphConfig: {
        nodes: [
          "load_targets",
          "fetch_signal_snapshots",
          "technical_signal_agent",
          "timing_synthesis_agent",
          "persist_cards",
        ],
      },
    };
    const refreshedTemplate = {
      ...legacyTemplate,
      graphConfig: {
        nodes: [
          "load_targets",
          "fetch_signal_snapshots",
          "technical_signal_agent",
          "timing_synthesis_agent",
          "kronos_forecast_agent",
          "persist_cards",
        ],
      },
    };
    const findPendingOrRunningByIdempotency = vi.fn().mockResolvedValue(null);
    const getTemplateByCodeAndVersion = vi
      .fn()
      .mockResolvedValue(legacyTemplate);
    const ensureTimingSignalPipelineTemplate = vi
      .fn()
      .mockResolvedValue(refreshedTemplate);
    const createRun = vi.fn().mockResolvedValue({
      id: "run_1",
      status: "PENDING",
      createdAt: new Date("2026-03-06T00:00:00.000Z"),
    });
    const repository = {
      findPendingOrRunningByIdempotency,
      getTemplateByCodeAndVersion,
      ensureTimingSignalPipelineTemplate,
      createRun,
    };
    const service = new WorkflowCommandService(repository as never);

    await service.startTimingSignalPipeline({
      userId: "user_1",
      stockCode: "600519",
      asOfDate: "2026-03-06",
    });

    expect(ensureTimingSignalPipelineTemplate).toHaveBeenCalledTimes(1);
    expect(createRun).toHaveBeenCalledWith(
      expect.objectContaining({
        templateId: "tpl_timing_v1",
        nodeKeys: refreshedTemplate.graphConfig.nodes,
      }),
    );
  });
});
