const EXECUTABLE_PATTERNS = [
  /(?:买入|卖出|买卖|持有|加仓|减仓|补仓|清仓|建仓|平仓)/i,
  /(?:仓位|头寸|position sizing|position size|position adjustment)/i,
  /(?:入场价|进场价|目标价|止损价|止盈价|price target|stop loss|entry price)/i,
  /(?:订单计划|下单计划|交易计划|执行计划|order plan|trade plan)/i,
  /(?:买多少|卖多少|配多少|几成仓|几层仓|几手|多少股)/i,
];

const EXECUTABLE_FIELD_NAMES = new Set([
  "action",
  "tradeAction",
  "orderPlan",
  "tradePlan",
  "position",
  "positionSize",
  "entryPrice",
  "targetPrice",
  "stopLossPrice",
]);

function hasForbiddenField(value: unknown): boolean {
  if (!value || typeof value !== "object") {
    return false;
  }
  if (Array.isArray(value)) {
    return value.some((item) => hasForbiddenField(item));
  }

  return Object.entries(value as Record<string, unknown>).some(
    ([key, item]) => {
      if (EXECUTABLE_FIELD_NAMES.has(key)) {
        return true;
      }
      return hasForbiddenField(item);
    },
  );
}

export function violatesResearchOnly(value: unknown) {
  const serialized =
    typeof value === "string" ? value : JSON.stringify(value ?? {});
  return (
    hasForbiddenField(value) ||
    EXECUTABLE_PATTERNS.some((pattern) => pattern.test(serialized))
  );
}
