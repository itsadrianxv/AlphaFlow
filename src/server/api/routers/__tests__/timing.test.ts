import type { TRPCError } from "@trpc/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const getTimingReportMock = vi.fn();

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

vi.mock("~/server/application/timing/timing-report-service", () => ({
  TimingReportService: class TimingReportService {
    getTimingReport = getTimingReportMock;
  },
}));

describe("timingRouter.getTimingReport", () => {
  beforeEach(() => {
    getTimingReportMock.mockReset();
  });

  it("accepts a valid timing card id and returns the aggregated report", async () => {
    const { timingRouter } = await import("~/server/api/routers/timing");
    const procedure = timingRouter.getTimingReport as unknown as {
      schema: {
        safeParse(input: unknown): { success: boolean };
      };
      handler(args: {
        ctx: { db: unknown; session: { user: { id: string } } };
        input: { cardId: string };
      }): Promise<unknown>;
    };
    const cardId = "ck12345678901234567890123";
    getTimingReportMock.mockResolvedValue({
      card: { id: cardId },
      bars: [],
      chartLevels: {},
      evidence: {},
      marketContext: {},
      reviewTimeline: [],
    });

    const result = procedure.schema.safeParse({ cardId });

    expect(result.success).toBe(true);
    await expect(
      procedure.handler({
        ctx: {
          db: {},
          session: { user: { id: "user_1" } },
        },
        input: { cardId },
      }),
    ).resolves.toMatchObject({
      card: { id: cardId },
    });
    expect(getTimingReportMock).toHaveBeenCalledWith({
      userId: "user_1",
      cardId,
    });
  });

  it("throws NOT_FOUND when the report cannot be resolved", async () => {
    const { timingRouter } = await import("~/server/api/routers/timing");
    const procedure = timingRouter.getTimingReport as unknown as {
      handler(args: {
        ctx: { db: unknown; session: { user: { id: string } } };
        input: { cardId: string };
      }): Promise<unknown>;
    };

    getTimingReportMock.mockResolvedValue(null);

    await expect(
      procedure.handler({
        ctx: {
          db: {},
          session: { user: { id: "user_1" } },
        },
        input: { cardId: "ck12345678901234567890123" },
      }),
    ).rejects.toMatchObject({
      code: "NOT_FOUND",
    } satisfies Partial<TRPCError>);
  });
});
