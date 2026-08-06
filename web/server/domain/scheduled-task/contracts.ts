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
const jsonLogicOperators = new Set([
  "var",
  "==",
  "===",
  "!=",
  "!==",
  "<",
  "<=",
  ">",
  ">=",
  "and",
  "or",
  "!",
  "in",
  "cross_above",
  "cross_below",
]);

function validateJsonLogicNode(
  value: unknown,
  ctx: z.RefinementCtx,
  path: (string | number)[] = [],
  depth = 1,
  counter = { nodes: 0 },
  role: "condition" | "value" | "series" = "condition",
) {
  counter.nodes += 1;
  if (depth > 8 || counter.nodes > 200) {
    ctx.addIssue({
      code: "custom",
      path,
      message: "条件树最多 200 个节点且深度最多 8 层",
    });
    return;
  }
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).length !== 1
  ) {
    ctx.addIssue({
      code: "custom",
      path,
      message: "条件必须是只包含一个操作符的 JSONLogic 对象",
    });
    return;
  }
  const entry = Object.entries(value)[0];
  if (!entry) return;
  const [operator, args] = entry;
  if (!jsonLogicOperators.has(operator)) {
    ctx.addIssue({
      code: "custom",
      path,
      message: `不支持的 JSONLogic 操作符: ${operator}`,
    });
    return;
  }
  if (role !== "condition" && operator !== "var") {
    ctx.addIssue({ code: "custom", path, message: "操作数对象只能使用 var" });
    return;
  }
  if (operator === "var") {
    if (typeof args !== "string" || !args.includes(".")) {
      ctx.addIssue({
        code: "custom",
        path: [...path, "var"],
        message: "var 必须是快照路径字符串且不能设置默认值",
      });
    } else if (role === "condition") {
      ctx.addIssue({
        code: "custom",
        path: [...path, "var"],
        message: "var 不能直接作为条件",
      });
    } else if (role === "series" && /\.(current|previous)$/.test(args)) {
      ctx.addIssue({
        code: "custom",
        path: [...path, "var"],
        message: "cross 必须引用包含 current/previous 的序列对象",
      });
    } else if (role === "value" && !/\.(current|previous)$/.test(args)) {
      ctx.addIssue({
        code: "custom",
        path: [...path, "var"],
        message: "普通比较必须引用 current 或 previous 标量值",
      });
    }
    return;
  }
  if (operator === "and" || operator === "or") {
    if (!Array.isArray(args) || args.length < 1 || args.length > 20) {
      ctx.addIssue({
        code: "custom",
        path: [...path, operator],
        message: "必须包含 1 至 20 个条件",
      });
      return;
    }
    args.forEach((child, index) => {
      validateJsonLogicNode(
        child,
        ctx,
        [...path, operator, index],
        depth + 1,
        counter,
        "condition",
      );
    });
    return;
  }
  if (operator === "!") {
    if (!Array.isArray(args) || args.length !== 1) {
      ctx.addIssue({
        code: "custom",
        path: [...path, "!"],
        message: "必须包含一个条件",
      });
      return;
    }
    validateJsonLogicNode(
      args[0],
      ctx,
      [...path, "!", 0],
      depth + 1,
      counter,
      "condition",
    );
    return;
  }
  if (!Array.isArray(args) || args.length !== 2) {
    ctx.addIssue({
      code: "custom",
      path: [...path, operator],
      message: "必须包含两个操作数",
    });
    return;
  }
  args.forEach((child, index) => {
    if (child && typeof child === "object" && !Array.isArray(child))
      validateJsonLogicNode(
        child,
        ctx,
        [...path, operator, index],
        depth + 1,
        counter,
        operator === "cross_above" || operator === "cross_below"
          ? "series"
          : "value",
      );
  });
}

const conditionSchema = z
  .record(z.unknown())
  .superRefine((value, ctx) => validateJsonLogicNode(value, ctx));

function jsonLogicVarPaths(value: unknown): string[] {
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];
  const node = value as Record<string, unknown>;
  if (typeof node.var === "string") return [node.var];
  return Object.values(node).flatMap((item) =>
    Array.isArray(item)
      ? item.flatMap(jsonLogicVarPaths)
      : jsonLogicVarPaths(item),
  );
}

function jsonLogicCrossPairs(value: unknown): Array<[string, string]> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];
  const node = value as Record<string, unknown>;
  const pairs: Array<[string, string]> = [];
  for (const operator of ["cross_above", "cross_below"] as const) {
    const args = node[operator];
    if (Array.isArray(args)) {
      const left = args[0] as Record<string, unknown> | undefined;
      const right = args[1] as Record<string, unknown> | undefined;
      if (typeof left?.var === "string" && typeof right?.var === "string")
        pairs.push([left.var, right.var]);
    }
  }
  return [
    ...pairs,
    ...Object.values(node).flatMap((item) =>
      Array.isArray(item)
        ? item.flatMap(jsonLogicCrossPairs)
        : jsonLogicCrossPairs(item),
    ),
  ];
}

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
    schemaVersion: z.literal(2),
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
            scoreDelta: z.number().finite(),
          })
          .strict(),
      )
      .min(1)
      .max(50),
    selection: z
      .object({
        minScore: z.number().finite().default(0),
        limit: z.number().int().min(1).max(5000).default(100),
      })
      .strict()
      .default({}),
  })
  .strict()
  .superRefine((value, ctx) => {
    const indicators = new Map(value.indicators.map((item) => [item.id, item]));
    const builtins = new Set([
      "open",
      "high",
      "low",
      "close",
      "volume",
      "amount",
      "candle.direction",
    ]);
    const outputs = {
      macd: new Set(["dif", "dea", "histogram"]),
      kdj: new Set(["k", "d", "j"]),
    } as const;
    value.rules.forEach((rule, ruleIndex) => {
      for (const [left, right] of jsonLogicCrossPairs(rule.condition)) {
        if (left.split(".")[0] !== right.split(".")[0])
          ctx.addIssue({
            code: "custom",
            path: ["rules", ruleIndex, "condition"],
            message: "cross_above/cross_below 只支持同周期序列",
          });
      }
      for (const path of jsonLogicVarPaths(rule.condition)) {
        const parts = path.split(".");
        const timeframe = timeframeSchema.safeParse(parts.shift());
        const metric = parts.join(".").replace(/\.(current|previous)$/, "");
        const issuePath = ["rules", ruleIndex, "condition"];
        if (!timeframe.success) {
          ctx.addIssue({
            code: "custom",
            path: issuePath,
            message: `快照路径周期无效: ${path}`,
          });
          continue;
        }
        if (builtins.has(metric)) continue;
        const [indicatorId, output, ...rest] = metric.split(".");
        const indicator = indicators.get(indicatorId ?? "");
        if (rest.length || !indicator) {
          ctx.addIssue({
            code: "custom",
            path: issuePath,
            message: `未知指标字段: ${path}`,
          });
          continue;
        }
        if (!indicator.timeframes.includes(timeframe.data))
          ctx.addIssue({
            code: "custom",
            path: issuePath,
            message: `${indicatorId} 未声明 ${timeframe.data} 周期`,
          });
        if (!outputs[indicator.type].has(output ?? ""))
          ctx.addIssue({
            code: "custom",
            path: issuePath,
            message: `指标输出不存在: ${path}`,
          });
      }
    });
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
        ctx.addIssue({
          code: "custom",
          path: [...path],
          message: "id 不能重复",
        });
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
