import { Prisma } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";
import { resetLegacyScreeningData } from "~/server/application/screening/reset-legacy-screening-data";

describe("resetLegacyScreeningData", () => {
  it("clears persisted legacy screening state while preserving workspace identity", async () => {
    const screeningFormula = {
      deleteMany: vi.fn().mockResolvedValue({ count: 4 }),
    };
    const screeningWorkspace = {
      updateMany: vi.fn().mockResolvedValue({ count: 6 }),
    };

    const result = await resetLegacyScreeningData({
      screeningFormula,
      screeningWorkspace,
    });

    expect(screeningFormula.deleteMany).toHaveBeenCalledWith({});
    expect(screeningWorkspace.updateMany).toHaveBeenCalledWith({
      data: {
        indicatorIds: [],
        formulaIds: [],
        filterRules: [],
        sortState: Prisma.JsonNull,
        resultSnapshot: Prisma.JsonNull,
        lastFetchedAt: null,
      },
    });
    expect(result).toEqual({
      deletedFormulaCount: 4,
      resetWorkspaceCount: 6,
    });
  });
});
