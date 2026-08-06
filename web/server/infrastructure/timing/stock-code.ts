/** 将业务层六位股票代码转换为 Timing 服务使用的 TuShare ts_code。 */
export function toTimingStockCode(stockCode: string): string {
  const normalized = stockCode.trim().toUpperCase();
  if (normalized.includes(".")) return normalized;
  if (!/^\d{6}$/.test(normalized)) return normalized;

  const suffix = /^(4|8)/.test(normalized)
    ? "BJ"
    : /^(5|6|9)/.test(normalized)
      ? "SH"
      : "SZ";
  return `${normalized}.${suffix}`;
}
