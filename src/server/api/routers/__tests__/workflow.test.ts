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
