import { Prisma } from "@prisma/client";

type ScreeningResetClient = {
  screeningFormula: {
    deleteMany(args: Record<string, never>): Promise<{ count: number }>;
  };
  screeningWorkspace: {
    updateMany(args: {
      data: {
        indicatorIds: string[];
        formulaIds: string[];
        filterRules: [];
        sortState: typeof Prisma.JsonNull;
        resultSnapshot: typeof Prisma.JsonNull;
        lastFetchedAt: null;
      };
    }): Promise<{ count: number }>;
  };
};

export async function resetLegacyScreeningData(client: ScreeningResetClient) {
  const deletedFormulas = await client.screeningFormula.deleteMany({});
  const resetWorkspaces = await client.screeningWorkspace.updateMany({
    data: {
      indicatorIds: [],
      formulaIds: [],
      filterRules: [],
      sortState: Prisma.JsonNull,
      resultSnapshot: Prisma.JsonNull,
      lastFetchedAt: null,
    },
  });

  return {
    deletedFormulaCount: deletedFormulas.count,
    resetWorkspaceCount: resetWorkspaces.count,
  };
}
