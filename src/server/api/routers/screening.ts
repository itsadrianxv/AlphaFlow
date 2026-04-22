import { TRPCError } from "@trpc/server";
import { z } from "zod";
import {
  type CreateWorkspaceInput,
  createFormulaInputSchema,
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
import { PythonCapabilityGatewayClient } from "~/server/infrastructure/capabilities/python-capability-gateway-client";
import { LocalStockSearchService } from "~/server/infrastructure/screening/local-stock-search-service";

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
      new LocalStockSearchService().search(input.keyword, input.limit),
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
          message: "????????????",
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
          message: "??????",
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
          message: "??????",
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
          message: "??????",
        });
      }

      await db.screeningWorkspace.delete({
        where: { id: record.id },
      });

      return { success: true };
    }),
});
