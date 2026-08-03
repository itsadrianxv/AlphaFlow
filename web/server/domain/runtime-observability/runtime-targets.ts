export type RuntimeTargetSet = {
  sourceTargetMs: number | null;
  productTargetMs: number | null;
  deliveryTargetMs: number | null;
};

/** Spec §14 的私测初始目标；真实运行水位可在发布后校准，但不能静默省略观测。 */
export const RUNTIME_TARGETS = {
  dataSourceP95Ms: {
    closing_structure: 15 * 60_000,
    daily_indicators: 15 * 60_000,
    money_flow: 15 * 60_000,
    sell_side_expectation: 20 * 60_000,
    heat: 15 * 60_000,
    margin: 10 * 60_000,
    news: 2 * 60_000,
    announcement: 2 * 60_000,
    policy: 2 * 60_000,
    forward_calendar: 30 * 60_000,
  },
  productP95Ms: {
    INTERACTIVE_WAIT: 2_000,
    INSTANT_RESEARCH: 90_000,
    MATERIAL_NORMALIZATION: 30_000,
    EVENT_ADJUDICATION: 3 * 60_000,
    GLOBAL_ASSESSMENT: 3 * 60_000,
    USER_RELEVANCE: 3 * 60_000,
    INBOX_COMMIT: 30_000,
    BRIEFING_GENERATION: 5 * 60_000,
    FEISHU_FIRST_ATTEMPT: 30_000,
    FEISHU_SETTLED: 2 * 60_000,
    URGENT_INBOX: 10 * 60_000,
  },
} as const;

const datasetAliases: Record<
  string,
  keyof typeof RUNTIME_TARGETS.dataSourceP95Ms
> = {
  closing_structure: "closing_structure",
  daily: "closing_structure",
  index: "closing_structure",
  industry_structure: "closing_structure",
  daily_indicators: "daily_indicators",
  moneyflow: "money_flow",
  money_flow: "money_flow",
  dragon_tiger: "money_flow",
  sell_side: "sell_side_expectation",
  sell_side_expectation: "sell_side_expectation",
  heat: "heat",
  margin: "margin",
  news: "news",
  announcement: "announcement",
  policy: "policy",
  forward_calendar: "forward_calendar",
};

export function resolveRuntimeTargets(input: {
  dataset?: string | null;
  stage?: string | null;
  delivery?: boolean;
}): RuntimeTargetSet {
  const datasetKey = input.dataset
    ? datasetAliases[input.dataset.toLowerCase()]
    : undefined;
  const productKey = input.stage?.toUpperCase() as
    | keyof typeof RUNTIME_TARGETS.productP95Ms
    | undefined;
  const sourceTargetMs = datasetKey
    ? RUNTIME_TARGETS.dataSourceP95Ms[datasetKey]
    : null;
  const productTargetMs = productKey
    ? (RUNTIME_TARGETS.productP95Ms[productKey] ?? null)
    : null;
  const deliveryTargetMs = input.delivery
    ? productKey === "FEISHU_SETTLED"
      ? RUNTIME_TARGETS.productP95Ms.FEISHU_SETTLED
      : RUNTIME_TARGETS.productP95Ms.FEISHU_FIRST_ATTEMPT
    : null;
  return { sourceTargetMs, productTargetMs, deliveryTargetMs };
}
