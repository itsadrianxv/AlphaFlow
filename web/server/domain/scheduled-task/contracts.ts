import { z } from "zod";

export const scheduleSpecSchema = z.object({
  type: z.enum(["DAILY", "WEEKLY", "TRADING_DAY"]),
  time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  timezone: z.string().min(1).default("Asia/Shanghai"),
  weekdays: z.array(z.number().int().min(0).max(6)).optional(),
  marketCalendar: z.string().optional(),
  startAt: z.string().datetime().optional(),
  endAt: z.string().datetime().optional(),
});

export const scheduledDataSourceSchema = z.object({
  provider: z.string().min(1),
  capability: z.string().min(1),
  parameters: z.record(z.unknown()).default({}),
});

export const TUSHARE_STOCK_CODE_PATTERN = /^\d{6}\.(SH|SZ|BJ)$/;

export function validateTuShareStockCode(value: unknown) {
  if (typeof value !== "string" || !TUSHARE_STOCK_CODE_PATTERN.test(value)) {
    return "ts_code 必须是完整 TuShare 代码，例如 601138.SH、000001.SZ 或 920001.BJ";
  }
  return null;
}

const agentReportOutputSpecSchema = z
  .object({
    format: z.enum(["MARKDOWN", "JSON"]).default("MARKDOWN"),
    includeEvidence: z.boolean().default(true),
    detailLevel: z.enum(["BRIEF", "STANDARD", "DETAILED"]).default("STANDARD"),
    sendOnEmpty: z.boolean().default(true),
  })
  .strict();

const scoringReportOutputSpecSchema = z
  .object({
    type: z.literal("SCORING_REPORT"),
    feishuSummaryLimit: z.number().int().min(1).max(50).default(20),
    sendOnEmpty: z.boolean().default(true),
  })
  .strict();

export const scheduledTaskOutputSpecSchema = z.union([
  agentReportOutputSpecSchema,
  scoringReportOutputSpecSchema,
]);

const timeframeSchema = z.enum(["daily", "weekly", "monthly"]);
const metricPattern = /^[a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_]*)?$/;

const atomicConditionSchema = z
  .object({
    timeframe: timeframeSchema,
    metric: z.string().regex(metricPattern),
    operator: z.enum([
      "gt",
      "gte",
      "lt",
      "lte",
      "eq",
      "ne",
      "between",
      "cross_above",
      "cross_below",
    ]),
    value: z.union([
      z.string(),
      z.number().finite(),
      z.boolean(),
      z.tuple([z.number().finite(), z.number().finite()]),
    ]),
  })
  .strict();

type ConditionInput =
  | z.infer<typeof atomicConditionSchema>
  | { all: ConditionInput[] }
  | { any: ConditionInput[] }
  | { not: ConditionInput };

const conditionSchema: z.ZodType<ConditionInput> = z.lazy(() =>
  z.union([
    atomicConditionSchema,
    z.object({ all: z.array(conditionSchema).min(1).max(20) }).strict(),
    z.object({ any: z.array(conditionSchema).min(1).max(20) }).strict(),
    z.object({ not: conditionSchema }).strict(),
  ]),
);

const indicatorIdSchema = z.string().regex(/^[a-z][a-z0-9_]{0,63}$/);
const indicatorSchema = z.discriminatedUnion("type", [
  z
    .object({
      id: indicatorIdSchema,
      type: z.literal("macd"),
      timeframes: z.array(timeframeSchema).min(1).max(3),
      params: z
        .object({
          fast: z.number().int().min(2).max(200).default(12),
          slow: z.number().int().min(3).max(400).default(26),
          signal: z.number().int().min(2).max(200).default(9),
        })
        .strict()
        .default({}),
    })
    .strict(),
  z
    .object({
      id: indicatorIdSchema,
      type: z.literal("kdj"),
      timeframes: z.array(timeframeSchema).min(1).max(3),
      params: z
        .object({
          period: z.number().int().min(2).max(200).default(9),
          kSmoothing: z.number().int().min(1).max(50).default(3),
          dSmoothing: z.number().int().min(1).max(50).default(3),
        })
        .strict()
        .default({}),
    })
    .strict(),
]);

export const deterministicExecutionPlanSchema = z
  .object({
    schemaVersion: z.literal(1),
    type: z.literal("deterministic_scoring"),
    universe: z.discriminatedUnion("type", [
      z
        .object({
          type: z.literal("stocks"),
          stockCodes: z
            .array(z.string().regex(/^\d{6}$/))
            .min(1)
            .max(5000),
        })
        .strict(),
      z.object({ type: z.literal("all_a_shares") }).strict(),
    ]),
    data: z
      .object({ adjustment: z.enum(["qfq", "hfq", "none"]).default("qfq") })
      .strict()
      .default({}),
    indicators: z.array(indicatorSchema).max(20).default([]),
    rules: z
      .array(
        z
          .object({
            id: indicatorIdSchema,
            name: z.string().trim().min(1).max(120),
            condition: conditionSchema,
            points: z.number().finite().nonnegative(),
          })
          .strict(),
      )
      .min(1)
      .max(50),
    selection: z
      .object({
        minScore: z.number().finite().nonnegative().default(0),
        limit: z.number().int().min(1).max(5000).default(100),
      })
      .strict()
      .default({}),
  })
  .strict()
  .superRefine((value, ctx) => {
    for (const [index, indicator] of value.indicators.entries()) {
      if (
        indicator.type === "macd" &&
        indicator.params.fast >= indicator.params.slow
      )
        ctx.addIssue({
          code: "custom",
          path: ["indicators", index, "params", "fast"],
          message: "MACD fast 必须小于 slow",
        });
    }
    for (const [path, ids] of [
      [["indicators"], value.indicators.map((item) => item.id)],
      [["rules"], value.rules.map((item) => item.id)],
    ] as const) {
      if (new Set(ids).size !== ids.length)
        ctx.addIssue({ code: "custom", path: [...path], message: "id 不能重复" });
    }
  });

export const scheduledTaskDeliverySpecSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("SAVE_ONLY") }).strict(),
  z
    .object({
      type: z.literal("FEISHU"),
      targetRef: z.string().regex(/^[a-z0-9][a-z0-9_-]{0,62}$/),
    })
    .strict(),
]);

export const scheduledTaskStructuredEditSchema = z.object({
  name: z.string().trim().min(1).max(200),
  schedule: scheduleSpecSchema,
  output: scheduledTaskOutputSpecSchema,
  delivery: scheduledTaskDeliverySpecSchema,
});

export const scheduledTaskDraftInputSchema = z.object({
  name: z.string().trim().min(1).max(200),
  userPrompt: z.string().trim().min(1).max(10000),
  schedule: scheduleSpecSchema,
  dataSources: z.array(scheduledDataSourceSchema).min(1),
  output: scheduledTaskOutputSpecSchema,
  delivery: scheduledTaskDeliverySpecSchema,
  executionPlan: deterministicExecutionPlanSchema.optional(),
});

export type ScheduledTaskDraftInput = z.infer<
  typeof scheduledTaskDraftInputSchema
>;
export type ScheduledTaskDeliverySpec = z.infer<
  typeof scheduledTaskDeliverySpecSchema
>;
export type DeterministicExecutionPlan = z.infer<
  typeof deterministicExecutionPlanSchema
>;
