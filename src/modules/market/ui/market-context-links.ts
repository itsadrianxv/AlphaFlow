import type { MarketContextSnapshot } from "~/modules/market/contracts/market-context";

export type MarketContextSectionTarget =
  | "workflows"
  | "companyResearch"
  | "screening"
  | "timing";

type BuildMarketContextHrefParams = {
  section: MarketContextSectionTarget;
  theme: MarketContextSnapshot["hotThemes"][number];
  snapshot: MarketContextSnapshot;
};

function buildWorkflowsQuestion(theme: string) {
  return `围绕 ${theme} 产业链，当前景气扩散到哪些环节？`;
}

export function buildMarketContextHref(params: BuildMarketContextHrefParams) {
  const [firstCandidate] = params.theme.candidateStocks;

  switch (params.section) {
    case "workflows": {
      const search = new URLSearchParams({
        query: buildWorkflowsQuestion(params.theme.theme),
        researchGoal: params.snapshot.downstreamHints.workflows.summary,
      });
      return `/research?${search.toString()}`;
    }
    case "companyResearch": {
      const search = new URLSearchParams();
      if (firstCandidate) {
        search.set("companyName", firstCandidate.stockName);
        search.set("stockCode", firstCandidate.stockCode);
      }
      search.set("focusConcepts", params.theme.theme);
      search.set(
        "keyQuestion",
        `当前 ${params.theme.theme} 热点能否兑现到公司订单、收入或利润？`,
      );
      return `/research/company?${search.toString()}`;
    }
    case "screening": {
      const search = new URLSearchParams();
      const seedStockCodes = params.theme.candidateStocks
        .map((item) => item.stockCode)
        .join(",");

      if (seedStockCodes) {
        search.set("seedStockCodes", seedStockCodes);
      }

      search.set("draftName", `${params.theme.theme} 热门主题候选池`);
      search.set("draftDescription", params.theme.whyHot);
      return `/screening?${search.toString()}`;
    }
    case "timing": {
      if (!firstCandidate) {
        return "/timing";
      }

      const search = new URLSearchParams({
        stockCode: firstCandidate.stockCode,
      });
      return `/timing?${search.toString()}`;
    }
  }
}

export function findMatchingHotThemes(
  hotThemes: MarketContextSnapshot["hotThemes"],
  currentStockCodes: string[],
) {
  const currentCodes = new Set(currentStockCodes.filter(Boolean));
  return hotThemes
    .filter((theme) =>
      theme.candidateStocks.some((stock) => currentCodes.has(stock.stockCode)),
    )
    .map((theme) => theme.theme);
}
