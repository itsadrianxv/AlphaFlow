import { TRPCError } from "@trpc/server";
import {
  addResearchSpaceRunInputSchema,
  createResearchSpaceInputSchema,
  getResearchSpaceInputSchema,
  linkResearchSpaceStocksInputSchema,
  linkResearchSpaceWatchlistInputSchema,
  listResearchSpaceRunLinksInputSchema,
  listResearchSpacesInputSchema,
  removeResearchSpaceRunInputSchema,
  researchSpaceBriefSchema,
  researchSpaceDetailSchema,
  researchSpaceRunLinkListSchema,
  researchSpaceRunLinkSchema,
  researchSpaceSummarySchema,
  unlinkResearchSpaceStockInputSchema,
  updateResearchSpaceBriefInputSchema,
  updateResearchSpaceMetaInputSchema,
} from "~/contracts/space";
import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";

type ResearchSpaceRecord = {
  id: string;
  userId: string;
  name: string;
  description: string | null;
  briefJson: unknown;
  createdAt: Date;
  updatedAt: Date;
};

type ResearchSpaceRunLinkRecord = {
  id: string;
  spaceId: string;
  runId: string;
  note: string | null;
  createdAt: Date;
};

type ResearchSpaceWatchListLinkRecord = {
  id: string;
  spaceId: string;
  watchListId: string;
  createdAt: Date;
};

type ResearchSpaceStockLinkRecord = {
  id: string;
  spaceId: string;
  stockCode: string;
  stockName: string;
  createdAt: Date;
};

type WorkflowRunRecord = {
  id: string;
  userId: string;
  query: string;
  status: string;
  progressPercent: number;
  currentNodeKey: string | null;
  errorCode: string | null;
  errorMessage: string | null;
  createdAt: Date;
  startedAt: Date | null;
  completedAt: Date | null;
  input: Record<string, unknown>;
  result: Record<string, unknown> | null;
  template: {
    code: string;
    version: number;
  };
};

type WatchListRecord = {
  id: string;
  userId: string;
  name: string;
  description: string | null;
};

type SpaceDbClient = {
  researchSpace: {
    create(args: {
      data: {
        userId: string;
        name: string;
        description: string | null;
        briefJson: Record<string, unknown>;
      };
    }): Promise<ResearchSpaceRecord>;
    findMany(args: {
      where: { userId: string };
    }): Promise<ResearchSpaceRecord[]>;
    findFirst(args: {
      where: Partial<ResearchSpaceRecord>;
    }): Promise<ResearchSpaceRecord | null>;
    update(args: {
      where: { id: string };
      data: Partial<ResearchSpaceRecord>;
    }): Promise<ResearchSpaceRecord>;
  };
  researchSpaceRunLink: {
    create(args: {
      data: {
        spaceId: string;
        runId: string;
        note: string | null;
      };
    }): Promise<ResearchSpaceRunLinkRecord>;
    findMany(args: {
      where: Partial<ResearchSpaceRunLinkRecord>;
    }): Promise<ResearchSpaceRunLinkRecord[]>;
    deleteMany(args: {
      where: Partial<ResearchSpaceRunLinkRecord>;
    }): Promise<{ count: number }>;
  };
  researchSpaceWatchListLink: {
    create(args: {
      data: {
        spaceId: string;
        watchListId: string;
      };
    }): Promise<ResearchSpaceWatchListLinkRecord>;
    findMany(args: {
      where: Partial<ResearchSpaceWatchListLinkRecord>;
    }): Promise<ResearchSpaceWatchListLinkRecord[]>;
    deleteMany(args: {
      where: Partial<ResearchSpaceWatchListLinkRecord>;
    }): Promise<{ count: number }>;
  };
  researchSpaceStockLink: {
    createMany(args: {
      data: Array<{
        spaceId: string;
        stockCode: string;
        stockName: string;
      }>;
    }): Promise<{ count: number }>;
    findMany(args: {
      where: Partial<ResearchSpaceStockLinkRecord>;
    }): Promise<ResearchSpaceStockLinkRecord[]>;
    deleteMany(args: {
      where: Partial<ResearchSpaceStockLinkRecord>;
    }): Promise<{ count: number }>;
  };
  workflowRun: {
    findFirst(args: {
      where: Partial<WorkflowRunRecord>;
    }): Promise<WorkflowRunRecord | null>;
  };
  watchList: {
    findFirst(args: {
      where: Partial<WatchListRecord>;
    }): Promise<WatchListRecord | null>;
  };
};

function withSpaceDb<T extends object>(db: T) {
  return db as T & SpaceDbClient;
}

function toIsoString(value: Date | null | undefined) {
  return value ? value.toISOString() : null;
}

function parseBrief(value: unknown) {
  return researchSpaceBriefSchema.parse(value);
}

function buildRunSummary(run: WorkflowRunRecord) {
  return {
    id: run.id,
    query: run.query,
    status: run.status,
    progressPercent: run.progressPercent,
    currentNodeKey: run.currentNodeKey,
    errorCode: run.errorCode,
    errorMessage: run.errorMessage,
    createdAt: run.createdAt.toISOString(),
    startedAt: toIsoString(run.startedAt),
    completedAt: toIsoString(run.completedAt),
    templateCode: run.template.code,
    templateVersion: run.template.version,
  };
}

function buildRunLink(params: {
  link: ResearchSpaceRunLinkRecord;
  run: WorkflowRunRecord;
}) {
  return researchSpaceRunLinkSchema.parse({
    id: params.link.id,
    note: params.link.note,
    createdAt: params.link.createdAt.toISOString(),
    run: buildRunSummary(params.run),
  });
}

function matchesSearch(
  haystack: Array<string | null | undefined>,
  search?: string,
) {
  if (!search) {
    return true;
  }

  const normalizedSearch = search.trim().toLowerCase();
  return haystack.some((item) =>
    item?.toLowerCase().includes(normalizedSearch),
  );
}

async function requireOwnedSpace(
  db: SpaceDbClient,
  userId: string,
  spaceId: string,
) {
  const space = await db.researchSpace.findFirst({
    where: {
      id: spaceId,
      userId,
    },
  });

  if (!space) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "Research Space 不存在",
    });
  }

  return space;
}

async function touchSpace(db: SpaceDbClient, spaceId: string) {
  return db.researchSpace.update({
    where: { id: spaceId },
    data: {
      updatedAt: new Date(),
    },
  });
}

async function hydrateRunLinks(
  db: SpaceDbClient,
  userId: string,
  links: ResearchSpaceRunLinkRecord[],
) {
  const result: Array<ReturnType<typeof buildRunLink>> = [];

  for (const link of links) {
    const run = await db.workflowRun.findFirst({
      where: {
        id: link.runId,
        userId,
      },
    });

    if (run) {
      result.push(buildRunLink({ link, run }));
    }
  }

  return result.sort(
    (left, right) =>
      new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime(),
  );
}

async function hydrateWatchlists(
  db: SpaceDbClient,
  userId: string,
  links: ResearchSpaceWatchListLinkRecord[],
) {
  const items = [];

  for (const link of links) {
    const watchList = await db.watchList.findFirst({
      where: {
        id: link.watchListId,
        userId,
      },
    });

    if (watchList) {
      items.push({
        id: link.id,
        watchListId: watchList.id,
        name: watchList.name,
        description: watchList.description,
        createdAt: link.createdAt.toISOString(),
      });
    }
  }

  return items;
}

async function buildSpaceSummary(
  db: SpaceDbClient,
  space: ResearchSpaceRecord,
) {
  const [runLinks, watchListLinks, stockLinks] = await Promise.all([
    db.researchSpaceRunLink.findMany({ where: { spaceId: space.id } }),
    db.researchSpaceWatchListLink.findMany({ where: { spaceId: space.id } }),
    db.researchSpaceStockLink.findMany({ where: { spaceId: space.id } }),
  ]);

  return researchSpaceSummarySchema.parse({
    id: space.id,
    name: space.name,
    description: space.description,
    brief: parseBrief(space.briefJson),
    runCount: runLinks.length,
    watchListCount: watchListLinks.length,
    stockCount: stockLinks.length,
    createdAt: space.createdAt.toISOString(),
    updatedAt: space.updatedAt.toISOString(),
  });
}

export const spaceRouter = createTRPCRouter({
  create: protectedProcedure
    .input(createResearchSpaceInputSchema)
    .mutation(async ({ ctx, input }) => {
      const db = withSpaceDb(ctx.db);
      const created = await db.researchSpace.create({
        data: {
          userId: ctx.session.user.id,
          name: input.name,
          description: input.description ?? null,
          briefJson: input.brief,
        },
      });

      return buildSpaceSummary(db, created);
    }),

  list: protectedProcedure
    .input(listResearchSpacesInputSchema)
    .query(async ({ ctx, input }) => {
      const db = withSpaceDb(ctx.db);
      const records = await db.researchSpace.findMany({
        where: {
          userId: ctx.session.user.id,
        },
      });

      const summaries = await Promise.all(
        records.map((record) => buildSpaceSummary(db, record)),
      );

      return summaries
        .sort(
          (left, right) =>
            new Date(right.updatedAt).getTime() -
            new Date(left.updatedAt).getTime(),
        )
        .slice(input.offset, input.offset + input.limit);
    }),

  getDetail: protectedProcedure
    .input(getResearchSpaceInputSchema)
    .query(async ({ ctx, input }) => {
      const db = withSpaceDb(ctx.db);
      const space = await requireOwnedSpace(
        db,
        ctx.session.user.id,
        input.spaceId,
      );
      const [runLinks, watchListLinks, stockLinks] = await Promise.all([
        db.researchSpaceRunLink.findMany({ where: { spaceId: space.id } }),
        db.researchSpaceWatchListLink.findMany({
          where: { spaceId: space.id },
        }),
        db.researchSpaceStockLink.findMany({ where: { spaceId: space.id } }),
      ]);

      const hydratedRunLinks = await hydrateRunLinks(
        db,
        ctx.session.user.id,
        runLinks,
      );
      const recentSuccessfulRunLinks = hydratedRunLinks.filter(
        (item) => item.run.status === "SUCCEEDED",
      );

      return researchSpaceDetailSchema.parse({
        ...(await buildSpaceSummary(db, space)),
        watchLists: await hydrateWatchlists(
          db,
          ctx.session.user.id,
          watchListLinks,
        ),
        stocks: stockLinks.map((item) => ({
          id: item.id,
          stockCode: item.stockCode,
          stockName: item.stockName,
          createdAt: item.createdAt.toISOString(),
        })),
        runLinks: hydratedRunLinks,
        recentSuccessfulRunLinks,
      });
    }),

  updateMeta: protectedProcedure
    .input(updateResearchSpaceMetaInputSchema)
    .mutation(async ({ ctx, input }) => {
      const db = withSpaceDb(ctx.db);
      const existing = await requireOwnedSpace(
        db,
        ctx.session.user.id,
        input.spaceId,
      );
      const updated = await db.researchSpace.update({
        where: {
          id: existing.id,
        },
        data: {
          name: input.name ?? existing.name,
          description:
            input.description === undefined
              ? existing.description
              : input.description,
          updatedAt: new Date(),
        },
      });

      return buildSpaceSummary(db, updated);
    }),

  updateBrief: protectedProcedure
    .input(updateResearchSpaceBriefInputSchema)
    .mutation(async ({ ctx, input }) => {
      const db = withSpaceDb(ctx.db);
      const existing = await requireOwnedSpace(
        db,
        ctx.session.user.id,
        input.spaceId,
      );
      const updated = await db.researchSpace.update({
        where: {
          id: existing.id,
        },
        data: {
          briefJson: input.brief,
          updatedAt: new Date(),
        },
      });

      return buildSpaceSummary(db, updated);
    }),

  linkWatchlist: protectedProcedure
    .input(linkResearchSpaceWatchlistInputSchema)
    .mutation(async ({ ctx, input }) => {
      const db = withSpaceDb(ctx.db);
      await requireOwnedSpace(db, ctx.session.user.id, input.spaceId);

      const watchList = await db.watchList.findFirst({
        where: {
          id: input.watchListId,
          userId: ctx.session.user.id,
        },
      });
      if (!watchList) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "自选股列表不存在",
        });
      }

      const existingLinks = await db.researchSpaceWatchListLink.findMany({
        where: {
          spaceId: input.spaceId,
          watchListId: input.watchListId,
        },
      });
      if (existingLinks.length === 0) {
        await db.researchSpaceWatchListLink.create({
          data: {
            spaceId: input.spaceId,
            watchListId: input.watchListId,
          },
        });
      }
      await touchSpace(db, input.spaceId);

      return { success: true };
    }),

  unlinkWatchlist: protectedProcedure
    .input(linkResearchSpaceWatchlistInputSchema)
    .mutation(async ({ ctx, input }) => {
      const db = withSpaceDb(ctx.db);
      await requireOwnedSpace(db, ctx.session.user.id, input.spaceId);
      await db.researchSpaceWatchListLink.deleteMany({
        where: {
          spaceId: input.spaceId,
          watchListId: input.watchListId,
        },
      });
      await touchSpace(db, input.spaceId);

      return { success: true };
    }),

  linkStocks: protectedProcedure
    .input(linkResearchSpaceStocksInputSchema)
    .mutation(async ({ ctx, input }) => {
      const db = withSpaceDb(ctx.db);
      await requireOwnedSpace(db, ctx.session.user.id, input.spaceId);
      const existingLinks = await db.researchSpaceStockLink.findMany({
        where: {
          spaceId: input.spaceId,
        },
      });
      const existingCodes = new Set(
        existingLinks.map((item) => item.stockCode),
      );
      const nextStocks = input.stocks.filter(
        (item) => !existingCodes.has(item.stockCode),
      );

      if (nextStocks.length > 0) {
        await db.researchSpaceStockLink.createMany({
          data: nextStocks.map((item) => ({
            spaceId: input.spaceId,
            stockCode: item.stockCode,
            stockName: item.stockName,
          })),
        });
      }
      await touchSpace(db, input.spaceId);

      return { success: true };
    }),

  unlinkStock: protectedProcedure
    .input(unlinkResearchSpaceStockInputSchema)
    .mutation(async ({ ctx, input }) => {
      const db = withSpaceDb(ctx.db);
      await requireOwnedSpace(db, ctx.session.user.id, input.spaceId);
      await db.researchSpaceStockLink.deleteMany({
        where: {
          spaceId: input.spaceId,
          stockCode: input.stockCode,
        },
      });
      await touchSpace(db, input.spaceId);

      return { success: true };
    }),

  addRun: protectedProcedure
    .input(addResearchSpaceRunInputSchema)
    .mutation(async ({ ctx, input }) => {
      const db = withSpaceDb(ctx.db);
      await requireOwnedSpace(db, ctx.session.user.id, input.spaceId);
      const run = await db.workflowRun.findFirst({
        where: {
          id: input.runId,
          userId: ctx.session.user.id,
        },
      });

      if (!run) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Workflow run 不存在",
        });
      }

      const existingLinks = await db.researchSpaceRunLink.findMany({
        where: {
          spaceId: input.spaceId,
          runId: input.runId,
        },
      });
      if (existingLinks.length === 0) {
        await db.researchSpaceRunLink.create({
          data: {
            spaceId: input.spaceId,
            runId: input.runId,
            note: input.note ?? null,
          },
        });
      }
      await touchSpace(db, input.spaceId);

      return { success: true };
    }),

  removeRun: protectedProcedure
    .input(removeResearchSpaceRunInputSchema)
    .mutation(async ({ ctx, input }) => {
      const db = withSpaceDb(ctx.db);
      await requireOwnedSpace(db, ctx.session.user.id, input.spaceId);
      await db.researchSpaceRunLink.deleteMany({
        where: {
          spaceId: input.spaceId,
          runId: input.runId,
        },
      });
      await touchSpace(db, input.spaceId);

      return { success: true };
    }),

  listRunLinks: protectedProcedure
    .input(listResearchSpaceRunLinksInputSchema)
    .query(async ({ ctx, input }) => {
      const db = withSpaceDb(ctx.db);
      await requireOwnedSpace(db, ctx.session.user.id, input.spaceId);
      const runLinks = await db.researchSpaceRunLink.findMany({
        where: {
          spaceId: input.spaceId,
        },
      });
      const hydrated = await hydrateRunLinks(db, ctx.session.user.id, runLinks);
      const filtered = hydrated.filter((item) => {
        const matchesStatus = input.status
          ? item.run.status === input.status
          : true;
        const matchesTemplate = input.templateCode
          ? item.run.templateCode === input.templateCode
          : true;
        const matchesText = matchesSearch(
          [
            item.note,
            item.run.query,
            item.run.currentNodeKey,
            item.run.errorMessage,
            item.run.templateCode,
            item.run.status,
          ],
          input.search,
        );

        return matchesStatus && matchesTemplate && matchesText;
      });

      return researchSpaceRunLinkListSchema.parse({
        items: filtered.slice(input.offset, input.offset + input.limit),
        totalCount: filtered.length,
      });
    }),
});
