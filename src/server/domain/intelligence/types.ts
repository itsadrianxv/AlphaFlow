export type ThemeNewsItem = {
  id: string;
  title: string;
  summary: string;
  source: string;
  publishedAt: string;
  sentiment: "positive" | "neutral" | "negative";
  relevanceScore: number;
  relatedStocks: string[];
};

export type CompanyEvidence = {
  stockCode: string;
  companyName: string;
  concept: string;
  evidenceSummary: string;
  catalysts: string[];
  risks: string[];
  credibilityScore: number;
  updatedAt: string;
};

export type CompanyEvidenceBatchRequest = {
  stockCodes: string[];
  concept: string;
};
