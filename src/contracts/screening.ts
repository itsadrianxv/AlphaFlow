import { z } from "zod";

export const stockCodeSchema = z
  .string()
  .regex(/^\d{6}$/, "股票代码必须为 6 位数字");

export const searchStocksInputSchema = z.object({
  keyword: z.string().trim().min(1, "keyword 不能为空"),
  limit: z.number().int().min(1).max(20).default(20),
});

export const searchStockResultSchema = z.object({
  stockCode: stockCodeSchema,
  stockName: z.string().min(1),
  market: z.string().min(1),
  matchField: z.enum(["CODE", "NAME"]),
});

export const indicatorValueTypeSchema = z.enum([
  "NUMBER",
  "PERCENT",
  "CURRENCY",
  "TEXT",
]);

export const indicatorPeriodScopeSchema = z.enum(["series", "latest_only"]);

export const indicatorRetrievalModeSchema = z.enum([
  "statement_series",
  "latest_only",
  "formula",
]);

export const indicatorCatalogItemSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  categoryId: z.string().min(1),
  valueType: indicatorValueTypeSchema,
  periodScope: indicatorPeriodScopeSchema,
  retrievalMode: indicatorRetrievalModeSchema,
  description: z.string().optional(),
});

export const indicatorCategorySchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  description: z.string().optional(),
  indicatorCount: z.number().int().nonnegative().default(0),
});

export const customFormulaSpecSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  expression: z.string().trim().min(1),
  targetIndicators: z.array(z.string().min(1)).max(5),
  description: z.string().optional(),
  categoryId: z.string().min(1),
  createdAt: z.string().optional(),
  updatedAt: z.string().optional(),
});

export const createFormulaInputSchema = z.object({
  name: z.string().trim().min(1, "公式名称不能为空"),
  expression: z.string().trim().min(1, "公式表达式不能为空"),
  targetIndicators: z
    .array(z.string().trim().min(1))
    .max(5, "最多只能绑定 5 个目标指标"),
  description: z.string().trim().optional(),
  categoryId: z.string().trim().min(1).default("custom"),
});

export const updateFormulaInputSchema = createFormulaInputSchema
  .partial()
  .extend({
    id: z.string().min(1),
  })
  .refine(
    (value) =>
      value.name !== undefined ||
      value.expression !== undefined ||
      value.targetIndicators !== undefined ||
      value.description !== undefined ||
      value.categoryId !== undefined,
    "至少需要提供一个待更新字段",
  );

export const validateFormulaInputSchema = z.object({
  expression: z.string().trim().min(1),
  targetIndicators: z.array(z.string().trim().min(1)).max(5),
});

export const workspacePeriodTypeSchema = z.enum(["ANNUAL", "QUARTERLY"]);
export const workspaceRangeModeSchema = z.enum(["PRESET", "CUSTOM"]);

export const workspaceAnnualPresetSchema = z.enum(["1Y", "3Y", "5Y"]);
export const workspaceQuarterlyPresetSchema = z.enum(["4Q", "8Q", "12Q"]);
export const workspacePresetSchema = z.enum([
  "1Y",
  "3Y",
  "5Y",
  "4Q",
  "8Q",
  "12Q",
]);

export const workspaceTimeConfigSchema = z
  .object({
    periodType: workspacePeriodTypeSchema,
    rangeMode: workspaceRangeModeSchema,
    presetKey: workspacePresetSchema.optional(),
    customStart: z.string().trim().min(1).optional(),
    customEnd: z.string().trim().min(1).optional(),
  })
  .superRefine((value, ctx) => {
    if (value.rangeMode === "PRESET") {
      if (!value.presetKey) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["presetKey"],
          message: "预设模式需要 presetKey",
        });
        return;
      }

      const allowedPresets =
        value.periodType === "ANNUAL"
          ? workspaceAnnualPresetSchema.options
          : workspaceQuarterlyPresetSchema.options;

      if (!allowedPresets.includes(value.presetKey as never)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["presetKey"],
          message: "presetKey 与 periodType 不匹配",
        });
      }
    }

    if (value.rangeMode === "CUSTOM") {
      if (!value.customStart) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["customStart"],
          message: "自定义范围需要 customStart",
        });
      }

      if (!value.customEnd) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["customEnd"],
          message: "自定义范围需要 customEnd",
        });
      }
    }
  });

export const workspaceQuerySchema = z.object({
  stockCodes: z.array(stockCodeSchema).min(1).max(20),
  indicatorIds: z.array(z.string().min(1)),
  formulaIds: z.array(z.string().min(1)).default([]),
  timeConfig: workspaceTimeConfigSchema,
});

export const workspaceFilterOperatorSchema = z.enum([
  ">",
  ">=",
  "<",
  "<=",
  "=",
  "!=",
]);

export const workspaceFilterValueTypeSchema = z.enum(["NUMBER", "TEXT"]);
export const workspaceFilterApplyScopeSchema = z.enum(["LATEST_DEFAULT"]);

export const workspaceFilterRuleSchema = z.object({
  metricId: z.string().min(1),
  operator: workspaceFilterOperatorSchema,
  value: z.union([z.number(), z.string()]),
  valueType: workspaceFilterValueTypeSchema,
  applyScope: workspaceFilterApplyScopeSchema,
});

export const workspaceSortDirectionSchema = z.enum(["asc", "desc"]);

export const workspaceSortStateSchema = z.object({
  metricId: z.string().min(1),
  direction: workspaceSortDirectionSchema,
});

export const workspaceColumnStateSchema = z.object({
  hiddenMetricIds: z.array(z.string().min(1)).default([]),
  pinnedMetricIds: z.array(z.string().min(1)).default([]),
});

export const workspaceMetricPeriodValueSchema = z.object({
  byPeriod: z.record(z.string(), z.union([z.number(), z.string(), z.null()])),
});

export const workspaceMetricLatestValueSchema = z.object({
  value: z.union([z.number(), z.string(), z.null()]),
  period: z.string().min(1).nullable().optional(),
});

export const workspaceResultIndicatorMetaSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  valueType: indicatorValueTypeSchema,
  periodScope: indicatorPeriodScopeSchema,
  retrievalMode: indicatorRetrievalModeSchema,
});

export const workspaceResultRowSchema = z.object({
  stockCode: stockCodeSchema,
  stockName: z.string().min(1),
  metrics: z.record(z.string(), workspaceMetricPeriodValueSchema),
});

export const workspaceLatestSnapshotRowSchema = z.object({
  stockCode: stockCodeSchema,
  stockName: z.string().min(1),
  metrics: z.record(z.string(), workspaceMetricLatestValueSchema),
});

export const workspaceResultSchema = z.object({
  periods: z.array(z.string()),
  indicatorMeta: z.array(workspaceResultIndicatorMetaSchema),
  rows: z.array(workspaceResultRowSchema),
  latestSnapshotRows: z.array(workspaceLatestSnapshotRowSchema),
  warnings: z.array(z.string()).default([]),
  dataStatus: z.enum(["READY", "PARTIAL", "EMPTY", "ERROR"]),
  provider: z.string().min(1),
});

export const workspacePersistedStateSchema = z.object({
  stockCodes: z.array(stockCodeSchema).max(20),
  indicatorIds: z.array(z.string().min(1)).default([]),
  formulaIds: z.array(z.string().min(1)).default([]),
  timeConfig: workspaceTimeConfigSchema,
  filterRules: z.array(workspaceFilterRuleSchema).default([]),
  sortState: workspaceSortStateSchema.nullable().optional(),
  columnState: workspaceColumnStateSchema.default({
    hiddenMetricIds: [],
    pinnedMetricIds: [],
  }),
  resultSnapshot: workspaceResultSchema.nullable().optional(),
  lastFetchedAt: z.string().optional(),
});

export const createWorkspaceInputSchema = z.object({
  name: z.string().trim().min(1, "工作台名称不能为空"),
  description: z.string().trim().optional(),
  stockCodes: z.array(stockCodeSchema).max(20).default([]),
  indicatorIds: z.array(z.string().min(1)).default([]),
  formulaIds: z.array(z.string().min(1)).default([]),
  timeConfig: workspaceTimeConfigSchema,
  filterRules: z.array(workspaceFilterRuleSchema).default([]),
  sortState: workspaceSortStateSchema.nullable().optional(),
  columnState: workspaceColumnStateSchema.default({
    hiddenMetricIds: [],
    pinnedMetricIds: [],
  }),
  resultSnapshot: workspaceResultSchema.nullable().optional(),
  lastFetchedAt: z.string().optional(),
});

export const updateWorkspaceInputSchema = createWorkspaceInputSchema
  .partial()
  .extend({
    id: z.string().min(1),
  })
  .refine(
    (value) =>
      value.name !== undefined ||
      value.description !== undefined ||
      value.stockCodes !== undefined ||
      value.indicatorIds !== undefined ||
      value.formulaIds !== undefined ||
      value.timeConfig !== undefined ||
      value.filterRules !== undefined ||
      value.sortState !== undefined ||
      value.columnState !== undefined ||
      value.resultSnapshot !== undefined ||
      value.lastFetchedAt !== undefined,
    "至少需要提供一个待更新字段",
  );

export const listWorkspacesInputSchema = z.object({
  limit: z.number().int().min(1).max(100).default(20),
  offset: z.number().int().min(0).default(0),
});

export const workspaceSummarySchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  description: z.string().nullable().optional(),
  stockCount: z.number().int().nonnegative(),
  indicatorCount: z.number().int().nonnegative(),
  formulaCount: z.number().int().nonnegative(),
  lastFetchedAt: z.string().nullable().optional(),
  updatedAt: z.string(),
  createdAt: z.string(),
});

export const workspaceDetailSchema = workspaceSummarySchema.extend({
  state: workspacePersistedStateSchema,
});

export const deleteWorkspaceInputSchema = z.object({
  id: z.string().min(1),
});

export const listFormulasInputSchema = z.object({
  limit: z.number().int().min(1).max(100).default(100),
  offset: z.number().int().min(0).default(0),
});

export type SearchStocksInput = z.infer<typeof searchStocksInputSchema>;
export type SearchStockResult = z.infer<typeof searchStockResultSchema>;
export type IndicatorCatalogItem = z.infer<typeof indicatorCatalogItemSchema>;
export type IndicatorCategory = z.infer<typeof indicatorCategorySchema>;
export type CustomFormulaSpec = z.infer<typeof customFormulaSpecSchema>;
export type WorkspaceTimeConfig = z.infer<typeof workspaceTimeConfigSchema>;
export type WorkspaceQuery = z.infer<typeof workspaceQuerySchema>;
export type WorkspaceFilterRule = z.infer<typeof workspaceFilterRuleSchema>;
export type WorkspaceResult = z.infer<typeof workspaceResultSchema>;
export type WorkspacePersistedState = z.infer<
  typeof workspacePersistedStateSchema
>;
export type CreateWorkspaceInput = z.infer<typeof createWorkspaceInputSchema>;
export type UpdateWorkspaceInput = z.infer<typeof updateWorkspaceInputSchema>;
export type CreateFormulaInput = z.infer<typeof createFormulaInputSchema>;
export type UpdateFormulaInput = z.infer<typeof updateFormulaInputSchema>;
