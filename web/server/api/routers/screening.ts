import { TRPCError } from "@trpc/server";
import { z } from "zod";
import {
  type CreateWorkspaceInput,
  createFormulaInputSchema,
  createScreeningRunInputSchema,
  createWorkspaceInputSchema,
  customFormulaSpecSchema,
  deleteWorkspaceInputSchema,
  indicatorCatalogItemSchema,
  listFormulasInputSchema,
  listWorkspacesInputSchema,
  updateFormulaInputSchema,
  updateWorkspaceInputSchema,
  validateFormulaInputSchema,
  type WorkspacePersistedState,
  type WorkspaceResult,
  workspaceDetailSchema,
  workspacePersistedStateSchema,
  workspaceQuerySchema,
  workspaceSummarySchema,
} from "~/contracts/screening";
import { normalizeFormulaExpression } from "~/server/api/routers/screening-formula-normalizer";
import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";
import { publishScreeningRun } from "~/server/application/screening/screening-run-stream";
import { PythonCapabilityGatewayClient } from "~/server/infrastructure/capabilities/python-capability-gateway-client";
import { PythonScreeningWorkbenchClient } from "~/server/infrastructure/screening/python-screening-workbench-client";

type ScreeningFormulaRecord = {
  id: string;
  userId: string;
  name: string;
  expression: string;
  targetIndicators: unknown;
  description: string | null;
  categoryId: string;
  createdAt: Date;
  updatedAt: Date;
};

type ScreeningWorkspaceRecord = {
  id: string;
  userId: string;
  name: string;
  description: string | null;
  stockCodes: string[];
  indicatorIds: string[];
  formulaIds: string[];
  timeConfig: unknown;
  filterRules: unknown;
  sortState: unknown;
  columnState: unknown;
  resultSnapshot: unknown;
  universe: unknown;
  lastFetchedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

type ScreeningDbClient = {
  screeningFormula: {
    findMany(args: unknown): Promise<ScreeningFormulaRecord[]>;
    findFirst(args: unknown): Promise<ScreeningFormulaRecord | null>;
    create(args: unknown): Promise<ScreeningFormulaRecord>;
    update(args: unknown): Promise<ScreeningFormulaRecord>;
    delete(args: unknown): Promise<void>;
  };
  screeningWorkspace: {
    findMany(args: unknown): Promise<ScreeningWorkspaceRecord[]>;
    findFirst(args: unknown): Promise<ScreeningWorkspaceRecord | null>;
    create(args: unknown): Promise<ScreeningWorkspaceRecord>;
    update(args: unknown): Promise<ScreeningWorkspaceRecord>;
    delete(args: unknown): Promise<void>;
  };
};

function withScreeningDb<T extends object>(db: T) {
  return db as T & ScreeningDbClient;
}

const getEntityInputSchema = z.object({
  id: z.string().min(1),
});

const toIsoString = (value: Date | null | undefined) =>
  value ? value.toISOString() : null;

function mapPersistedWorkspaceState(input: CreateWorkspaceInput): {
  stockCodes: string[];
  indicatorIds: string[];
  formulaIds: string[];
  timeConfig: WorkspacePersistedState["timeConfig"];
  filterRules: WorkspacePersistedState["filterRules"];
  sortState: WorkspacePersistedState["sortState"];
  columnState: WorkspacePersistedState["columnState"];
  resultSnapshot: WorkspaceResult | null;
  lastFetchedAt: Date | null;
  universe: WorkspacePersistedState["universe"];
} {
  return {
    stockCodes: input.stockCodes,
    indicatorIds: input.indicatorIds,
    formulaIds: input.formulaIds,
    timeConfig: input.timeConfig,
    filterRules: input.filterRules,
    sortState: input.sortState ?? null,
    columnState: input.columnState,
    resultSnapshot: input.resultSnapshot ?? null,
    lastFetchedAt: input.lastFetchedAt ? new Date(input.lastFetchedAt) : null,
    universe: input.universe ?? {
      type: "STOCKS",
      stockCodes: input.stockCodes,
    },
  };
}

function parseWorkspaceState(record: {
  stockCodes: string[];
  indicatorIds: string[];
  formulaIds: string[];
  timeConfig: unknown;
  filterRules: unknown;
  sortState: unknown;
  columnState: unknown;
  resultSnapshot: unknown;
  universe: unknown;
  lastFetchedAt: Date | null;
}) {
  return workspacePersistedStateSchema.parse({
    stockCodes: record.stockCodes,
    indicatorIds: record.indicatorIds,
    formulaIds: record.formulaIds,
    timeConfig: record.timeConfig,
    filterRules: record.filterRules,
    sortState: record.sortState,
    columnState: record.columnState,
    resultSnapshot: record.resultSnapshot,
    lastFetchedAt: record.lastFetchedAt?.toISOString(),
    universe: record.universe,
  });
}

function buildWorkspaceSummary(record: {
  id: string;
  name: string;
  description: string | null;
  stockCodes: string[];
  indicatorIds: string[];
  formulaIds: string[];
  lastFetchedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}) {
  return workspaceSummarySchema.parse({
    id: record.id,
    name: record.name,
    description: record.description,
    stockCount: record.stockCodes.length,
    indicatorCount: record.indicatorIds.length,
    formulaCount: record.formulaIds.length,
    lastFetchedAt: toIsoString(record.lastFetchedAt),
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  });
}

function buildWorkspaceDetail(record: {
  id: string;
  name: string;
  description: string | null;
  stockCodes: string[];
  indicatorIds: string[];
  formulaIds: string[];
  timeConfig: unknown;
  filterRules: unknown;
  sortState: unknown;
  columnState: unknown;
  resultSnapshot: unknown;
  universe: unknown;
  lastFetchedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}) {
  return workspaceDetailSchema.parse({
    ...buildWorkspaceSummary(record),
    state: parseWorkspaceState(record),
  });
}

function buildFormula(record: {
  id: string;
  name: string;
  expression: string;
  targetIndicators: unknown;
  description: string | null;
  categoryId: string;
  createdAt: Date;
  updatedAt: Date;
}) {
  return customFormulaSpecSchema.parse({
    id: record.id,
    name: record.name,
    expression: record.expression,
    targetIndicators: record.targetIndicators,
    description: record.description ?? undefined,
    categoryId: record.categoryId,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  });
}

async function normalizeFormulaForValidation(params: {
  client: PythonCapabilityGatewayClient;
  expression: string;
  targetIndicators: string[];
}) {
  const catalog = await params.client.listIndicatorCatalog();

  try {
    return normalizeFormulaExpression({
      expression: params.expression,
      targetIndicatorIds: params.targetIndicators,
      catalogItems: catalog.items,
    });
  } catch (error) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: (error as Error).message,
    });
  }
}

export const screeningRouter = createTRPCRouter({
  searchStocks: protectedProcedure
    .input(
      z.object({
        keyword: z.string().trim().min(1),
        limit: z.number().int().min(1).max(20).default(20),
      }),
    )
    .query(async ({ input }) =>
      new PythonScreeningWorkbenchClient().searchStocks(
        input.keyword,
        input.limit,
      ),
    ),

  resolveStockMentions: protectedProcedure
    .input(z.object({ text: z.string().trim().min(1).max(20_000) }))
    .query(({ input }) =>
      new PythonScreeningWorkbenchClient().resolveStockMentions(input.text),
    ),

  listIndicatorCatalog: protectedProcedure.query(async () => {
    const client = new PythonCapabilityGatewayClient();
    const catalog = await client.listIndicatorCatalog();

    return {
      items: catalog.items.map((item) =>
        indicatorCatalogItemSchema.parse(item),
      ),
      categories: catalog.categories,
    };
  }),

  listFormulas: protectedProcedure
    .input(listFormulasInputSchema.optional())
    .query(async ({ ctx, input }) => {
      const db = withScreeningDb(ctx.db);
      const records = await db.screeningFormula.findMany({
        where: { userId: ctx.session.user.id },
        orderBy: { updatedAt: "desc" },
        take: input?.limit ?? 100,
        skip: input?.offset ?? 0,
      });

      return records.map((record: (typeof records)[number]) =>
        buildFormula(record),
      );
    }),

  validateFormula: protectedProcedure
    .input(validateFormulaInputSchema)
    .mutation(async ({ input }) => {
      const client = new PythonCapabilityGatewayClient();
      const expression = await normalizeFormulaForValidation({
        client,
        expression: input.expression,
        targetIndicators: input.targetIndicators,
      });

      return client.validateFormula({
        expression,
        targetIndicators: input.targetIndicators,
      });
    }),

  createFormula: protectedProcedure
    .input(createFormulaInputSchema)
    .mutation(async ({ ctx, input }) => {
      const db = withScreeningDb(ctx.db);
      const client = new PythonCapabilityGatewayClient();
      const normalizedInputExpression = await normalizeFormulaForValidation({
        client,
        expression: input.expression,
        targetIndicators: input.targetIndicators,
      });
      const validation = await client.validateFormula({
        expression: normalizedInputExpression,
        targetIndicators: input.targetIndicators,
      });

      if (!validation.valid) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: (validation.errors ?? []).join("；") || "公式校验失败",
        });
      }

      const created = await db.screeningFormula.create({
        data: {
          userId: ctx.session.user.id,
          name: input.name,
          expression:
            validation.normalizedExpression ?? normalizedInputExpression,
          targetIndicators: input.targetIndicators,
          description: input.description,
          categoryId: input.categoryId,
        },
      });

      return buildFormula(created);
    }),

  updateFormula: protectedProcedure
    .input(updateFormulaInputSchema)
    .mutation(async ({ ctx, input }) => {
      const db = withScreeningDb(ctx.db);
      const existing = await db.screeningFormula.findFirst({
        where: {
          id: input.id,
          userId: ctx.session.user.id,
        },
      });

      if (!existing) {
        throw new TRPCError({ code: "NOT_FOUND", message: "公式不存在" });
      }

      const nextExpression = input.expression ?? existing.expression;
      const nextTargets =
        input.targetIndicators ?? (existing.targetIndicators as string[]);

      const client = new PythonCapabilityGatewayClient();
      const normalizedInputExpression = await normalizeFormulaForValidation({
        client,
        expression: nextExpression,
        targetIndicators: nextTargets,
      });
      const validation = await client.validateFormula({
        expression: normalizedInputExpression,
        targetIndicators: nextTargets,
      });

      if (!validation.valid) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: (validation.errors ?? []).join("；") || "公式校验失败",
        });
      }

      const updated = await db.screeningFormula.update({
        where: { id: existing.id },
        data: {
          name: input.name,
          expression:
            validation.normalizedExpression ?? normalizedInputExpression,
          targetIndicators: nextTargets,
          description: input.description,
          categoryId: input.categoryId,
        },
      });

      return buildFormula(updated);
    }),

  deleteFormula: protectedProcedure
    .input(getEntityInputSchema)
    .mutation(async ({ ctx, input }) => {
      const db = withScreeningDb(ctx.db);
      const existing = await db.screeningFormula.findFirst({
        where: {
          id: input.id,
          userId: ctx.session.user.id,
        },
      });

      if (!existing) {
        throw new TRPCError({ code: "NOT_FOUND", message: "公式不存在" });
      }

      await db.screeningFormula.delete({
        where: { id: existing.id },
      });

      return { success: true };
    }),

  queryDataset: protectedProcedure
    .input(workspaceQuerySchema)
    .mutation(async ({ ctx, input }) => {
      const db = withScreeningDb(ctx.db);
      const client = new PythonCapabilityGatewayClient();
      const catalog = await client.listIndicatorCatalog();
      const catalogMap = new Map(catalog.items.map((item) => [item.id, item]));

      const indicators = input.indicatorIds.map((indicatorId) => {
        const indicator = catalogMap.get(indicatorId);
        if (!indicator) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: `鏈煡鎸囨爣: ${indicatorId}`,
          });
        }
        return indicator;
      });

      const formulaRecords =
        input.formulaIds.length === 0
          ? []
          : await db.screeningFormula.findMany({
              where: {
                userId: ctx.session.user.id,
                id: { in: input.formulaIds },
              },
            });
      const formulas = formulaRecords.map(
        (record: (typeof formulaRecords)[number]) => buildFormula(record),
      );

      if (formulas.length !== input.formulaIds.length) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "閮ㄥ垎鍏紡涓嶅瓨鍦ㄦ垨鏃犳潈璁块棶",
        });
      }

      return client.queryDataset({
        stockCodes: input.stockCodes,
        indicators,
        formulas,
        timeConfig: input.timeConfig,
      });
    }),

  createWorkspace: protectedProcedure
    .input(createWorkspaceInputSchema)
    .mutation(async ({ ctx, input }) => {
      const db = withScreeningDb(ctx.db);
      const payload = mapPersistedWorkspaceState(input);
      const created = await db.screeningWorkspace.create({
        data: {
          userId: ctx.session.user.id,
          name: input.name,
          description: input.description,
          stockCodes: payload.stockCodes,
          indicatorIds: payload.indicatorIds,
          formulaIds: payload.formulaIds,
          timeConfig: payload.timeConfig,
          filterRules: payload.filterRules,
          sortState: payload.sortState,
          columnState: payload.columnState,
          resultSnapshot: payload.resultSnapshot,
          lastFetchedAt: payload.lastFetchedAt,
          universe: payload.universe,
        },
      });

      return buildWorkspaceDetail(created);
    }),

  updateWorkspace: protectedProcedure
    .input(updateWorkspaceInputSchema)
    .mutation(async ({ ctx, input }) => {
      const db = withScreeningDb(ctx.db);
      const existing = await db.screeningWorkspace.findFirst({
        where: {
          id: input.id,
          userId: ctx.session.user.id,
        },
      });

      if (!existing) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "宸ヤ綔鍙颁笉瀛樺湪",
        });
      }

      const updated = await db.screeningWorkspace.update({
        where: { id: existing.id },
        data: {
          name: input.name,
          description: input.description,
          stockCodes: input.stockCodes,
          indicatorIds: input.indicatorIds,
          formulaIds: input.formulaIds,
          timeConfig: input.timeConfig,
          filterRules: input.filterRules,
          sortState: input.sortState,
          columnState: input.columnState,
          resultSnapshot: input.resultSnapshot,
          lastFetchedAt: input.lastFetchedAt
            ? new Date(input.lastFetchedAt)
            : input.lastFetchedAt === undefined
              ? undefined
              : null,
          universe: input.universe,
        },
      });

      return buildWorkspaceDetail(updated);
    }),

  listWorkspaces: protectedProcedure
    .input(listWorkspacesInputSchema.optional())
    .query(async ({ ctx, input }) => {
      const db = withScreeningDb(ctx.db);
      const records = await db.screeningWorkspace.findMany({
        where: { userId: ctx.session.user.id },
        orderBy: { updatedAt: "desc" },
        take: input?.limit ?? 20,
        skip: input?.offset ?? 0,
      });

      return records.map((record: (typeof records)[number]) =>
        buildWorkspaceSummary(record),
      );
    }),

  getWorkspace: protectedProcedure
    .input(getEntityInputSchema)
    .query(async ({ ctx, input }) => {
      const db = withScreeningDb(ctx.db);
      const record = await db.screeningWorkspace.findFirst({
        where: {
          id: input.id,
          userId: ctx.session.user.id,
        },
      });

      if (!record) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "宸ヤ綔鍙颁笉瀛樺湪",
        });
      }

      return buildWorkspaceDetail(record);
    }),

  deleteWorkspace: protectedProcedure
    .input(deleteWorkspaceInputSchema)
    .mutation(async ({ ctx, input }) => {
      const db = withScreeningDb(ctx.db);
      const record = await db.screeningWorkspace.findFirst({
        where: {
          id: input.id,
          userId: ctx.session.user.id,
        },
      });

      if (!record) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "宸ヤ綔鍙颁笉瀛樺湪",
        });
      }

      await db.screeningWorkspace.delete({
        where: { id: record.id },
      });

      return { success: true };
    }),

  createRun: protectedProcedure
    .input(createScreeningRunInputSchema)
    .mutation(async ({ ctx, input }) => {
      const workspace = await ctx.db.screeningWorkspace.findFirst({
        where: { id: input.workspaceId, userId: ctx.session.user.id },
      });
      if (!workspace) {
        throw new TRPCError({ code: "NOT_FOUND", message: "筛选工作区不存在" });
      }

      const formulas = input.formulaIds.length
        ? await ctx.db.screeningFormula.findMany({
            where: { userId: ctx.session.user.id, id: { in: input.formulaIds } },
          })
        : [];
      if (formulas.length !== input.formulaIds.length) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "部分公式不存在或无权访问" });
      }

      const config = {
        universe: input.universe,
        indicatorIds: input.indicatorIds,
        formulas: formulas.map(buildFormula),
        timeConfig: input.timeConfig,
        filterRules: input.filterRules,
        sortState: input.sortState ?? null,
      };
      const run = await ctx.db.screeningRun.create({
        data: {
          workspaceId: workspace.id,
          userId: ctx.session.user.id,
          config,
        },
      });
      try {
        await publishScreeningRun(run.id);
      } catch (error) {
        await ctx.db.screeningRun.update({
          where: { id: run.id },
          data: {
            status: "FAILED",
            completedAt: new Date(),
            errorCode: "STREAM_PUBLISH_FAILED",
            errorMessage: error instanceof Error ? error.message : String(error),
          },
        });
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "筛选任务发布失败" });
      }
      return { id: run.id, status: run.status, createdAt: run.createdAt.toISOString() };
    }),

  getRun: protectedProcedure
    .input(z.object({ id: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      const run = await ctx.db.screeningRun.findFirst({
        where: { id: input.id, userId: ctx.session.user.id },
      });
      if (!run) throw new TRPCError({ code: "NOT_FOUND", message: "筛选运行不存在" });
      return {
        ...run,
        fencingToken: run.fencingToken.toString(),
        createdAt: run.createdAt.toISOString(),
        updatedAt: run.updatedAt.toISOString(),
        startedAt: run.startedAt?.toISOString() ?? null,
        completedAt: run.completedAt?.toISOString() ?? null,
        leaseExpiresAt: run.leaseExpiresAt?.toISOString() ?? null,
      };
    }),

  listRuns: protectedProcedure
    .input(z.object({ workspaceId: z.string().min(1), limit: z.number().int().min(1).max(100).default(20) }))
    .query(async ({ ctx, input }) => {
      const runs = await ctx.db.screeningRun.findMany({
        where: { workspaceId: input.workspaceId, userId: ctx.session.user.id },
        orderBy: { createdAt: "desc" },
        take: input.limit,
      });
      return runs.map((run) => ({
        id: run.id, status: run.status, totalCount: run.totalCount,
        universeCount: run.universeCount, attempts: run.attempts,
        createdAt: run.createdAt.toISOString(), completedAt: run.completedAt?.toISOString() ?? null,
        errorCode: run.errorCode, errorMessage: run.errorMessage,
      }));
    }),

  listRunResults: protectedProcedure
    .input(z.object({ runId: z.string().min(1), cursor: z.string().optional() }))
    .query(async ({ ctx, input }) => {
      const run = await ctx.db.screeningRun.findFirst({
        where: { id: input.runId, userId: ctx.session.user.id },
      });
      if (!run) throw new TRPCError({ code: "NOT_FOUND", message: "筛选运行不存在" });
      let afterRank = 0;
      if (input.cursor) {
        try {
          const decoded = JSON.parse(Buffer.from(input.cursor, "base64url").toString("utf8")) as { runId: string; rank: number };
          if (decoded.runId !== run.id || !Number.isInteger(decoded.rank)) throw new Error("invalid cursor");
          afterRank = decoded.rank;
        } catch {
          throw new TRPCError({ code: "BAD_REQUEST", message: "无效的结果游标" });
        }
      }
      const rows = await ctx.db.screeningRunResult.findMany({
        where: { runId: run.id, rank: { gt: afterRank } },
        orderBy: { rank: "asc" },
        take: 101,
      });
      const page = rows.slice(0, 100);
      const last = page.at(-1);
      return {
        runId: run.id,
        status: run.status,
        totalCount: run.totalCount ?? 0,
        items: page.map((row) => ({ stockCode: row.stockCode, rank: row.rank })),
        nextCursor: rows.length > 100 && last
          ? Buffer.from(JSON.stringify({ runId: run.id, rank: last.rank }), "utf8").toString("base64url")
          : null,
        warnings: run.warnings,
        currentDataNotice: "名单来自运行时结果，指标值按当前最新财报数据加载，财报更正后可能与当时判定不同。",
      };
    }),
});
