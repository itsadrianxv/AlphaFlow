import { z } from "zod";
import {
  type DeterministicExecutionPlan,
  deterministicExecutionPlanSchema,
  scheduledTaskDeliverySpecSchema,
  scheduledTaskOutputSpecSchema,
  scheduleSpecSchema,
} from "~/server/domain/scheduled-task/contracts";
import { validateScheduleSpec } from "~/server/domain/scheduled-task/schedule";

const timeframeSchema = z.enum(["daily", "weekly", "monthly"]);
const operatorSchema = z.enum([
  "gt",
  "gte",
  "lt",
  "lte",
  "eq",
  "ne",
  "between",
  "cross_above",
  "cross_below",
]);

const scoringBuilderDraftSchema = z.object({
  name: z.string().trim().min(1).max(200),
  schedule: scheduleSpecSchema,
  universe: z.discriminatedUnion("type", [
    z.object({
      type: z.literal("stocks"),
      stockInputs: z.array(z.string()).min(1).max(5000),
    }),
    z.object({ type: z.literal("all_a_shares") }),
  ]),
  data: z.object({ adjustment: z.enum(["qfq", "hfq", "none"]).default("qfq") }),
  indicatorParams: z.object({
    macd: z.object({
      fast: z.number().int().min(2).max(200),
      slow: z.number().int().min(3).max(400),
      signal: z.number().int().min(2).max(200),
    }),
    kdj: z.object({
      period: z.number().int().min(2).max(200),
      kSmoothing: z.number().int().min(1).max(50),
      dSmoothing: z.number().int().min(1).max(50),
    }),
  }),
  rules: z
    .array(
      z.object({
        id: z.string().regex(/^[a-z][a-z0-9_]{0,63}$/),
        name: z.string().trim().min(1).max(120),
        points: z.number().finite().nonnegative(),
        condition: z.unknown(),
      }),
    )
    .min(1)
    .max(50),
  selection: z.object({
    minScore: z.number().finite().nonnegative(),
    limit: z.number().int().min(1).max(5000),
  }),
  output: scheduledTaskOutputSpecSchema,
  delivery: scheduledTaskDeliverySpecSchema,
});

export type ScoringBuilderDraftInput = z.input<
  typeof scoringBuilderDraftSchema
>;
export type ScoringBuilderDraft = z.output<typeof scoringBuilderDraftSchema>;

export type DraftValidationIssue = { path: string; message: string };

export type ValidatedScoringDraft = ScoringBuilderDraft & {
  executionPlan: DeterministicExecutionPlan;
};

type ValidationResult =
  | { valid: true; draft: ValidatedScoringDraft; issues: [] }
  | { valid: false; draft: null; issues: DraftValidationIssue[] };

const numericMetrics = new Set([
  "open",
  "high",
  "low",
  "close",
  "volume",
  "amount",
  "macd.dif",
  "macd.dea",
  "macd.histogram",
  "kdj.k",
  "kdj.d",
  "kdj.j",
]);
const directionValues = new Set(["bullish", "bearish", "doji"]);

function issue(path: string, message: string): DraftValidationIssue {
  return { path, message };
}

function normalizeStockInputs(values: string[]) {
  const stockCodes: string[] = [];
  const issues: DraftValidationIssue[] = [];
  const seen = new Set<string>();
  for (const [index, raw] of values.entries()) {
    const matched = raw
      .toUpperCase()
      .match(/(?:^|\D)(\d{6})(?:\.(?:SH|SZ|BJ))?(?!\d)/);
    const code = matched?.[1];
    if (!code) {
      issues.push(
        issue(
          `universe.stockInputs.${index}`,
          "请输入六位 A 股代码，可附带名称或交易所后缀",
        ),
      );
      continue;
    }
    if (!seen.has(code)) {
      seen.add(code);
      stockCodes.push(code);
    }
  }
  return { stockCodes, issues };
}

type AtomicCondition = {
  timeframe: z.infer<typeof timeframeSchema>;
  metric: string;
  operator: z.infer<typeof operatorSchema>;
  value: unknown;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function inspectCondition(
  value: unknown,
  path: string,
  depth: number,
  state: {
    nodes: number;
    issues: DraftValidationIssue[];
    metrics: Map<"macd" | "kdj", Set<z.infer<typeof timeframeSchema>>>;
  },
): unknown {
  state.nodes += 1;
  if (depth > 8) state.issues.push(issue(path, "条件树最多 8 层"));
  if (state.nodes > 200 && state.nodes === 201)
    state.issues.push(issue(path, "评分草稿的条件节点最多 200 个"));
  if (!isRecord(value)) {
    state.issues.push(issue(path, "条件必须是比较条件或 all、any、not 条件组"));
    return value;
  }

  const groupKeys = ["all", "any", "not"].filter((key) => key in value);
  if (groupKeys.length) {
    if (groupKeys.length !== 1 || Object.keys(value).length !== 1) {
      state.issues.push(issue(path, "条件组只能包含 all、any 或 not 中的一种"));
      return value;
    }
    const key = groupKeys[0] as "all" | "any" | "not";
    if (key === "not")
      return {
        not: inspectCondition(value.not, `${path}.not`, depth + 1, state),
      };
    const children = value[key];
    if (
      !Array.isArray(children) ||
      children.length === 0 ||
      children.length > 20
    ) {
      state.issues.push(
        issue(`${path}.${key}`, "条件组需要包含 1 至 20 个条件"),
      );
      return value;
    }
    return {
      [key]: children.map((child, index) =>
        inspectCondition(child, `${path}.${key}.${index}`, depth + 1, state),
      ),
    };
  }

  const timeframe = timeframeSchema.safeParse(value.timeframe);
  const operator = operatorSchema.safeParse(value.operator);
  const metric = typeof value.metric === "string" ? value.metric : "";
  if (!timeframe.success)
    state.issues.push(issue(`${path}.timeframe`, "不支持的行情周期"));
  if (!operator.success)
    state.issues.push(issue(`${path}.operator`, "不支持的操作符"));
  if (!numericMetrics.has(metric) && metric !== "candle.direction")
    state.issues.push(issue(`${path}.metric`, "不支持的指标"));

  if (metric === "candle.direction") {
    if (!operator.success || !["eq", "ne"].includes(operator.data))
      state.issues.push(
        issue(`${path}.operator`, "K 线方向只支持等于或不等于"),
      );
    if (typeof value.value !== "string" || !directionValues.has(value.value))
      state.issues.push(
        issue(`${path}.value`, "K 线方向必须是 bullish、bearish 或 doji"),
      );
  } else if (numericMetrics.has(metric) && operator.success) {
    const validValue =
      operator.data === "between"
        ? Array.isArray(value.value) &&
          value.value.length === 2 &&
          value.value.every(
            (item) => typeof item === "number" && Number.isFinite(item),
          )
        : typeof value.value === "number" && Number.isFinite(value.value);
    if (!validValue)
      state.issues.push(
        issue(
          `${path}.value`,
          operator.data === "between"
            ? "between 需要两个有限数值"
            : "该指标需要有限数值",
        ),
      );
  }

  if (
    timeframe.success &&
    (metric.startsWith("macd.") || metric.startsWith("kdj."))
  ) {
    const kind = metric.startsWith("macd.") ? "macd" : "kdj";
    state.metrics.get(kind)?.add(timeframe.data);
  }
  return {
    timeframe: timeframe.success ? timeframe.data : "daily",
    metric,
    operator: operator.success ? operator.data : "eq",
    value: value.value,
  } satisfies AtomicCondition;
}

export class ScheduledTaskDraftController {
  validateExecutionPlan(input: unknown) {
    const parsed = deterministicExecutionPlanSchema.safeParse(input);
    if (!parsed.success)
      return {
        valid: false as const,
        normalizedPlan: null,
        issues: parsed.error.issues.map((item) =>
          issue(item.path.join("."), item.message),
        ),
      };
    const issues: DraftValidationIssue[] = [];
    const metrics = new Map<
      "macd" | "kdj",
      Set<z.infer<typeof timeframeSchema>>
    >([
      ["macd", new Set()],
      ["kdj", new Set()],
    ]);
    const state = { nodes: 0, issues, metrics };
    parsed.data.rules.forEach((rule, index) => {
      inspectCondition(rule.condition, `rules.${index}.condition`, 1, state);
    });
    for (const type of ["macd", "kdj"] as const) {
      const declaration = parsed.data.indicators.find(
        (item) => item.type === type,
      );
      for (const timeframe of metrics.get(type) ?? []) {
        if (!declaration?.timeframes.includes(timeframe))
          issues.push(
            issue(
              "indicators",
              `${type.toUpperCase()} 缺少 ${timeframe} 周期声明`,
            ),
          );
      }
    }
    return issues.length
      ? { valid: false as const, normalizedPlan: null, issues }
      : { valid: true as const, normalizedPlan: parsed.data, issues: [] };
  }

  validate(input: unknown): ValidationResult {
    const parsed = scoringBuilderDraftSchema.safeParse(input);
    if (!parsed.success) {
      return {
        valid: false,
        draft: null,
        issues: parsed.error.issues.map((item) =>
          issue(item.path.join("."), item.message),
        ),
      };
    }
    const draft = parsed.data;
    const issues = validateScheduleSpec(draft.schedule).map((message) =>
      issue("schedule", message),
    );
    if (draft.indicatorParams.macd.fast >= draft.indicatorParams.macd.slow)
      issues.push(
        issue("indicatorParams.macd.fast", "MACD fast 必须小于 slow"),
      );
    if (new Set(draft.rules.map((rule) => rule.id)).size !== draft.rules.length)
      issues.push(issue("rules", "规则 id 不能重复"));

    const universe =
      draft.universe.type === "all_a_shares"
        ? ({ type: "all_a_shares" } as const)
        : (() => {
            const normalized = normalizeStockInputs(draft.universe.stockInputs);
            issues.push(...normalized.issues);
            if (normalized.stockCodes.length === 0)
              issues.push(
                issue("universe.stockInputs", "至少需要一个有效股票代码"),
              );
            return {
              type: "stocks" as const,
              stockCodes: normalized.stockCodes,
            };
          })();

    const metrics = new Map<
      "macd" | "kdj",
      Set<z.infer<typeof timeframeSchema>>
    >([
      ["macd", new Set()],
      ["kdj", new Set()],
    ]);
    const conditionState = { nodes: 0, issues, metrics };
    const conditions = draft.rules.map((rule, index) =>
      inspectCondition(
        rule.condition,
        `rules.${index}.condition`,
        1,
        conditionState,
      ),
    );
    const indicators = (["macd", "kdj"] as const).flatMap((type) => {
      const timeframes = [...(metrics.get(type) ?? [])];
      return timeframes.length
        ? [{ id: type, type, timeframes, params: draft.indicatorParams[type] }]
        : [];
    });
    if (indicators.length > 20)
      issues.push(issue("rules", "指标声明最多 20 个"));

    const planCandidate = {
      schemaVersion: 1,
      type: "deterministic_scoring",
      universe,
      data: draft.data,
      indicators,
      rules: draft.rules.map((rule, index) => ({
        ...rule,
        condition: conditions[index],
      })),
      selection: draft.selection,
    };
    const plan = deterministicExecutionPlanSchema.safeParse(planCandidate);
    if (!plan.success)
      for (const item of plan.error.issues) {
        const next = issue(item.path.join("."), item.message);
        if (
          !issues.some(
            (current) =>
              current.path === next.path && current.message === next.message,
          )
        )
          issues.push(next);
      }
    if ("type" in draft.output && draft.output.type !== "SCORING_REPORT")
      issues.push(issue("output", "确定性评分任务必须使用评分报告输出"));
    if (issues.length || !plan.success)
      return { valid: false, draft: null, issues };
    return {
      valid: true,
      issues: [],
      draft: { ...draft, executionPlan: plan.data },
    };
  }
}
