import type {
  ResearchPreferenceImportCandidate,
  ResearchPreferenceImportCandidateSource,
} from "~/contracts/research-preference";

type ImportCandidateInput = {
  companies: Array<{ stockCode: string; companyName: string }>;
  industries: Array<{ source: string; name: string }>;
  watchLists: Array<{ name: string; stocks: unknown }>;
};

export function buildResearchPreferenceImportCandidates({
  companies,
  industries,
  watchLists,
}: ImportCandidateInput): ResearchPreferenceImportCandidate[] {
  const candidates = new Map<string, ResearchPreferenceImportCandidate>();

  for (const company of companies) {
    addCandidate(candidates, {
      targetType: "COMPANY",
      targetKey: company.stockCode.trim(),
      source: "SAVED_COMPANY",
      sources: [{ source: "SAVED_COMPANY" }],
      label: company.companyName.trim() || company.stockCode.trim(),
    });
  }

  for (const industry of industries) {
    const targetKey = `${industry.source.trim()}:${industry.name.trim()}`;
    addCandidate(candidates, {
      targetType: "INDUSTRY",
      targetKey,
      source: "SAVED_INDUSTRY",
      sources: [{ source: "SAVED_INDUSTRY" }],
      label: industry.name.trim(),
    });
  }

  for (const watchList of watchLists) {
    if (!Array.isArray(watchList.stocks)) continue;
    for (const stock of watchList.stocks) {
      if (!isRecord(stock) || typeof stock.stockCode !== "string") continue;
      const targetKey = stock.stockCode.trim();
      if (!targetKey) continue;
      addCandidate(candidates, {
        targetType: "COMPANY",
        targetKey,
        source: "WATCHLIST",
        sources: [
          {
            source: "WATCHLIST",
            name: watchList.name.trim() || "未命名自选股",
          },
        ],
        label:
          typeof stock.stockName === "string" && stock.stockName.trim()
            ? stock.stockName.trim()
            : targetKey,
      });
    }
  }

  return [...candidates.values()].sort((left, right) => {
    const typeOrder = left.targetType.localeCompare(right.targetType, "en");
    if (typeOrder !== 0) return typeOrder;
    return left.targetKey.localeCompare(right.targetKey, "en");
  });
}

function addCandidate(
  candidates: Map<string, ResearchPreferenceImportCandidate>,
  candidate: ResearchPreferenceImportCandidate,
) {
  if (!candidate.targetKey || !candidate.label) return;
  const key = `${candidate.targetType}:${candidate.targetKey}`;
  const existing = candidates.get(key);
  if (!existing) {
    candidates.set(key, candidate);
    return;
  }
  existing.sources = mergeSources(existing.sources, candidate.sources);
}

function mergeSources(
  current: ResearchPreferenceImportCandidateSource[],
  incoming: ResearchPreferenceImportCandidateSource[],
) {
  const sources = new Map(
    current.map((item) => [`${item.source}:${item.name ?? ""}`, item]),
  );
  for (const item of incoming) {
    sources.set(`${item.source}:${item.name ?? ""}`, item);
  }
  return [...sources.values()];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
