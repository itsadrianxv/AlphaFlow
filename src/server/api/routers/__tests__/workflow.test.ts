import { describe, expect, it, vi } from "vitest";

vi.mock("~/platform/trpc/server", () => {
  const procedureBuilder = {
    use: () => procedureBuilder,
    input(schema: unknown) {
      return {
        query: (handler: unknown) => ({ schema, handler }),
        mutation: (handler: unknown) => ({ schema, handler }),
      };
    },
    query: (handler: unknown) => ({ handler }),
    mutation: (handler: unknown) => ({ handler }),
  };

  return {
    createTRPCRouter: (router: Record<string, unknown>) => router,
    protectedProcedure: procedureBuilder,
  };
});

describe("researchRunsRouter.startTimingSignalPipeline", () => {
  it("accepts a six-digit stock code", async () => {
    const { researchRunsRouter } = await import(
      "~/modules/research/server/api/runs-router"
    );
    const procedure =
      researchRunsRouter.startTimingSignalPipeline as unknown as {
        schema: {
          safeParse(input: unknown): { success: boolean };
        };
      };
    const result = procedure.schema.safeParse({
      stockCode: "600519",
    });

    expect(result.success).toBe(true);
  });
});

describe("researchRunsRouter watchlist timing inputs", () => {
  it("accepts UUID watchlist ids for watchlist timing workflows", async () => {
    const { researchRunsRouter } = await import(
      "~/modules/research/server/api/runs-router"
    );
    const startWatchlistTimingCardsProcedure =
      researchRunsRouter.startWatchlistTimingCardsPipeline as unknown as {
        schema: {
          safeParse(input: unknown): { success: boolean };
        };
      };
    const startWatchlistTimingProcedure =
      researchRunsRouter.startWatchlistTimingPipeline as unknown as {
        schema: {
          safeParse(input: unknown): { success: boolean };
        };
      };
    const watchListId = "550e8400-e29b-41d4-a716-446655440000";

    expect(
      startWatchlistTimingCardsProcedure.schema.safeParse({
        watchListId,
      }).success,
    ).toBe(true);
    expect(
      startWatchlistTimingProcedure.schema.safeParse({
        watchListId,
        portfolioSnapshotId: "ck12345678901234567890123",
      }).success,
    ).toBe(true);
  });
});
