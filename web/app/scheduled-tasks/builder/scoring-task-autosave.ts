type AutosaveSchedule = {
  type?: unknown;
  time?: unknown;
  timezone?: unknown;
  weekdays?: unknown;
};

type AutosaveUniverse =
  | { type: "all_a_shares" }
  | { type: "stocks"; stockInputs: readonly string[] };

type AutosaveDelivery =
  | { type: "SAVE_ONLY" }
  | {
      type: "FEISHU";
      targetRef?: string;
      webhookUrl?: string;
    };

export type ScoringDraftAutosaveInput = {
  name: unknown;
  rules: ReadonlyArray<{
    name: unknown;
    scoreDelta?: unknown;
    condition?: unknown;
  }>;
  universe: AutosaveUniverse;
  delivery: AutosaveDelivery;
  schedule?: AutosaveSchedule;
  indicatorParams?: {
    macd?: { fast?: unknown; slow?: unknown; signal?: unknown };
    kdj?: {
      period?: unknown;
      kSmoothing?: unknown;
      dSmoothing?: unknown;
    };
  };
  selection?: { minScore?: unknown; limit?: unknown };
  output?: { type?: unknown; feishuSummaryLimit?: unknown };
};

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isIntegerInRange(value: unknown, min: number, max: number) {
  return (
    isFiniteNumber(value) &&
    Number.isInteger(value) &&
    value >= min &&
    value <= max
  );
}

function hasStockCode(value: string) {
  return /(?:^|\D)(\d{6})(?:\.(?:SH|SZ|BJ))?(?!\d)/i.test(value);
}

/**
 * 自动保存只提交已经具备可校验输入的草稿；显式保存仍负责展示完整校验错误。
 */
export function isScoringDraftReadyForAutosave(
  draft: ScoringDraftAutosaveInput,
) {
  if (typeof draft.name !== "string" || !draft.name.trim()) return false;
  if (
    draft.rules.length === 0 ||
    draft.rules.some(
      (rule) =>
        typeof rule.name !== "string" ||
        !rule.name.trim() ||
        (rule.scoreDelta !== undefined && !isFiniteNumber(rule.scoreDelta)),
    )
  )
    return false;

  if (
    draft.universe.type === "stocks" &&
    (draft.universe.stockInputs.length === 0 ||
      draft.universe.stockInputs.some(
        (input) => !input.trim() || !hasStockCode(input),
      ))
  )
    return false;

  if (draft.schedule) {
    if (
      typeof draft.schedule.time !== "string" ||
      !/^([01]\d|2[0-3]):[0-5]\d$/.test(draft.schedule.time) ||
      typeof draft.schedule.timezone !== "string" ||
      !draft.schedule.timezone.trim()
    )
      return false;
    if (
      draft.schedule.type === "WEEKLY" &&
      (!Array.isArray(draft.schedule.weekdays) ||
        draft.schedule.weekdays.length === 0)
    )
      return false;
  }

  const macd = draft.indicatorParams?.macd;
  if (
    macd &&
    (!isIntegerInRange(macd.fast, 2, 200) ||
      !isIntegerInRange(macd.slow, 3, 400) ||
      !isIntegerInRange(macd.signal, 2, 200) ||
      (isFiniteNumber(macd.fast) &&
        isFiniteNumber(macd.slow) &&
        macd.fast >= macd.slow))
  )
    return false;
  const kdj = draft.indicatorParams?.kdj;
  if (
    kdj &&
    (!isIntegerInRange(kdj.period, 2, 200) ||
      !isIntegerInRange(kdj.kSmoothing, 1, 50) ||
      !isIntegerInRange(kdj.dSmoothing, 1, 50))
  )
    return false;

  if (
    draft.selection &&
    (!isFiniteNumber(draft.selection.minScore) ||
      !isIntegerInRange(draft.selection.limit, 1, 5000))
  )
    return false;
  if (
    draft.output &&
    (draft.output.type !== "SCORING_REPORT" ||
      !isIntegerInRange(draft.output.feishuSummaryLimit, 1, 50))
  )
    return false;

  return (
    draft.delivery.type === "SAVE_ONLY" ||
    Boolean(
      draft.delivery.targetRef?.trim() || draft.delivery.webhookUrl?.trim(),
    )
  );
}
