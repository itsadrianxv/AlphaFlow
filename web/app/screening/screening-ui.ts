import type {
  CustomFormulaSpec,
  IndicatorCatalogItem,
  IndicatorCategory,
  WorkspaceFilterRule,
  WorkspaceResult,
} from "~/contracts/screening";

export const annualPresetOptions = ["1Y", "3Y", "5Y"] as const;
export const quarterlyPresetOptions = ["4Q", "8Q", "12Q"] as const;

export type ResultColumn = {
  key: string;
  metricId: string;
  label: string;
  period: string | null;
};

export type CatalogNotice = {
  tone: "info" | "danger";
  description: string;
};

export type ResultMissingValueMode = "keep" | "hide";

type LatestSnapshotRow = WorkspaceResult["latestSnapshotRows"][number];

function compareBySortOrder(
  left: { sortOrder?: number; name: string },
  right: { sortOrder?: number; name: string },
) {
  const sortDifference = (left.sortOrder ?? 0) - (right.sortOrder ?? 0);
  if (sortDifference !== 0) {
    return sortDifference;
  }

  return left.name.localeCompare(right.name, "zh-CN");
}

function normalizeCatalogQuery(query: string) {
  return query.trim().toLocaleLowerCase("zh-CN");
}

function matchesCatalogQuery(item: IndicatorCatalogItem, query: string) {
  if (!query) {
    return true;
  }

  const haystacks = [item.name, item.id, ...(item.keywords ?? [])];
  return haystacks.some((value) =>
    value.toLocaleLowerCase("zh-CN").includes(query),
  );
}

function matchesStockQuery(row: LatestSnapshotRow, stockQuery: string) {
  if (!stockQuery) {
    return true;
  }

  const haystacks = [row.stockCode, row.stockName];
  return haystacks.some((value) =>
    value.toLocaleLowerCase("zh-CN").includes(stockQuery),
  );
}

function hasCompleteLatestValues(
  row: LatestSnapshotRow,
  result: WorkspaceResult,
) {
  return result.indicatorMeta.every((meta) => {
    const value = row.metrics[meta.id]?.value;
    return value !== null && value !== undefined;
  });
}

export function formatDateTime(value?: string | null) {
  if (!value) {
    return "未获取";
  }

  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

export function groupCatalogItems(params: {
  categories: IndicatorCategory[];
  items: IndicatorCatalogItem[];
}) {
  const itemMap = new Map<string, IndicatorCatalogItem[]>();

  for (const item of params.items) {
    const group = itemMap.get(item.categoryId) ?? [];
    group.push(item);
    itemMap.set(item.categoryId, group);
  }

  return [...params.categories]
    .sort(compareBySortOrder)
    .map((category) => ({
      ...category,
      items: [...(itemMap.get(category.id) ?? [])].sort(compareBySortOrder),
    }))
    .filter((category) => category.items.length > 0);
}

export function buildFormulaMetricOptions(params: {
  items: IndicatorCatalogItem[];
  query: string;
}) {
  const query = normalizeCatalogQuery(params.query);

  return [...params.items]
    .filter((item) => matchesCatalogQuery(item, query))
    .sort(compareBySortOrder);
}

export function buildCatalogNotice(params: {
  isLoading: boolean;
  errorMessage?: string | null;
  categories: IndicatorCategory[];
  items: IndicatorCatalogItem[];
}): CatalogNotice | null {
  if (params.isLoading) {
    return null;
  }

  const errorMessage = params.errorMessage?.trim();
  if (errorMessage) {
    return {
      tone: "danger",
      description: `官方指标目录加载失败：${errorMessage}`,
    };
  }

  if (params.categories.length === 0 || params.items.length === 0) {
    return {
      tone: "info",
      description:
        "官方指标目录当前为空，请检查 Python 服务的指标目录接口是否正常。",
    };
  }

  return null;
}

export function buildMetricNameMap(params: {
  catalogItems: IndicatorCatalogItem[];
  formulas: CustomFormulaSpec[];
  result: WorkspaceResult | null;
}) {
  const map = new Map<string, string>();

  for (const item of params.catalogItems) {
    map.set(item.id, item.name);
  }

  for (const formula of params.formulas) {
    map.set(formula.id, formula.name);
  }

  if (params.result) {
    for (const meta of params.result.indicatorMeta) {
      map.set(meta.id, meta.name);
    }
  }

  return map;
}

export function getLatestMetricValue(
  result: WorkspaceResult | null,
  stockCode: string,
  metricId: string,
) {
  if (!result) {
    return null;
  }

  const row = result.latestSnapshotRows.find(
    (item) => item.stockCode === stockCode,
  );
  return row?.metrics[metricId]?.value ?? null;
}

function compareValues(
  left: string | number | null | undefined,
  right: string | number | null | undefined,
) {
  if (left === null || left === undefined) {
    return right === null || right === undefined ? 0 : 1;
  }

  if (right === null || right === undefined) {
    return -1;
  }

  if (typeof left === "number" && typeof right === "number") {
    return left - right;
  }

  return String(left).localeCompare(String(right), "zh-CN");
}

function matchesFilter(
  candidateValue: string | number | null | undefined,
  filter: WorkspaceFilterRule,
) {
  if (candidateValue === null || candidateValue === undefined) {
    return false;
  }

  if (filter.valueType === "NUMBER") {
    const candidate = Number(candidateValue);
    const ruleValue = Number(filter.value);

    if (!Number.isFinite(candidate) || !Number.isFinite(ruleValue)) {
      return false;
    }

    switch (filter.operator) {
      case ">":
        return candidate > ruleValue;
      case ">=":
        return candidate >= ruleValue;
      case "<":
        return candidate < ruleValue;
      case "<=":
        return candidate <= ruleValue;
      case "=":
        return candidate === ruleValue;
      case "!=":
        return candidate !== ruleValue;
      default:
        return false;
    }
  }

  const candidate = String(candidateValue);
  const ruleValue = String(filter.value);
  switch (filter.operator) {
    case "=":
      return candidate === ruleValue;
    case "!=":
      return candidate !== ruleValue;
    default:
      return false;
  }
}

export function buildVisibleResultRows(params: {
  result: WorkspaceResult | null;
  filterRules: WorkspaceFilterRule[];
  stockQuery?: string;
  missingValueMode?: ResultMissingValueMode;
  sortState:
    | {
        metricId: string;
        direction: "asc" | "desc";
      }
    | null
    | undefined;
}): WorkspaceResult["latestSnapshotRows"] {
  if (!params.result) {
    return [];
  }

  const result = params.result;
  const normalizedStockQuery = normalizeCatalogQuery(params.stockQuery ?? "");
  const missingValueMode = params.missingValueMode ?? "keep";

  const filtered = result.latestSnapshotRows
    .filter((row) => matchesStockQuery(row, normalizedStockQuery))
    .filter((row) =>
      missingValueMode === "hide" ? hasCompleteLatestValues(row, result) : true,
    )
    .filter((row) =>
      params.filterRules.every((filter) =>
        matchesFilter(row.metrics[filter.metricId]?.value, filter),
      ),
    );

  if (!params.sortState) {
    return filtered;
  }

  const { metricId, direction } = params.sortState;
  return [...filtered].sort((left, right) => {
    const compared = compareValues(
      left.metrics[metricId]?.value,
      right.metrics[metricId]?.value,
    );
    return direction === "asc" ? compared : -compared;
  });
}

export function buildResultColumns(
  result: WorkspaceResult | null,
): ResultColumn[] {
  if (!result) {
    return [];
  }

  return result.indicatorMeta.flatMap<ResultColumn>((meta) => {
    if (meta.periodScope === "latest_only") {
      return [
        {
          key: `${meta.id}:latest`,
          metricId: meta.id,
          label: `${meta.name} 最新`,
          period: null,
        },
      ];
    }

    return result.periods.map((period) => ({
      key: `${meta.id}:${period}`,
      metricId: meta.id,
      label: `${meta.name} ${period}`,
      period,
    }));
  });
}
