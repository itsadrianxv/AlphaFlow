export function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function truncateText(value: string, maxLength: number) {
  if (value.length <= maxLength) {
    return value;
  }

  return `${value.slice(0, maxLength)}...[truncated]`;
}

export function summarizeValue(value: unknown, maxLength = 1800) {
  const text =
    typeof value === "string" ? value : JSON.stringify(value, null, 2);

  return {
    preview: truncateText(text ?? "", maxLength),
  };
}

export function asJsonObject(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}
