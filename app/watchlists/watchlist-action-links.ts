export type WatchlistSelectedStock = {
  stockCode: string;
  stockName: string;
};

export type WatchlistActionLinks = {
  screeningHref: string;
  industryResearchHref: string;
  companyResearchHref: string | null;
  timingHref: string;
  linkSpaceHref: string;
};

function buildStockSeed(stocks: WatchlistSelectedStock[]) {
  return stocks.map((item) => item.stockCode).join(",");
}

function buildStockNames(stocks: WatchlistSelectedStock[]) {
  return stocks.map((item) => item.stockName).join(",");
}

export function buildWatchlistActionLinks(params: {
  watchListId: string;
  watchListName: string;
  selectedStocks: WatchlistSelectedStock[];
}): WatchlistActionLinks {
  const stockSeed = buildStockSeed(params.selectedStocks);
  const stockNames = buildStockNames(params.selectedStocks);

  const screeningSearch = new URLSearchParams({
    watchListId: params.watchListId,
    draftName: params.watchListName,
  });
  if (stockSeed) {
    screeningSearch.set("seedStockCodes", stockSeed);
  }

  const industrySearch = new URLSearchParams();
  industrySearch.set(
    "query",
    params.selectedStocks.length > 0
      ? `围绕 ${params.selectedStocks.map((item) => item.stockName).join("、")} 所在产业链，判断当前行业机会、竞争格局与兑现节奏。`
      : `围绕 ${params.watchListName} 做一轮行业研究。`,
  );
  industrySearch.set(
    "researchGoal",
    `从 ${params.watchListName} 中筛出值得继续深挖的机会。`,
  );
  if (stockNames) {
    industrySearch.set("preferredSources", stockNames.replaceAll(",", "\n"));
  }

  const timingSearch = new URLSearchParams({
    watchListId: params.watchListId,
  });
  const [singleStock] = params.selectedStocks;
  if (params.selectedStocks.length === 1 && singleStock) {
    timingSearch.set("stockCode", singleStock.stockCode);
  }

  const linkSpaceSearch = new URLSearchParams({
    watchListId: params.watchListId,
  });
  if (stockSeed) {
    linkSpaceSearch.set("stockCodes", stockSeed);
  }
  if (stockNames) {
    linkSpaceSearch.set("stockNames", stockNames);
  }

  let companyResearchHref: string | null = null;
  if (params.selectedStocks.length === 1 && singleStock) {
    const companySearch = new URLSearchParams({
      companyName: singleStock.stockName,
      stockCode: singleStock.stockCode,
    });
    companyResearchHref = `/company-research?${companySearch.toString()}`;
  }

  return {
    screeningHref: `/screening?${screeningSearch.toString()}`,
    industryResearchHref: `/workflows?${industrySearch.toString()}`,
    companyResearchHref,
    timingHref: `/timing?${timingSearch.toString()}`,
    linkSpaceHref: `/spaces?${linkSpaceSearch.toString()}`,
  };
}
