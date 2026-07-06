import { describe, expect, it, vi } from "vitest";
import {
  buildDefaultTaskContract,
  writeTaskContract,
} from "~/server/application/intelligence/research-workflow-kernel";
import { DEFAULT_RESEARCH_RUNTIME_CONFIG } from "~/server/domain/workflow/research";

describe("research-workflow-kernel", () => {
  it("keeps quick default task contract on standard depth even with researchGoal", () => {
    expect(
      buildDefaultTaskContract({
        subject: "quick",
        preferences: {
          researchGoal: "Find the clearest monetization path",
        },
      }).analysisDepth,
    ).toBe("standard");
  });

  it("allows quick workflow to force structured planning onto reasoner", async () => {
    const completeContract = vi.fn(async (_messages, fallback) => fallback);

    await writeTaskContract({
      client: {
        completeContract,
      } as never,
      subject: "quick",
      runtimeConfig: DEFAULT_RESEARCH_RUNTIME_CONFIG,
      structuredModel: "deepseek-reasoner",
    });

    expect(completeContract).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.anything(),
      expect.objectContaining({
        model: "deepseek-reasoner",
      }),
    );
  });
});
