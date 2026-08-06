import type { ResearchPreferenceImportCandidate } from "~/contracts/research-preference";

export type FavoriteStockOption = {
  stockCode: string;
  stockName: string;
  market: string;
  sources: string[];
};

export function inferStockMarket(stockCode: string) {
  if (/^(4|8)/.test(stockCode)) return "BJ";
  if (/^(5|6|9)/.test(stockCode)) return "SH";
  return "SZ";
}

export function buildFavoriteStockOptions(
  candidates: ResearchPreferenceImportCandidate[],
): FavoriteStockOption[] {
  return candidates
    .filter(
      (candidate) =>
        candidate.targetType === "COMPANY" &&
        /^\d{6}$/.test(candidate.targetKey),
    )
    .map((candidate) => ({
      stockCode: candidate.targetKey,
      stockName: candidate.label,
      market: inferStockMarket(candidate.targetKey),
      sources: candidate.sources.map((source) =>
        source.source === "SAVED_COMPANY"
          ? "收藏公司"
          : source.name
            ? `自选股 · ${source.name}`
            : "自选股",
      ),
    }));
}
