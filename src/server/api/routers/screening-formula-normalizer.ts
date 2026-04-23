import type { IndicatorCatalogItem } from "~/modules/screening/contracts/screening";

type FormulaNormalizerParams = {
  expression: string;
  targetIndicatorIds: string[];
  catalogItems: readonly Pick<IndicatorCatalogItem, "id" | "name">[];
};

const SAFE_VAR_REFERENCE_PATTERN = /var\[\d+\]/g;
const PLACEHOLDER_PATTERN = /\[([^[\]]+)\]/g;

export function normalizeFormulaExpression(
  params: FormulaNormalizerParams,
): string {
  const trimmedExpression = params.expression.trim();
  const protectedVarReferences: string[] = [];
  const maskedExpression = trimmedExpression.replace(
    SAFE_VAR_REFERENCE_PATTERN,
    (match) => {
      const placeholder = `__SAFE_VAR_REF_${protectedVarReferences.length}__`;
      protectedVarReferences.push(match);
      return placeholder;
    },
  );

  if (!PLACEHOLDER_PATTERN.test(maskedExpression)) {
    return trimmedExpression;
  }

  const targetIndexByAlias = buildTargetIndexByAlias(
    params.targetIndicatorIds,
    params.catalogItems,
  );

  const normalizedExpression = maskedExpression.replace(
    PLACEHOLDER_PATTERN,
    (_match, token: string) => {
      const normalizedToken = token.trim();
      const targetIndex = targetIndexByAlias.get(normalizedToken);

      if (targetIndex === undefined) {
        throw new Error(`公式引用了未选择的目标指标：${normalizedToken}`);
      }

      return `var[${targetIndex}]`;
    },
  );

  return normalizedExpression.replace(
    /__SAFE_VAR_REF_(\d+)__/g,
    (_match, index: string) => protectedVarReferences[Number(index)] ?? _match,
  );
}

function buildTargetIndexByAlias(
  targetIndicatorIds: readonly string[],
  catalogItems: readonly Pick<IndicatorCatalogItem, "id" | "name">[],
) {
  const catalogById = new Map(
    catalogItems.map((item) => [item.id, item] as const),
  );
  const targetIndexByAlias = new Map<string, number>();

  targetIndicatorIds.forEach((indicatorId, index) => {
    const catalogItem = catalogById.get(indicatorId);

    if (!catalogItem) {
      throw new Error(`未找到目标指标：${indicatorId}`);
    }

    for (const alias of [indicatorId, catalogItem.name]) {
      const existingIndex = targetIndexByAlias.get(alias);

      if (existingIndex !== undefined && existingIndex !== index) {
        throw new Error(`目标指标存在重复标识，无法解析公式：${alias}`);
      }

      targetIndexByAlias.set(alias, index);
    }
  });

  return targetIndexByAlias;
}
