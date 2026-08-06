import { z } from "zod";
import {
  type DeterministicExecutionPlan,
  deterministicExecutionPlanSchema,
  scheduledTaskOutputSpecSchema,
  scheduleSpecSchema,
} from "~/server/domain/scheduled-task/contracts";
import { validateScheduleSpec } from "~/server/domain/scheduled-task/schedule";

const timeframeSchema = z.enum(["daily", "weekly", "monthly"]);
const allowedOperators = new Set([
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
const builtinMetrics = new Set([
  "open",
  "high",
  "low",
  "close",
  "volume",
  "amount",
  "candle.direction",
]);
const indicatorOutputs = {
  macd: new Set(["dif", "dea", "histogram"]),
  kdj: new Set(["k", "d", "j"]),
} as const;

const scoringBuilderDeliverySchema = z.union([
  z.object({ type: z.literal("SAVE_ONLY") }).strict(),
  z
    .object({
      type: z.literal("FEISHU"),
      targetRef: z
        .string()
        .regex(/^[a-z0-9][a-z0-9_-]{0,62}$/)
        .optional(),
      webhookUrl: z.string().trim().min(1).optional(),
      maskedWebhook: z.string().optional(),
    })
    .strict()
    .refine((value) => value.targetRef || value.webhookUrl, {
      message: "请输入飞书官方 Webhook",
    }),
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
        scoreDelta: z.number().finite(),
        condition: z.unknown(),
      }),
    )
    .min(1)
    .max(50),
  selection: z.object({
    minScore: z.number().finite(),
    limit: z.number().int().min(1).max(5000),
  }),
  output: scheduledTaskOutputSpecSchema,
  delivery: scoringBuilderDeliverySchema,
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
    indicatorTypes: Map<string, "macd" | "kdj">;
    references: Map<string, Set<z.infer<typeof timeframeSchema>>>;
  },
): unknown {
  state.nodes += 1;
  if (depth > 8) state.issues.push(issue(path, "条件树最多 8 层"));
  if (state.nodes > 200 && state.nodes === 201)
    state.issues.push(issue(path, "评分草稿的条件节点最多 200 个"));
  if (!isRecord(value) || Object.keys(value).length !== 1) {
    state.issues.push(
      issue(path, "条件必须是只包含一个操作符的 JSONLogic 对象"),
    );
    return value;
  }
  const entry = Object.entries(value)[0];
  if (!entry) return value;
  const [operator, args] = entry;
  if (!allowedOperators.has(operator)) {
    state.issues.push(issue(path, `不支持的 JSONLogic 操作符: ${operator}`));
    return value;
  }
  const inspectChild = (child: unknown, childPath: string) => {
    if (isRecord(child)) inspectCondition(child, childPath, depth + 1, state);
  };
  if (operator === "var") {
    if (typeof args !== "string" || !args.includes(".")) {
      state.issues.push(issue(`${path}.var`, "var 必须是快照路径字符串"));
      return value;
    }
    const parts = args.split(".");
    const timeframe = timeframeSchema.safeParse(parts[0]);
    if (!timeframe.success) {
      state.issues.push(
        issue(`${path}.var`, "快照路径必须以 daily、weekly 或 monthly 开头"),
      );
      return value;
    }
    const metric = parts
      .slice(1)
      .join(".")
      .replace(/\.(current|previous)$/, "");
    if (builtinMetrics.has(metric)) return value;
    const [indicatorId, output, ...rest] = metric.split(".");
    const indicatorType = state.indicatorTypes.get(indicatorId ?? "");
    if (rest.length || !indicatorType) {
      state.issues.push(issue(`${path}.var`, `未知指标字段: ${metric}`));
      return value;
    }
    if (!indicatorOutputs[indicatorType].has(output ?? "")) {
      state.issues.push(issue(`${path}.var`, `指标输出不存在: ${metric}`));
      return value;
    }
    state.metrics.get(indicatorType)?.add(timeframe.data);
    const referencedTimeframes =
      state.references.get(indicatorId ?? "") ?? new Set();
    referencedTimeframes.add(timeframe.data);
    state.references.set(indicatorId ?? "", referencedTimeframes);
    return value;
  }
  if (operator === "and" || operator === "or") {
    if (!Array.isArray(args) || args.length < 1 || args.length > 20)
      state.issues.push(
        issue(`${path}.${operator}`, "必须包含 1 至 20 个条件"),
      );
    else
      args.forEach((child, index) => {
        inspectChild(child, `${path}.${operator}.${index}`);
      });
    return value;
  }
  if (operator === "!") {
    if (!Array.isArray(args) || args.length !== 1)
      state.issues.push(issue(`${path}.!`, "必须包含一个条件"));
    else inspectChild(args[0], `${path}.!.0`);
    return value;
  }
  if (!Array.isArray(args) || args.length !== 2) {
    state.issues.push(issue(`${path}.${operator}`, "必须包含两个操作数"));
    return value;
  }
  if (operator === "cross_above" || operator === "cross_below") {
    const leftPath = isRecord(args[0]) ? args[0].var : undefined;
    const rightPath = isRecord(args[1]) ? args[1].var : undefined;
    if (
      typeof leftPath === "string" &&
      typeof rightPath === "string" &&
      leftPath.split(".")[0] !== rightPath.split(".")[0]
    )
      state.issues.push(
        issue(
          `${path}.${operator}`,
          "cross_above/cross_below 只支持同周期序列",
        ),
      );
  }
  args.forEach((child, index) => {
    inspectChild(child, `${path}.${operator}.${index}`);
  });
  return value;
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
    const state = {
      nodes: 0,
      issues,
      metrics,
      indicatorTypes: new Map<string, "macd" | "kdj">([
        ["macd", "macd"],
        ["kdj", "kdj"],
        ...parsed.data.indicators.map((item) => [item.id, item.type] as const),
      ]),
      references: new Map(),
    };
    parsed.data.rules.forEach((rule, index) => {
      inspectCondition(rule.condition, `rules.${index}.condition`, 1, state);
    });
    for (const [indicatorId, timeframes] of state.references) {
      const declaration = parsed.data.indicators.find(
        (item) => item.id === indicatorId,
      );
      for (const timeframe of timeframes) {
        if (!declaration?.timeframes.includes(timeframe))
          issues.push(
            issue(
              "indicators",
              `${indicatorId.toUpperCase()} 缺少 ${timeframe} 周期声明`,
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
    const conditionState = {
      nodes: 0,
      issues,
      metrics,
      indicatorTypes: new Map<string, "macd" | "kdj">([
        ["macd", "macd"],
        ["kdj", "kdj"],
      ]),
      references: new Map(),
    };
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
      schemaVersion: 2,
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
