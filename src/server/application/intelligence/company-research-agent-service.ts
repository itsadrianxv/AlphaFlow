import type { ConfidenceAnalysisService } from "~/server/application/intelligence/confidence-analysis-service";
import { EvidenceReference } from "~/server/domain/intelligence/entities/evidence-reference";
import type {
  CompanyResearchPack,
  CompanyResearchPackReferenceItem,
} from "~/server/domain/intelligence/types";
import type {
  CompanyConceptInsight,
  CompanyEvidenceNote,
  CompanyQuestionFinding,
  CompanyResearchBrief,
  CompanyResearchCollectionSummary,
  CompanyResearchCollectorKey,
  CompanyResearchCollectorRunInfo,
  CompanyResearchCollectorSummary,
  CompanyResearchGroundedSource,
  CompanyResearchInput,
  CompanyResearchQuestion,
  CompanyResearchReferenceItem,
  CompanyResearchResultDto,
  CompanyResearchSourceTier,
  CompanyResearchSourceType,
  CompanyResearchVerdict,
} from "~/server/domain/workflow/types";
import type {
  CompressedFindings,
  ResearchGapAnalysis,
  ResearchNote,
  ResearchRuntimeConfig,
  ResearchUnitPlan,
} from "~/server/domain/workflow/research";
import type { DeepSeekClient } from "~/server/infrastructure/intelligence/deepseek-client";
import type {
  FirecrawlClient,
  FirecrawlScrapeDocument,
  FirecrawlSearchResult,
} from "~/server/infrastructure/intelligence/firecrawl-client";
import type { PythonIntelligenceDataClient } from "~/server/infrastructure/intelligence/python-intelligence-data-client";

export type CompanyResearchAgentServiceDependencies = {
  deepSeekClient: DeepSeekClient;
  firecrawlClient: FirecrawlClient;
  pythonIntelligenceDataClient: PythonIntelligenceDataClient;
  confidenceAnalysisService: ConfidenceAnalysisService;
};

type CollectorOutput = {
  collectorKey: CompanyResearchCollectorKey;
  evidence: CompanyEvidenceNote[];
  queries: string[];
  notes: string[];
  configured: boolean;
  pack?: CompanyResearchPack;
};

type CuratedEvidenceResult = {
  evidence: CompanyEvidenceNote[];
  references: CompanyResearchReferenceItem[];
  collectionSummary: CompanyResearchCollectionSummary;
  crawler: CompanyResearchResultDto["crawler"];
};

const PRIORITIZE_STANCE: CompanyResearchVerdict["stance"] = "优先研究";
const TRACK_STANCE: CompanyResearchVerdict["stance"] = "继续跟踪";
const WATCH_STANCE: CompanyResearchVerdict["stance"] = "暂不优先";

const CORE_MATURITY: CompanyConceptInsight["maturity"] = "核心成熟";
const GROWTH_MATURITY: CompanyConceptInsight["maturity"] = "成长加速";
const VALIDATION_MATURITY: CompanyConceptInsight["maturity"] = "验证阶段";

const MAX_CURATED_REFERENCES = 15;
const MAX_ENRICHED_REFERENCES = 15;
const MAX_QUESTION_EVIDENCE = 3;

const COLLECTOR_LABELS: Record<CompanyResearchCollectorKey, string> = {
  official_sources: "官网 / IR",
  financial_sources: "财务补强",
  news_sources: "新闻事件",
  industry_sources: "行业格局",
};

const DISCLOSURE_HOSTS = new Set([
  "cninfo.com.cn",
  "www.cninfo.com.cn",
  "sse.com.cn",
  "www.sse.com.cn",
  "szse.cn",
  "www.szse.cn",
  "hkexnews.hkex.com.hk",
]);

function normalizeUrl(url?: string) {
  if (!url) {
    return undefined;
  }

  const trimmed = url.trim();
  if (!trimmed) {
    return undefined;
  }

  return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
}

function safeUrl(url?: string) {
  if (!url) {
    return undefined;
  }

  try {
    return new URL(url);
  } catch {
    return undefined;
  }
}

function stripWww(hostname: string) {
  return hostname.replace(/^www\./i, "").toLowerCase();
}

function inferRegistrableDomain(hostname: string) {
  const parts = stripWww(hostname).split(".");
  if (parts.length <= 2) {
    return stripWww(hostname);
  }

  const suffix = parts.slice(-2).join(".");
  if (suffix === "com.cn" || suffix === "net.cn" || suffix === "org.cn") {
    return parts.slice(-3).join(".");
  }

  return parts.slice(-2).join(".");
}

function normalizeUrlForComparison(url?: string) {
  const parsed = safeUrl(url);
  if (!parsed) {
    return undefined;
  }

  parsed.hash = "";
  parsed.search = "";
  let pathname = parsed.pathname.replace(/\/+$/, "");
  if (!pathname) {
    pathname = "/";
  }

  return `${parsed.protocol}//${stripWww(parsed.hostname)}${pathname}`;
}

function splitTags(values?: string[]) {
  return [
    ...new Set((values ?? []).map((item) => item.trim()).filter(Boolean)),
  ];
}

function stripMarkdown(value?: string, maxLength = 280) {
  if (!value) {
    return "";
  }

  const plainText = value
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/\[(.*?)\]\((.*?)\)/g, "$1")
    .replace(/[>#*_`~-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (plainText.length <= maxLength) {
    return plainText;
  }

  return `${plainText.slice(0, maxLength)}...`;
}

function parsePublishedAt(value?: string) {
  if (!value) {
    return undefined;
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return undefined;
  }

  return date;
}

function countDaysSince(dateValue?: string) {
  const date = parsePublishedAt(dateValue);
  if (!date) {
    return undefined;
  }

  const diffMs = Date.now() - date.getTime();
  return Math.max(0, Math.floor(diffMs / (24 * 60 * 60 * 1000)));
}

function uniqueStrings(items: string[]) {
  return [...new Set(items.map((item) => item.trim()).filter(Boolean))];
}

function buildFallbackBrief(input: CompanyResearchInput): CompanyResearchBrief {
  const focusConcepts = splitTags(
    input.focusConcepts?.length
      ? input.focusConcepts
      : ["核心业务", "新业务", "研发投入", "资本开支"],
  );

  const defaultQuestion = input.keyQuestion?.trim()
    ? input.keyQuestion.trim()
    : `这家公司围绕 ${focusConcepts[0] ?? "核心业务"} 的投入，是否足以支撑未来 2-3 年的利润兑现？`;

  return {
    companyName: input.companyName.trim(),
    stockCode: input.stockCode?.trim() || undefined,
    officialWebsite: normalizeUrl(input.officialWebsite),
    researchGoal: `判断 ${input.companyName.trim()} 是否值得围绕概念兑现与利润质量继续深入研究。`,
    focusConcepts,
    keyQuestions: [
      defaultQuestion,
      `${input.companyName.trim()} 最近几个季度有多少利润或收入来自新业务？`,
      `${input.companyName.trim()} 去年利润中有多大比例继续投入到重点新兴技术或产能建设？`,
    ],
  };
}

function buildFallbackConceptInsights(
  brief: CompanyResearchBrief,
): CompanyConceptInsight[] {
  return brief.focusConcepts.slice(0, 4).map((concept, index) => ({
    concept,
    whyItMatters:
      index === 0
        ? `${concept} 是市场理解公司估值和成长预期的核心抓手。`
        : `${concept} 有助于拆解公司未来盈利弹性的来源。`,
    companyFit:
      index === 0
        ? `需要确认 ${brief.companyName} 是否已经形成稳定产品、客户或订单支撑。`
        : `需要确认 ${brief.companyName} 在 ${concept} 上是概念映射、能力储备，还是已经开始商业兑现。`,
    monetizationPath: `重点观察 ${concept} 对收入结构、利润率和资本开支回报的传导路径。`,
    maturity:
      index === 0
        ? CORE_MATURITY
        : index === 1
          ? GROWTH_MATURITY
          : VALIDATION_MATURITY,
  }));
}

function buildFallbackQuestions(
  brief: CompanyResearchBrief,
  conceptInsights: CompanyConceptInsight[],
): CompanyResearchQuestion[] {
  const leadConcept =
    conceptInsights[0]?.concept ?? brief.focusConcepts[0] ?? "新业务";

  return [
    {
      question: `${brief.companyName} 在最近 4 个季度中，有多少收入或利润来自 ${leadConcept}？`,
      whyImportant: "验证新概念是否已经进入财务报表，而不只是叙事标签。",
      targetMetric: `${leadConcept} 收入占比 / 利润占比`,
      dataHint: "优先核对分部披露、管理层表述、订单口径和调研纪要。",
    },
    {
      question: `${brief.companyName} 去年利润中有多大比例继续投入到 ${leadConcept} 相关研发或产能？`,
      whyImportant:
        "衡量管理层是否愿意继续押注该概念，以及投入强度是否可持续。",
      targetMetric: "研发费用率 / 资本开支占利润比",
      dataHint: "核对研发费用、资本开支、在建工程和现金流附注。",
    },
    {
      question: `${brief.companyName} 的 ${leadConcept} 业务，是提升估值叙事还是已经改善利润质量？`,
      whyImportant: "区分概念映射与真实盈利能力，避免只买到主题热度。",
      targetMetric: "毛利率变化 / 净利率变化 / 客户集中度",
      dataHint: "核对毛利率、客户结构、单价趋势和管理层对业务阶段的描述。",
    },
  ];
}

function buildFallbackFindings(
  questions: CompanyResearchQuestion[],
  evidence: CompanyEvidenceNote[],
): CompanyQuestionFinding[] {
  return questions.map((question, index) => {
    const selectedEvidence = evidence[index] ? [evidence[index]] : [];

    return {
      question: question.question,
      answer:
        selectedEvidence[0]?.extractedFact ??
        "当前公开资料未直接给出可核验答案，需要继续查找财报附注、交流纪要或官网披露。",
      confidence: selectedEvidence.length > 0 ? "medium" : "low",
      evidenceUrls: selectedEvidence
        .map((item) => item.url)
        .filter((item): item is string => Boolean(item)),
      referenceIds: selectedEvidence.map((item) => item.referenceId),
      gaps:
        selectedEvidence.length > 0
          ? ["仍需用财报口径交叉核对具体占比。"]
          : [question.dataHint],
    };
  });
}

function buildFallbackVerdict(params: {
  brief: CompanyResearchBrief;
  conceptInsights: CompanyConceptInsight[];
  findings: CompanyQuestionFinding[];
}): CompanyResearchVerdict {
  const highConfidenceCount = params.findings.filter(
    (item) => item.confidence === "high",
  ).length;
  const mediumConfidenceCount = params.findings.filter(
    (item) => item.confidence === "medium",
  ).length;

  const stance: CompanyResearchVerdict["stance"] =
    highConfidenceCount >= 2
      ? PRIORITIZE_STANCE
      : mediumConfidenceCount >= 2
        ? TRACK_STANCE
        : WATCH_STANCE;

  return {
    stance,
    summary: `${params.brief.companyName} 当前更适合作为${stance === PRIORITIZE_STANCE ? "优先深挖" : stance === TRACK_STANCE ? "持续跟踪" : "低优先级观察"}对象，关键在于验证 ${params.conceptInsights[0]?.concept ?? "核心概念"} 是否真正转化为利润。`,
    bullPoints: [
      `${params.brief.companyName} 具备可继续拆解的概念主线与业务抓手。`,
      "至少部分研究问题已经找到公开线索，可以继续顺着证据深挖。",
    ],
    bearPoints: [
      "关键占比数据可能未被公司直接披露，需要手工交叉验证。",
      "概念热度与实际盈利质量之间仍可能存在偏差。",
    ],
    nextChecks: [
      "补充最近一年的年报、半年报、季报附注。",
      "核对管理层电话会、投资者交流纪要与官网新闻。",
      "追踪资本开支、研发费用与订单兑现节奏是否一致。",
    ],
  };
}

function buildOfficialHostSet(officialWebsite?: string) {
  const parsed = safeUrl(officialWebsite);
  if (!parsed) {
    return new Set<string>();
  }

  const hostname = stripWww(parsed.hostname);
  const registrableDomain = inferRegistrableDomain(hostname);
  return new Set<string>([hostname, registrableDomain]);
}

function isDisclosureHost(hostname: string) {
  return DISCLOSURE_HOSTS.has(stripWww(hostname));
}

function isFirstPartyHost(hostname: string, officialHosts: Set<string>) {
  const normalizedHost = stripWww(hostname);

  if (isDisclosureHost(normalizedHost)) {
    return true;
  }

  for (const host of officialHosts) {
    if (normalizedHost === host || normalizedHost.endsWith(`.${host}`)) {
      return true;
    }
  }

  return false;
}

function inferSourceTypeFromUrl(
  url: string | undefined,
  fallbackType: CompanyResearchSourceType,
): CompanyResearchSourceType {
  const parsed = safeUrl(url);
  if (!parsed) {
    return fallbackType;
  }

  if (isDisclosureHost(parsed.hostname)) {
    return "financial";
  }

  return fallbackType;
}

function inferSourceContext(params: {
  url?: string;
  fallbackType: CompanyResearchSourceType;
  officialHosts: Set<string>;
  collectorKey: CompanyResearchCollectorKey;
}) {
  const parsed = safeUrl(params.url);
  const sourceType = inferSourceTypeFromUrl(params.url, params.fallbackType);
  const isFirstParty =
    parsed !== undefined
      ? isFirstPartyHost(parsed.hostname, params.officialHosts)
      : false;

  return {
    sourceType,
    sourceTier: (isFirstParty
      ? "first_party"
      : "third_party") as CompanyResearchSourceTier,
    collectorKey: params.collectorKey,
    isFirstParty,
  };
}

function sourceNameFromUrl(url?: string, fallback = "web") {
  const parsed = safeUrl(url);
  return parsed ? stripWww(parsed.hostname) : fallback;
}

function buildReferenceId(note: {
  referenceId?: string;
  url?: string;
  title: string;
  collectorKey: CompanyResearchCollectorKey;
}) {
  if (note.referenceId?.trim()) {
    return note.referenceId;
  }

  return (
    note.url?.trim() ||
    `${note.collectorKey}:${note.title.trim().toLowerCase().replace(/\s+/g, "-")}`
  );
}

function createEvidenceNote(params: {
  referenceId?: string;
  title: string;
  sourceName: string;
  url?: string;
  sourceType: CompanyResearchSourceType;
  sourceTier: CompanyResearchSourceTier;
  collectorKey: CompanyResearchCollectorKey;
  isFirstParty: boolean;
  snippet: string;
  extractedFact: string;
  relevance: string;
  publishedAt?: string;
}): CompanyEvidenceNote {
  return {
    referenceId: buildReferenceId({
      referenceId: params.referenceId,
      url: params.url,
      title: params.title,
      collectorKey: params.collectorKey,
    }),
    title: params.title,
    sourceName: params.sourceName,
    url: params.url,
    sourceType: params.sourceType,
    sourceTier: params.sourceTier,
    collectorKey: params.collectorKey,
    isFirstParty: params.isFirstParty,
    snippet: stripMarkdown(params.snippet, 320),
    extractedFact: stripMarkdown(params.extractedFact, 240),
    relevance: params.relevance,
    publishedAt: params.publishedAt,
  };
}

function mapSearchResultToEvidence(params: {
  result: FirecrawlSearchResult;
  collectorKey: CompanyResearchCollectorKey;
  sourceType: CompanyResearchSourceType;
  sourceTier: CompanyResearchSourceTier;
  isFirstParty: boolean;
  relevance: string;
}): CompanyEvidenceNote {
  const snippet = stripMarkdown(
    params.result.markdown ?? params.result.description,
    320,
  );

  return createEvidenceNote({
    referenceId: params.result.url,
    title: params.result.title,
    sourceName: sourceNameFromUrl(params.result.url, params.sourceType),
    url: params.result.url,
    sourceType: params.sourceType,
    sourceTier: params.sourceTier,
    collectorKey: params.collectorKey,
    isFirstParty: params.isFirstParty,
    snippet,
    extractedFact:
      snippet ||
      "Found a potentially relevant page but still needs manual verification.",
    relevance: params.relevance,
  });
}

function mapScrapeDocumentToEvidence(params: {
  document: FirecrawlScrapeDocument;
  collectorKey: CompanyResearchCollectorKey;
  sourceType: CompanyResearchSourceType;
  sourceTier: CompanyResearchSourceTier;
  isFirstParty: boolean;
  relevance: string;
}): CompanyEvidenceNote {
  const snippet = stripMarkdown(
    params.document.markdown ?? params.document.description,
    360,
  );

  return createEvidenceNote({
    referenceId: params.document.url,
    title: params.document.title,
    sourceName: sourceNameFromUrl(params.document.url, params.sourceType),
    url: params.document.url,
    sourceType: params.sourceType,
    sourceTier: params.sourceTier,
    collectorKey: params.collectorKey,
    isFirstParty: params.isFirstParty,
    snippet,
    extractedFact:
      snippet || "Page was scraped but did not expose a clear factual snippet.",
    relevance: params.relevance,
  });
}

function mapResearchPackReferenceToEvidence(
  reference: CompanyResearchPackReferenceItem,
): CompanyEvidenceNote {
  return createEvidenceNote({
    referenceId: reference.id,
    title: reference.title,
    sourceName: reference.sourceName,
    url: reference.url,
    sourceType: "financial",
    sourceTier: "third_party",
    collectorKey: "financial_sources",
    isFirstParty: false,
    snippet: reference.snippet,
    extractedFact: reference.extractedFact,
    relevance:
      "Structured financial evidence from the Python intelligence service.",
    publishedAt: reference.publishedAt,
  });
}

function buildQuestionKeywords(question: CompanyResearchQuestion) {
  return uniqueStrings(
    [question.question, question.targetMetric, question.dataHint]
      .join(" ")
      .split(/[\s,，、:：;；/()（）]+/),
  ).filter((item) => item.length >= 2);
}

function computeQuestionEvidenceScore(
  question: CompanyResearchQuestion,
  evidence: CompanyEvidenceNote,
) {
  const keywords = buildQuestionKeywords(question);
  const haystack = [
    evidence.title,
    evidence.extractedFact,
    evidence.snippet,
    evidence.relevance,
  ]
    .join(" ")
    .toLowerCase();

  let score = evidence.isFirstParty ? 10 : 0;
  for (const keyword of keywords) {
    if (haystack.includes(keyword.toLowerCase())) {
      score += 2;
    }
  }

  if (evidence.sourceType === "financial") {
    score += 2;
  }

  return score;
}

function computeEvidenceScore(params: {
  brief: CompanyResearchBrief;
  evidence: CompanyEvidenceNote;
  questions: CompanyResearchQuestion[];
}) {
  let score = params.evidence.isFirstParty ? 100 : 0;
  const haystack = [
    params.evidence.title,
    params.evidence.extractedFact,
    params.evidence.snippet,
    params.evidence.relevance,
  ]
    .join(" ")
    .toLowerCase();

  for (const concept of params.brief.focusConcepts) {
    if (haystack.includes(concept.toLowerCase())) {
      score += 8;
    }
  }

  for (const question of params.questions) {
    score += Math.min(
      12,
      computeQuestionEvidenceScore(question, params.evidence),
    );
  }

  const daysSince = countDaysSince(params.evidence.publishedAt);
  if (daysSince !== undefined) {
    if (daysSince <= 30) {
      score += 12;
    } else if (daysSince <= 90) {
      score += 8;
    } else if (daysSince <= 365) {
      score += 4;
    }
  }

  if (params.evidence.extractedFact.length >= 80) {
    score += 8;
  }
  if (params.evidence.snippet.length >= 60) {
    score += 6;
  }
  if (params.evidence.url) {
    score += 3;
  }

  return score;
}

function createReferenceItem(
  evidence: CompanyEvidenceNote,
): CompanyResearchReferenceItem {
  const credibilityScore = evidence.isFirstParty
    ? 0.95
    : evidence.sourceType === "financial"
      ? 0.72
      : undefined;

  const reference = EvidenceReference.create({
    id: evidence.referenceId,
    title: evidence.title,
    sourceName: evidence.sourceName,
    snippet: evidence.snippet || evidence.extractedFact,
    extractedFact: evidence.extractedFact || evidence.snippet,
    url: evidence.url,
    publishedAt: evidence.publishedAt,
    credibilityScore,
  });

  return {
    ...reference.toDict(),
    sourceType: evidence.sourceType,
    sourceTier: evidence.sourceTier,
    collectorKey: evidence.collectorKey,
    isFirstParty: evidence.isFirstParty,
  } as CompanyResearchReferenceItem;
}

function updateEvidenceWithReference(
  evidence: CompanyEvidenceNote,
  reference: CompanyResearchReferenceItem,
): CompanyEvidenceNote {
  return {
    ...evidence,
    referenceId: reference.id,
    sourceName: reference.sourceName,
    url: reference.url,
    snippet: reference.snippet,
    extractedFact: reference.extractedFact,
    publishedAt: reference.publishedAt,
  };
}

function dedupeEvidenceByCanonicalUrl() {
  const deduped = new Map<
    string,
    {
      evidence: CompanyEvidenceNote;
      score: number;
    }
  >();

  return {
    pick(best: CompanyEvidenceNote, score: number) {
      const canonicalKey =
        normalizeUrlForComparison(best.url) ??
        `${best.sourceName.toLowerCase()}:${best.title.toLowerCase()}`;
      const current = deduped.get(canonicalKey);
      if (!current || score > current.score) {
        deduped.set(canonicalKey, { evidence: best, score });
      }
    },
    values() {
      return [...deduped.values()];
    },
  };
}

function buildCollectionSummary(params: {
  collectedEvidenceByCollector: Partial<
    Record<CompanyResearchCollectorKey, CompanyEvidenceNote[]>
  >;
  selectedEvidence: CompanyEvidenceNote[];
  collectorRunInfo: Partial<
    Record<CompanyResearchCollectorKey, CompanyResearchCollectorRunInfo>
  >;
  notes: string[];
}): CompanyResearchCollectionSummary {
  const collectorKeys = Object.keys(
    COLLECTOR_LABELS,
  ) as CompanyResearchCollectorKey[];
  const curatedByCollector = new Map<CompanyResearchCollectorKey, number>();
  const referencesByCollector = new Map<CompanyResearchCollectorKey, number>();

  for (const evidence of params.selectedEvidence) {
    curatedByCollector.set(
      evidence.collectorKey,
      (curatedByCollector.get(evidence.collectorKey) ?? 0) + 1,
    );
    referencesByCollector.set(
      evidence.collectorKey,
      (referencesByCollector.get(evidence.collectorKey) ?? 0) + 1,
    );
  }

  const collectors: CompanyResearchCollectorSummary[] = collectorKeys.map(
    (collectorKey) => {
      const rawEvidence =
        params.collectedEvidenceByCollector[collectorKey] ?? [];
      const runInfo = params.collectorRunInfo[collectorKey];

      return {
        collectorKey,
        label: COLLECTOR_LABELS[collectorKey],
        rawCount: rawEvidence.length,
        curatedCount: curatedByCollector.get(collectorKey) ?? 0,
        referenceCount: referencesByCollector.get(collectorKey) ?? 0,
        firstPartyCount: rawEvidence.filter((item) => item.isFirstParty).length,
        configured: runInfo?.configured ?? false,
        notes: runInfo?.notes ?? [],
      };
    },
  );

  return {
    collectors,
    totalRawCount: collectors.reduce((sum, item) => sum + item.rawCount, 0),
    totalCuratedCount: collectors.reduce(
      (sum, item) => sum + item.curatedCount,
      0,
    ),
    totalReferenceCount: collectors.reduce(
      (sum, item) => sum + item.referenceCount,
      0,
    ),
    totalFirstPartyCount: collectors.reduce(
      (sum, item) => sum + item.firstPartyCount,
      0,
    ),
    notes: uniqueStrings(params.notes),
  };
}

function buildCrawlerSummary(params: {
  firecrawlConfigured: boolean;
  collectorRunInfo: Partial<
    Record<CompanyResearchCollectorKey, CompanyResearchCollectorRunInfo>
  >;
  notes: string[];
}) {
  const queryCollectors: CompanyResearchCollectorKey[] = [
    "official_sources",
    "news_sources",
    "industry_sources",
  ];

  return {
    provider: "firecrawl" as const,
    configured: params.firecrawlConfigured,
    queries: uniqueStrings(
      queryCollectors.flatMap(
        (collectorKey) => params.collectorRunInfo[collectorKey]?.queries ?? [],
      ),
    ),
    notes: uniqueStrings(params.notes),
  };
}

function buildOfficialQueries(
  brief: CompanyResearchBrief,
  officialHosts: Set<string>,
) {
  const host = [...officialHosts][0];
  if (!host) {
    return [];
  }

  return uniqueStrings([
    `site:${host} ${brief.companyName} 投资者关系`,
    `site:${host} ${brief.companyName} 年报 半年报`,
    `site:${host} ${brief.companyName} ${brief.focusConcepts[0] ?? "主营业务"}`,
  ]);
}

function buildNewsQueries(
  brief: CompanyResearchBrief,
  questions: CompanyResearchQuestion[],
) {
  const leadConcept = brief.focusConcepts[0] ?? "新业务";

  return uniqueStrings([
    `${brief.companyName} ${leadConcept} 最新新闻 订单 产能`,
    `${brief.companyName} 公告 纪要 ${questions[0]?.targetMetric ?? "利润"}`,
    `${brief.companyName} ${leadConcept} 盈利 进展`,
  ]);
}

function buildIndustryQueries(
  brief: CompanyResearchBrief,
  questions: CompanyResearchQuestion[],
) {
  const leadConcept = brief.focusConcepts[0] ?? "新业务";

  return uniqueStrings([
    `${brief.companyName} ${leadConcept} 行业格局 竞争对手`,
    `${brief.companyName} 产业链 地位 ${leadConcept}`,
    `${brief.companyName} ${questions[0]?.targetMetric ?? "收入占比"} 行业对比`,
  ]);
}

function buildLegacySearchQueries(
  brief: CompanyResearchBrief,
  questions: CompanyResearchQuestion[],
) {
  const leadConcept = brief.focusConcepts[0] ?? "新业务";

  return uniqueStrings([
    `${brief.companyName} ${leadConcept} 收入占比 利润占比 财报`,
    `${brief.companyName} ${leadConcept} 研发投入 资本开支 利润`,
    `${brief.companyName} 投资者关系 ${questions[0]?.targetMetric ?? "新业务收入占比"}`,
  ]);
}

async function collectSearchEvidence(params: {
  client: FirecrawlClient;
  queries: string[];
  collectorKey: CompanyResearchCollectorKey;
  sourceType: CompanyResearchSourceType;
  relevance: string;
  officialHosts: Set<string>;
  forceFirstParty?: boolean;
}) {
  const evidence: CompanyEvidenceNote[] = [];
  const notes: string[] = [];

  for (const query of params.queries) {
    try {
      const searchResults = await params.client.search({
        query,
        limit: 4,
      });

      for (const result of searchResults) {
        const context = inferSourceContext({
          url: result.url,
          fallbackType: params.sourceType,
          officialHosts: params.officialHosts,
          collectorKey: params.collectorKey,
        });

        if (params.forceFirstParty && !context.isFirstParty) {
          continue;
        }

        evidence.push(
          mapSearchResultToEvidence({
            result,
            collectorKey: params.collectorKey,
            sourceType: context.sourceType,
            sourceTier: context.sourceTier,
            isFirstParty: context.isFirstParty,
            relevance: params.relevance,
          }),
        );
      }
    } catch (error) {
      notes.push(
        `Search failed for "${query}": ${error instanceof Error ? error.message : "unknown error"}`,
      );
    }
  }

  return {
    evidence,
    notes,
  };
}

export class CompanyResearchAgentService {
  private readonly deepSeekClient: DeepSeekClient;
  private readonly firecrawlClient: FirecrawlClient;
  private readonly pythonIntelligenceDataClient: PythonIntelligenceDataClient;
  private readonly confidenceAnalysisService: ConfidenceAnalysisService;

  constructor(dependencies: CompanyResearchAgentServiceDependencies) {
    this.deepSeekClient = dependencies.deepSeekClient;
    this.firecrawlClient = dependencies.firecrawlClient;
    this.pythonIntelligenceDataClient =
      dependencies.pythonIntelligenceDataClient;
    this.confidenceAnalysisService = dependencies.confidenceAnalysisService;
  }

  async buildResearchBrief(
    input: CompanyResearchInput,
  ): Promise<CompanyResearchBrief> {
    const fallback = buildFallbackBrief(input);

    return this.deepSeekClient.completeJson<CompanyResearchBrief>(
      [
        {
          role: "system",
          content:
            "You are a stock research assistant. Convert the user input into a structured company research brief. Output valid JSON and write all human-readable text in Simplified Chinese.",
        },
        {
          role: "user",
          content: JSON.stringify(input, null, 2),
        },
      ],
      fallback,
    );
  }

  async mapConceptInsights(
    brief: CompanyResearchBrief,
  ): Promise<CompanyConceptInsight[]> {
    const fallback = buildFallbackConceptInsights(brief);

    return this.deepSeekClient.completeJson<CompanyConceptInsight[]>(
      [
        {
          role: "system",
          content:
            "You are a company analyst. Output 3-5 concept insights in valid JSON. Use Simplified Chinese for free-text fields.",
        },
        {
          role: "user",
          content: JSON.stringify(brief, null, 2),
        },
      ],
      fallback,
    );
  }

  async designDeepQuestions(params: {
    brief: CompanyResearchBrief;
    conceptInsights: CompanyConceptInsight[];
  }): Promise<CompanyResearchQuestion[]> {
    const fallback = buildFallbackQuestions(
      params.brief,
      params.conceptInsights,
    );

    return this.deepSeekClient.completeJson<CompanyResearchQuestion[]>(
      [
        {
          role: "system",
          content:
            "You are a fundamental research analyst. Design 4-6 deep due-diligence questions and output valid JSON. Use Simplified Chinese for all free-text fields.",
        },
        {
          role: "user",
          content: JSON.stringify(params, null, 2),
        },
      ],
      fallback,
    );
  }

  groundSources(params: {
    input: CompanyResearchInput;
    brief: CompanyResearchBrief;
  }): {
    groundedSources: CompanyResearchGroundedSource[];
    notes: string[];
  } {
    const officialWebsite = normalizeUrl(
      params.input.officialWebsite ?? params.brief.officialWebsite,
    );
    const officialHosts = buildOfficialHostSet(officialWebsite);
    const groundedSources: CompanyResearchGroundedSource[] = [];
    const notes: string[] = [];

    if (officialWebsite) {
      const sourceContext = inferSourceContext({
        url: officialWebsite,
        fallbackType: "official",
        officialHosts,
        collectorKey: "official_sources",
      });

      groundedSources.push({
        url: officialWebsite,
        title: `${params.brief.companyName} 官网`,
        sourceType: sourceContext.sourceType,
        sourceTier: sourceContext.sourceTier,
        collectorKey: "official_sources",
        isFirstParty: sourceContext.isFirstParty,
        reason: "Provided official website seed.",
      });
    } else {
      notes.push(
        "No official website provided. Official-source grounding will rely on search only.",
      );
    }

    for (const url of params.input.supplementalUrls ?? []) {
      const normalizedUrl = normalizeUrl(url);
      if (!normalizedUrl) {
        continue;
      }

      const sourceContext = inferSourceContext({
        url: normalizedUrl,
        fallbackType: "news",
        officialHosts,
        collectorKey: "news_sources",
      });

      groundedSources.push({
        url: normalizedUrl,
        title: `${params.brief.companyName} 补充链接`,
        sourceType: sourceContext.sourceType,
        sourceTier: sourceContext.sourceTier,
        collectorKey: sourceContext.isFirstParty
          ? "official_sources"
          : "news_sources",
        isFirstParty: sourceContext.isFirstParty,
        reason: sourceContext.isFirstParty
          ? "User-provided first-party supplemental link."
          : "User-provided third-party supplemental link.",
      });
    }

    const dedupedGroundedSources = [
      ...new Map(
        groundedSources.map((item) => [
          normalizeUrlForComparison(item.url),
          item,
        ]),
      ).values(),
    ].filter((item): item is CompanyResearchGroundedSource => Boolean(item));

    return {
      groundedSources: dedupedGroundedSources,
      notes,
    };
  }

  async collectOfficialSources(params: {
    brief: CompanyResearchBrief;
    groundedSources: CompanyResearchGroundedSource[];
  }): Promise<CollectorOutput> {
    const collectorKey: CompanyResearchCollectorKey = "official_sources";
    const notes: string[] = [];
    const evidence: CompanyEvidenceNote[] = [];
    const officialHosts = buildOfficialHostSet(params.brief.officialWebsite);
    const queries = buildOfficialQueries(params.brief, officialHosts);

    if (!this.firecrawlClient.isConfigured()) {
      return {
        collectorKey,
        configured: false,
        evidence,
        queries,
        notes: [
          "Firecrawl is not configured. Official-source collector returned no web evidence.",
        ],
      };
    }

    const firstPartySeeds = params.groundedSources.filter(
      (item) => item.collectorKey === collectorKey && item.isFirstParty,
    );

    for (const seed of firstPartySeeds) {
      try {
        const scraped = await this.firecrawlClient.scrapeUrl(seed.url);
        if (!scraped) {
          continue;
        }

        const context = inferSourceContext({
          url: scraped.url,
          fallbackType: seed.sourceType,
          officialHosts,
          collectorKey,
        });

        evidence.push(
          mapScrapeDocumentToEvidence({
            document: scraped,
            collectorKey,
            sourceType: context.sourceType,
            sourceTier: context.sourceTier,
            isFirstParty: context.isFirstParty,
            relevance:
              "First-party pages used to validate company statements, investor-relations material, and disclosure pages.",
          }),
        );
      } catch (error) {
        notes.push(
          `Official seed scrape failed (${seed.url}): ${error instanceof Error ? error.message : "unknown error"}`,
        );
      }
    }

    const searched = await collectSearchEvidence({
      client: this.firecrawlClient,
      queries,
      collectorKey,
      sourceType: "official",
      relevance:
        "First-party search results used to supplement company and disclosure pages.",
      officialHosts,
      forceFirstParty: true,
    });

    notes.push(...searched.notes);
    evidence.push(...searched.evidence);

    return {
      collectorKey,
      configured: true,
      evidence,
      queries,
      notes,
    };
  }

  async collectFinancialSources(params: {
    brief: CompanyResearchBrief;
    conceptInsights: CompanyConceptInsight[];
  }): Promise<CollectorOutput> {
    const collectorKey: CompanyResearchCollectorKey = "financial_sources";
    const notes: string[] = [];

    if (!params.brief.stockCode) {
      return {
        collectorKey,
        configured: false,
        evidence: [],
        queries: [],
        notes: [
          "Stock code is missing. Financial collector skipped structured research-pack enrichment.",
        ],
      };
    }

    try {
      const pack =
        await this.pythonIntelligenceDataClient.getCompanyResearchPack({
          stockCode: params.brief.stockCode,
          concept:
            params.conceptInsights[0]?.concept ?? params.brief.focusConcepts[0],
        });

      const evidence = pack.referenceItems.map((item) =>
        mapResearchPackReferenceToEvidence(item),
      );

      if (pack.summaryNotes.length > 0) {
        notes.push(...pack.summaryNotes);
      }

      return {
        collectorKey,
        configured: true,
        evidence,
        queries: [],
        notes,
        pack,
      };
    } catch (error) {
      return {
        collectorKey,
        configured: true,
        evidence: [],
        queries: [],
        notes: [
          `Financial research-pack request failed: ${error instanceof Error ? error.message : "unknown error"}`,
        ],
      };
    }
  }

  async collectNewsSources(params: {
    brief: CompanyResearchBrief;
    questions: CompanyResearchQuestion[];
    groundedSources: CompanyResearchGroundedSource[];
  }): Promise<CollectorOutput> {
    const collectorKey: CompanyResearchCollectorKey = "news_sources";
    const notes: string[] = [];
    const evidence: CompanyEvidenceNote[] = [];
    const queries = buildNewsQueries(params.brief, params.questions);
    const officialHosts = buildOfficialHostSet(params.brief.officialWebsite);

    if (!this.firecrawlClient.isConfigured()) {
      return {
        collectorKey,
        configured: false,
        evidence,
        queries,
        notes: [
          "Firecrawl is not configured. News collector returned no web evidence.",
        ],
      };
    }

    const thirdPartySeeds = params.groundedSources.filter(
      (item) => item.collectorKey === collectorKey && !item.isFirstParty,
    );

    for (const seed of thirdPartySeeds) {
      try {
        const scraped = await this.firecrawlClient.scrapeUrl(seed.url);
        if (!scraped) {
          continue;
        }

        const context = inferSourceContext({
          url: scraped.url,
          fallbackType: "news",
          officialHosts,
          collectorKey,
        });

        evidence.push(
          mapScrapeDocumentToEvidence({
            document: scraped,
            collectorKey,
            sourceType: context.sourceType,
            sourceTier: context.sourceTier,
            isFirstParty: context.isFirstParty,
            relevance:
              "Supplemental third-party links and recent event coverage used to validate near-term catalysts.",
          }),
        );
      } catch (error) {
        notes.push(
          `Supplemental news seed scrape failed (${seed.url}): ${error instanceof Error ? error.message : "unknown error"}`,
        );
      }
    }

    const searched = await collectSearchEvidence({
      client: this.firecrawlClient,
      queries,
      collectorKey,
      sourceType: "news",
      relevance:
        "Recent news, announcement coverage, and external reporting used for event validation.",
      officialHosts,
    });

    notes.push(...searched.notes);
    evidence.push(...searched.evidence);

    return {
      collectorKey,
      configured: true,
      evidence,
      queries,
      notes,
    };
  }

  async collectIndustrySources(params: {
    brief: CompanyResearchBrief;
    questions: CompanyResearchQuestion[];
  }): Promise<CollectorOutput> {
    const collectorKey: CompanyResearchCollectorKey = "industry_sources";
    const queries = buildIndustryQueries(params.brief, params.questions);
    const officialHosts = buildOfficialHostSet(params.brief.officialWebsite);

    if (!this.firecrawlClient.isConfigured()) {
      return {
        collectorKey,
        configured: false,
        evidence: [],
        queries,
        notes: [
          "Firecrawl is not configured. Industry collector returned no web evidence.",
        ],
      };
    }

    const searched = await collectSearchEvidence({
      client: this.firecrawlClient,
      queries,
      collectorKey,
      sourceType: "industry",
      relevance:
        "Industry structure, competition, and supply-chain evidence used to validate market positioning.",
      officialHosts,
    });

    return {
      collectorKey,
      configured: true,
      evidence: searched.evidence,
      queries,
      notes: searched.notes,
    };
  }

  curateEvidence(params: {
    brief: CompanyResearchBrief;
    questions: CompanyResearchQuestion[];
    collectedEvidenceByCollector: Partial<
      Record<CompanyResearchCollectorKey, CompanyEvidenceNote[]>
    >;
    collectorRunInfo: Partial<
      Record<CompanyResearchCollectorKey, CompanyResearchCollectorRunInfo>
    >;
    collectionNotes: string[];
  }): CuratedEvidenceResult {
    const allEvidence = Object.values(
      params.collectedEvidenceByCollector,
    ).flatMap((items) => items ?? []);

    const deduped = dedupeEvidenceByCanonicalUrl();
    for (const evidence of allEvidence) {
      deduped.pick(
        evidence,
        computeEvidenceScore({
          brief: params.brief,
          evidence,
          questions: params.questions,
        }),
      );
    }

    const ranked = deduped
      .values()
      .sort((left, right) => right.score - left.score)
      .slice(0, MAX_CURATED_REFERENCES)
      .map((item) => item.evidence);

    const references = ranked.map((item) => createReferenceItem(item));
    const referenceMap = new Map(
      references.map((item) => [item.id, item] as const),
    );
    const evidence = ranked.map((item) => {
      const reference = referenceMap.get(item.referenceId);
      return reference ? updateEvidenceWithReference(item, reference) : item;
    });

    const notes = uniqueStrings([
      ...params.collectionNotes,
      ...Object.values(params.collectorRunInfo).flatMap(
        (item) => item?.notes ?? [],
      ),
    ]);

    return {
      evidence,
      references,
      collectionSummary: buildCollectionSummary({
        collectedEvidenceByCollector: params.collectedEvidenceByCollector,
        selectedEvidence: evidence,
        collectorRunInfo: params.collectorRunInfo,
        notes,
      }),
      crawler: buildCrawlerSummary({
        firecrawlConfigured: this.firecrawlClient.isConfigured(),
        collectorRunInfo: params.collectorRunInfo,
        notes,
      }),
    };
  }

  async enrichReferences(params: {
    references: CompanyResearchReferenceItem[];
    evidence: CompanyEvidenceNote[];
  }): Promise<{
    references: CompanyResearchReferenceItem[];
    evidence: CompanyEvidenceNote[];
  }> {
    if (!this.firecrawlClient.isConfigured()) {
      return params;
    }

    const referencesToEnrich = params.references
      .filter(
        (item) =>
          item.sourceType !== "financial" &&
          !!item.url &&
          (item.snippet.length < 40 || item.extractedFact.length < 40),
      )
      .slice(0, MAX_ENRICHED_REFERENCES);

    if (referencesToEnrich.length === 0) {
      return params;
    }

    const updatedReferences = new Map<string, CompanyResearchReferenceItem>();
    await Promise.all(
      referencesToEnrich.map(async (reference) => {
        try {
          const document = await this.firecrawlClient.scrapeUrl(
            reference.url ?? "",
          );
          if (!document) {
            return;
          }

          const snippet = stripMarkdown(
            document.markdown ?? document.description,
            360,
          );

          updatedReferences.set(reference.id, {
            ...reference,
            title: document.title || reference.title,
            url: document.url || reference.url,
            snippet: snippet || reference.snippet,
            extractedFact: snippet || reference.extractedFact,
          });
        } catch {
          // Keep curated content when a single enrichment request fails.
        }
      }),
    );

    if (updatedReferences.size === 0) {
      return params;
    }

    const references = params.references.map(
      (reference) => updatedReferences.get(reference.id) ?? reference,
    );
    const referenceMap = new Map(references.map((item) => [item.id, item]));

    return {
      references,
      evidence: params.evidence.map((item) => {
        const reference = referenceMap.get(item.referenceId);
        return reference ? updateEvidenceWithReference(item, reference) : item;
      }),
    };
  }

  async answerQuestions(params: {
    brief: CompanyResearchBrief;
    questions: CompanyResearchQuestion[];
    evidence: CompanyEvidenceNote[];
    compressedFindings?: CompressedFindings;
  }): Promise<CompanyQuestionFinding[]> {
    const fallback = buildFallbackFindings(params.questions, params.evidence);

    if (params.evidence.length === 0) {
      return fallback;
    }

    const selectedByQuestion = new Map<string, CompanyEvidenceNote[]>();
    for (const question of params.questions) {
      const selected = [...params.evidence]
        .sort(
          (left, right) =>
            computeQuestionEvidenceScore(question, right) -
            computeQuestionEvidenceScore(question, left),
        )
        .slice(0, MAX_QUESTION_EVIDENCE);
      selectedByQuestion.set(question.question, selected);
    }

    const promptBody = params.questions
      .map((question) => {
        const evidenceList = selectedByQuestion.get(question.question) ?? [];
        return [
          `Question: ${question.question}`,
          `Why important: ${question.whyImportant}`,
          `Target metric: ${question.targetMetric}`,
          ...evidenceList.map(
            (item, index) =>
              `Evidence ${index + 1}: ${item.title}\nReference ID: ${item.referenceId}\nSource: ${item.sourceName}\nFact: ${item.extractedFact}\nSnippet: ${item.snippet}`,
          ),
        ].join("\n");
      })
      .join("\n\n---\n\n");

    const parsed = await this.deepSeekClient.completeJson<
      Array<{
        question: string;
        answer: string;
        confidence: "high" | "medium" | "low";
        gaps: string[];
      }>
    >(
      [
        {
          role: "system",
          content:
            "You are a company-research analyst. Answer each question using only the provided evidence. Output valid JSON. Use Simplified Chinese. If evidence is insufficient, say so explicitly.",
        },
        {
          role: "user",
          content: `Research brief:\n${JSON.stringify(
            params.brief,
            null,
            2,
          )}\n\nCompressed findings:\n${JSON.stringify(
            params.compressedFindings ?? null,
            null,
            2,
          )}\n\nQuestion packs:\n${promptBody}`,
        },
      ],
      fallback.map((item) => ({
        question: item.question,
        answer: item.answer,
        confidence: item.confidence,
        gaps: item.gaps,
      })),
    );

    return parsed.map((item, index) => {
      const question = params.questions[index];
      const selectedEvidence = question
        ? (selectedByQuestion.get(question.question) ?? [])
        : [];

      return {
        question: item.question,
        answer: item.answer,
        confidence: item.confidence,
        evidenceUrls: selectedEvidence
          .map((evidence) => evidence.url)
          .filter((url): url is string => Boolean(url)),
        referenceIds: selectedEvidence.map((evidence) => evidence.referenceId),
        gaps: item.gaps,
      };
    });
  }

  async buildVerdict(params: {
    brief: CompanyResearchBrief;
    conceptInsights: CompanyConceptInsight[];
    findings: CompanyQuestionFinding[];
  }): Promise<CompanyResearchVerdict> {
    const fallback = buildFallbackVerdict(params);

    return this.deepSeekClient.completeJson<CompanyResearchVerdict>(
      [
        {
          role: "system",
          content:
            "You are the investment-research lead. Produce a verdict in valid JSON. Use Simplified Chinese. The stance must stay within the provided enum values.",
        },
        {
          role: "user",
          content: JSON.stringify(params, null, 2),
        },
      ],
      fallback,
    );
  }

  async analyzeConfidence(params: {
    brief: CompanyResearchBrief;
    findings: CompanyQuestionFinding[];
    verdict: CompanyResearchVerdict;
    evidence: CompanyEvidenceNote[];
    references?: CompanyResearchReferenceItem[];
  }) {
    return this.confidenceAnalysisService.analyzeCompanyResearch(params);
  }

  buildFinalReport(params: {
    brief: CompanyResearchBrief;
    conceptInsights: CompanyConceptInsight[];
    deepQuestions: CompanyResearchQuestion[];
    findings: CompanyQuestionFinding[];
    evidence: CompanyEvidenceNote[];
    crawler: CompanyResearchResultDto["crawler"];
    verdict: CompanyResearchVerdict;
    confidenceAnalysis?: CompanyResearchResultDto["confidenceAnalysis"];
    references?: CompanyResearchReferenceItem[];
    collectionSummary?: CompanyResearchCollectionSummary;
    researchPlan?: ResearchUnitPlan[];
    researchNotes?: ResearchNote[];
    compressedFindings?: CompressedFindings;
    gapAnalysis?: ResearchGapAnalysis;
    runtimeConfigSummary?: Pick<
      ResearchRuntimeConfig,
      | "allowClarification"
      | "maxConcurrentResearchUnits"
      | "maxGapIterations"
      | "maxUnitsPerPlan"
      | "maxEvidencePerUnit"
    >;
  }): CompanyResearchResultDto {
    return {
      brief: params.brief,
      conceptInsights: params.conceptInsights,
      deepQuestions: params.deepQuestions,
      findings: params.findings,
      evidence: params.evidence,
      references: params.references ?? [],
      verdict: params.verdict,
      collectionSummary:
        params.collectionSummary ??
        ({
          collectors: [],
          totalRawCount: params.evidence.length,
          totalCuratedCount: params.evidence.length,
          totalReferenceCount:
            params.references?.length ?? params.evidence.length,
          totalFirstPartyCount: params.evidence.filter(
            (item) => item.isFirstParty,
          ).length,
          notes: params.crawler.notes,
        } satisfies CompanyResearchCollectionSummary),
      crawler: params.crawler,
      confidenceAnalysis: params.confidenceAnalysis,
      researchPlan: params.researchPlan ?? [],
      researchNotes: params.researchNotes ?? [],
      compressedFindings: params.compressedFindings,
      gapAnalysis: params.gapAnalysis,
      runtimeConfigSummary: params.runtimeConfigSummary,
      generatedAt: new Date().toISOString(),
    };
  }

  async collectEvidence(params: {
    brief: CompanyResearchBrief;
    questions: CompanyResearchQuestion[];
  }): Promise<{
    evidence: CompanyEvidenceNote[];
    crawler: CompanyResearchResultDto["crawler"];
  }> {
    const grounded = this.groundSources({
      input: {
        companyName: params.brief.companyName,
        stockCode: params.brief.stockCode,
        officialWebsite: params.brief.officialWebsite,
      },
      brief: params.brief,
    });

    const conceptInsights = buildFallbackConceptInsights(params.brief);
    const collectorOutputs = await Promise.all([
      this.collectOfficialSources({
        brief: params.brief,
        groundedSources: grounded.groundedSources,
      }),
      this.collectFinancialSources({
        brief: params.brief,
        conceptInsights,
      }),
      this.collectNewsSources({
        brief: params.brief,
        questions: params.questions,
        groundedSources: grounded.groundedSources,
      }),
      this.collectIndustrySources({
        brief: params.brief,
        questions: params.questions,
      }),
    ]);

    const collectedEvidenceByCollector = Object.fromEntries(
      collectorOutputs.map((item) => [item.collectorKey, item.evidence]),
    ) as Partial<Record<CompanyResearchCollectorKey, CompanyEvidenceNote[]>>;
    const collectorRunInfo = Object.fromEntries(
      collectorOutputs.map((item) => [
        item.collectorKey,
        {
          collectorKey: item.collectorKey,
          configured: item.configured,
          queries: item.queries,
          notes: item.notes,
        },
      ]),
    ) as Partial<
      Record<CompanyResearchCollectorKey, CompanyResearchCollectorRunInfo>
    >;

    const curated = this.curateEvidence({
      brief: params.brief,
      questions: params.questions,
      collectedEvidenceByCollector,
      collectorRunInfo,
      collectionNotes: grounded.notes,
    });

    return {
      evidence: curated.evidence,
      crawler: curated.crawler,
    };
  }

  buildCollectorState(output: CollectorOutput) {
    return {
      collectedEvidenceByCollector: {
        [output.collectorKey]: output.evidence,
      } satisfies Partial<
        Record<CompanyResearchCollectorKey, CompanyEvidenceNote[]>
      >,
      collectorRunInfo: {
        [output.collectorKey]: {
          collectorKey: output.collectorKey,
          configured: output.configured,
          queries: output.queries,
          notes: output.notes,
        },
      } satisfies Partial<
        Record<CompanyResearchCollectorKey, CompanyResearchCollectorRunInfo>
      >,
      collectorPacks: output.pack
        ? {
            [output.collectorKey]: output.pack,
          }
        : {},
      collectionNotes: output.notes,
    };
  }

  buildLegacyQueries(
    brief: CompanyResearchBrief,
    questions: CompanyResearchQuestion[],
  ) {
    return buildLegacySearchQueries(brief, questions);
  }
}
