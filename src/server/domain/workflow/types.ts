export const QUICK_RESEARCH_TEMPLATE_CODE = "quick_industry_research";

export const QUICK_RESEARCH_NODE_KEYS = [
  "agent1_industry_overview",
  "agent2_market_heat",
  "agent3_candidate_screening",
  "agent4_credibility_batch",
  "agent5_competition_summary",
] as const;

export type QuickResearchNodeKey = (typeof QUICK_RESEARCH_NODE_KEYS)[number];

export type WorkflowEventStreamType =
  | "RUN_STARTED"
  | "NODE_STARTED"
  | "NODE_PROGRESS"
  | "NODE_SUCCEEDED"
  | "NODE_FAILED"
  | "RUN_SUCCEEDED"
  | "RUN_FAILED"
  | "RUN_CANCELLED";

export type QuickResearchInput = {
  query: string;
};

export type QuickResearchCandidate = {
  stockCode: string;
  stockName: string;
  reason: string;
  score: number;
};

export type QuickResearchCredibility = {
  stockCode: string;
  credibilityScore: number;
  highlights: string[];
  risks: string[];
};

export type QuickResearchTopPick = {
  stockCode: string;
  stockName: string;
  reason: string;
};

export type QuickResearchResultDto = {
  overview: string;
  heatScore: number;
  heatConclusion: string;
  candidates: QuickResearchCandidate[];
  credibility: QuickResearchCredibility[];
  topPicks: QuickResearchTopPick[];
  competitionSummary: string;
  generatedAt: string;
};

export type WorkflowStreamEvent = {
  runId: string;
  sequence: number;
  type: WorkflowEventStreamType;
  nodeKey?: QuickResearchNodeKey;
  progressPercent: number;
  timestamp: string;
  payload: Record<string, unknown>;
};

export type QuickResearchGraphState = {
  runId: string;
  userId: string;
  query: string;
  currentNodeKey?: QuickResearchNodeKey;
  progressPercent: number;
  intent?: string;
  industryOverview?: string;
  heatAnalysis?: {
    heatScore: number;
    heatConclusion: string;
  };
  candidates?: QuickResearchCandidate[];
  credibility?: QuickResearchCredibility[];
  competition?: string;
  finalReport?: QuickResearchResultDto;
  errors: string[];
};
