import { describe, expect, it, vi } from "vitest";
import { WorkflowCommandService } from "~/server/application/workflow/command-service";
import {
  WORKFLOW_ERROR_CODES,
  type WorkflowDomainError,
} from "~/server/domain/workflow/errors";

describe("WorkflowCommandService", () => {
  it("rejects legacy quick research template versions", async () => {
    const getTemplateByCodeAndVersion = vi.fn(async () => ({
      id: "tpl_v2",
      code: "quick_industry_research",
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
      service.startQuickResearch({
        userId: "user_1",
        query: "AI infra",
        templateVersion: 2,
      }),
    ).rejects.toMatchObject({
      code: WORKFLOW_ERROR_CODES.WORKFLOW_TEMPLATE_NOT_FOUND,
    } satisfies Partial<WorkflowDomainError>);
    expect(createRun).not.toHaveBeenCalled();
  });
});
