import { describe, expect, it, vi } from "vitest";

vi.mock("~/server/api/trpc", () => {
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

describe("workflowRouter.startTimingSignalPipeline", () => {
  it("accepts a six-digit stock code", async () => {
    const { workflowRouter } = await import("~/server/api/routers/workflow");
    const procedure = workflowRouter.startTimingSignalPipeline as unknown as {
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

describe("workflowRouter watchlist timing inputs", () => {
  it("accepts UUID watchlist ids for watchlist timing workflows", async () => {
    const { workflowRouter } = await import("~/server/api/routers/workflow");
    const startWatchlistTimingCardsProcedure =
      workflowRouter.startWatchlistTimingCardsPipeline as unknown as {
        schema: {
          safeParse(input: unknown): { success: boolean };
        };
      };
    const startWatchlistTimingProcedure =
      workflowRouter.startWatchlistTimingPipeline as unknown as {
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
