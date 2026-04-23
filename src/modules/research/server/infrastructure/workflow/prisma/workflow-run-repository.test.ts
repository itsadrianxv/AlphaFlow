import { describe, expect, it, vi } from "vitest";
import { QUICK_RESEARCH_TEMPLATE_CODE } from "~/modules/research/server/domain/workflow/types";
import { PrismaWorkflowRunRepository } from "~/modules/research/server/infrastructure/workflow/prisma/workflow-run-repository";

describe("PrismaWorkflowRunRepository", () => {
  it("keeps only quick research template v3 active", async () => {
    const updateMany = vi.fn(async () => ({ count: 2 }));
    const upsert = vi.fn(async (params: { create: { version: number } }) => ({
      id: `tpl_v${params.create.version}`,
      code: QUICK_RESEARCH_TEMPLATE_CODE,
      version: params.create.version,
      graphConfig: {
        nodes: ["agent0_clarify_scope"],
      },
      inputSchema: {},
      isActive: true,
    }));
    const prisma = {
      workflowTemplate: {
        updateMany,
        upsert,
      },
    };
    const repository = new PrismaWorkflowRunRepository(prisma as never);

    const template = await repository.ensureQuickResearchTemplate();

    expect(updateMany).toHaveBeenCalledWith({
      where: {
        code: QUICK_RESEARCH_TEMPLATE_CODE,
        version: {
          not: 3,
        },
      },
      data: {
        isActive: false,
      },
    });
    expect(upsert).toHaveBeenCalledTimes(1);
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          code_version: {
            code: QUICK_RESEARCH_TEMPLATE_CODE,
            version: 3,
          },
        },
        create: expect.objectContaining({
          code: QUICK_RESEARCH_TEMPLATE_CODE,
          version: 3,
          isActive: true,
        }),
      }),
    );
    expect(template.version).toBe(3);
  });
});
