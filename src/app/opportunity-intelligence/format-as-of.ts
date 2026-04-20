const LEGACY_DATE_RE = /^(\d{4})(\d{2})(\d{2})$/;
const LEGACY_MONTH_RE = /^(\d{4})(\d{2})$/;
const LEGACY_QUARTER_RE = /^(\d{4})-?Q([1-4])$/i;

function parseOpportunityAsOf(value: string) {
  const normalizedValue = value.trim();
  if (!normalizedValue) {
    return null;
  }

  const legacyDateMatch = normalizedValue.match(LEGACY_DATE_RE);
  if (legacyDateMatch) {
    const [, year, month, day] = legacyDateMatch;
    return new Date(
      Number(year),
      Number(month) - 1,
      Number(day),
      0,
      0,
      0,
      0,
    );
  }

  const legacyQuarterMatch = normalizedValue.match(LEGACY_QUARTER_RE);
  if (legacyQuarterMatch) {
    const [, year, quarter] = legacyQuarterMatch;
    return new Date(
      Number(year),
      Number(quarter) * 3,
      0,
      0,
      0,
      0,
      0,
    );
  }

  const legacyMonthMatch = normalizedValue.match(LEGACY_MONTH_RE);
  if (legacyMonthMatch) {
    const [, year, month] = legacyMonthMatch;
    return new Date(
      Number(year),
      Number(month),
      0,
      0,
      0,
      0,
      0,
    );
  }

  const parsed = new Date(normalizedValue);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }

  return parsed;
}

export function formatOpportunityAsOf(value: string) {
  const parsed = parseOpportunityAsOf(value);
  if (!parsed) {
    return "-";
  }

  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(parsed);
}
