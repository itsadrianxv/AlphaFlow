import { buildResearchDigest } from "~/app/workflows/research-view-models";
import { buildRunDetailHref } from "~/app/workflows/run-detail-href";
import type {
  ResearchSpaceBrief,
  ResearchSpaceLinkedStock,
  ResearchSpaceLinkedWatchlist,
  ResearchSpaceRunLink,
} from "~/contracts/space";

export type SpaceRecentSummary = {
  runId: string;
  note: string | null;
  createdAt: string;
  title: string;
  summary: string;
  href: string;
  templateCode: string;
};

export type SpaceActionLinks = {
  industryResearchHref: string;
  companyResearchHref: string | null;
  screeningHref: string;
  timingHref: string;
};

function buildIndustryQuery(params: {
  brief: ResearchSpaceBrief;
  stocks: ResearchSpaceLinkedStock[];
}) {
  const stockNames = params.stocks
    .map((item) => item.stockName)
    .filter(Boolean);
  const thesis = params.brief.coreThesis.trim();
  const goal = params.brief.researchGoal.trim();

  if (thesis) {
    return thesis;
  }

  if (stockNames.length > 0) {
    return `围绕 ${stockNames.join("、")} 所在产业链，判断当前行业机会、竞争格局与兑现节奏。`;
  }

  if (goal) {
    return goal;
  }

  return "围绕当前 Research Space 的 thesis 做一轮行业研究。";
}

function joinLines(items: string[]) {
  return items.filter(Boolean).join("\n");
}

function buildStockSeed(stocks: ResearchSpaceLinkedStock[]) {
  return stocks.map((item) => item.stockCode).join(",");
}

export function buildSpaceRecentSummaries(params: {
  runLinks: ResearchSpaceRunLink[];
  limit?: number;
}): SpaceRecentSummary[] {
  const { limit = 3 } = params;
  return params.runLinks
    .filter((item) => item.run.status === "SUCCEEDED")
    .sort(
      (left, right) =>
        new Date(right.createdAt).getTime() -
        new Date(left.createdAt).getTime(),
    )
    .slice(0, limit)
    .map((item) => {
      const digest = buildResearchDigest({
        templateCode: item.run.templateCode,
        query: item.run.query,
        status: item.run.status,
        progressPercent: item.run.progressPercent,
        currentNodeKey: item.run.currentNodeKey,
      });

      return {
        runId: item.run.id,
        note: item.note,
        createdAt: item.createdAt,
        title: digest.headline,
        summary: digest.summary,
        href: buildRunDetailHref({
          runId: item.run.id,
          templateCode: item.run.templateCode,
        }),
        templateCode: item.run.templateCode,
      };
    });
}

export function buildSpaceActionLinks(params: {
  spaceId: string;
  brief: ResearchSpaceBrief;
  stocks: ResearchSpaceLinkedStock[];
  watchLists: ResearchSpaceLinkedWatchlist[];
}): SpaceActionLinks {
  const stockSeed = buildStockSeed(params.stocks);
  const keyQuestions = joinLines(params.brief.keyQuestions);
  const focusDimensions = joinLines(params.brief.focusDimensions);

  const industrySearch = new URLSearchParams();
  industrySearch.set(
    "query",
    buildIndustryQuery({ brief: params.brief, stocks: params.stocks }),
  );
  if (params.brief.researchGoal.trim()) {
    industrySearch.set("researchGoal", params.brief.researchGoal.trim());
  }
  if (keyQuestions) {
    industrySearch.set("mustAnswerQuestions", keyQuestions);
  }
  if (focusDimensions) {
    industrySearch.set("preferredSources", focusDimensions);
  }
  if (params.spaceId) {
    industrySearch.set("spaceId", params.spaceId);
  }

  const screeningSearch = new URLSearchParams();
  if (stockSeed) {
    screeningSearch.set("seedStockCodes", stockSeed);
  }
  const firstWatchList = params.watchLists[0];
  if (firstWatchList) {
    screeningSearch.set("watchListId", firstWatchList.watchListId);
  }
  if (params.brief.researchGoal.trim()) {
    screeningSearch.set("draftName", params.brief.researchGoal.trim());
  }
  if (params.brief.coreThesis.trim()) {
    screeningSearch.set("draftDescription", params.brief.coreThesis.trim());
  }
  if (params.spaceId) {
    screeningSearch.set("spaceId", params.spaceId);
  }

  const timingSearch = new URLSearchParams();
  if (firstWatchList) {
    timingSearch.set("watchListId", firstWatchList.watchListId);
  } else {
    const [singleStock] = params.stocks;
    if (params.stocks.length === 1 && singleStock) {
      timingSearch.set("stockCode", singleStock.stockCode);
    }
  }
  if (params.spaceId) {
    timingSearch.set("spaceId", params.spaceId);
  }

  let companyResearchHref: string | null = null;
  const [singleStock] = params.stocks;
  if (params.stocks.length === 1 && singleStock) {
    const companySearch = new URLSearchParams();
    companySearch.set("companyName", singleStock.stockName);
    companySearch.set("stockCode", singleStock.stockCode);
    if (params.brief.researchGoal.trim()) {
      companySearch.set("researchGoal", params.brief.researchGoal.trim());
    }
    if (keyQuestions) {
      companySearch.set("mustAnswerQuestions", keyQuestions);
    }
    if (focusDimensions) {
      companySearch.set("focusConcepts", focusDimensions);
    }
    if (params.spaceId) {
      companySearch.set("spaceId", params.spaceId);
    }
    companyResearchHref = `/company-research?${companySearch.toString()}`;
  }

  return {
    industryResearchHref: `/workflows?${industrySearch.toString()}`,
    companyResearchHref,
    screeningHref: `/screening?${screeningSearch.toString()}`,
    timingHref:
      timingSearch.size > 0 ? `/timing?${timingSearch.toString()}` : "/timing",
  };
}
