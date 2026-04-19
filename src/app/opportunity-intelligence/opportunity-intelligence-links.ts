import { createHash } from "node:crypto";
import type { OpportunityLead } from "~/contracts/opportunity-intelligence";

function shortHash(value: string) {
  return createHash("sha1").update(value).digest("hex").slice(0, 8);
}

export function slugifyOpportunityLead(title: string) {
  const normalized = title.trim();
  const asciiTokens = normalized
    .replace(/AI/gi, "ai")
    .replace(/订单/g, " orders ")
    .replace(/兑现/g, " ")
    .replace(/靠近/g, " ")
    .replace(/[:：]/g, " ")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
    .slice(0, 3);

  if (asciiTokens.length > 0) {
    return asciiTokens.join("-");
  }

  return `lead-${shortHash(normalized)}`;
}

type OpportunityLeadLinkInput = Pick<
  OpportunityLead,
  | "slug"
  | "theme"
  | "title"
  | "whyNow"
  | "realizationPath"
  | "candidateStocks"
  | "recommendedQuestion"
>;

export function buildOpportunityLeadActionLinks(
  lead: OpportunityLeadLinkInput,
) {
  const [firstCandidate] = lead.candidateStocks;
  const workflowsSearch = new URLSearchParams({
    query: lead.recommendedQuestion,
    researchGoal: lead.whyNow,
  });
  const screeningSearch = new URLSearchParams({
    draftName: `${lead.theme} 机会候选池`,
    draftDescription: lead.realizationPath,
  });

  if (lead.candidateStocks.length > 0) {
    screeningSearch.set(
      "seedStockCodes",
      lead.candidateStocks.map((item) => item.stockCode).join(","),
    );
  }

  const companyResearchSearch = new URLSearchParams({
    focusConcepts: lead.theme,
    keyQuestion: `当前 ${lead.theme} 机会能否兑现到订单、收入或利润？`,
  });

  if (firstCandidate) {
    companyResearchSearch.set("companyName", firstCandidate.stockName);
    companyResearchSearch.set("stockCode", firstCandidate.stockCode);
  }

  return {
    leadHref: `/opportunity-intelligence?lead=${encodeURIComponent(lead.slug)}`,
    workflowsHref: `/workflows?${workflowsSearch.toString()}`,
    screeningHref: `/screening?${screeningSearch.toString()}`,
    companyResearchHref: `/company-research?${companyResearchSearch.toString()}`,
  };
}
