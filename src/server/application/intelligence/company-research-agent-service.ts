import type { ConfidenceAnalysisService } from "~/server/application/intelligence/confidence-analysis-service";
import type {
  CompanyConceptInsight,
  CompanyEvidenceNote,
  CompanyQuestionFinding,
  CompanyResearchBrief,
  CompanyResearchInput,
  CompanyResearchQuestion,
  CompanyResearchResultDto,
  CompanyResearchVerdict,
} from "~/server/domain/workflow/types";
import type { DeepSeekClient } from "~/server/infrastructure/intelligence/deepseek-client";
import type {
  FirecrawlClient,
  FirecrawlScrapeDocument,
  FirecrawlSearchResult,
} from "~/server/infrastructure/intelligence/firecrawl-client";

export type CompanyResearchAgentServiceDependencies = {
  deepSeekClient: DeepSeekClient;
  firecrawlClient: FirecrawlClient;
  confidenceAnalysisService: ConfidenceAnalysisService;
};

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

function splitTags(values?: string[]) {
  return [
    ...new Set((values ?? []).map((item) => item.trim()).filter(Boolean)),
  ];
}

function stripMarkdown(value?: string, maxLength = 240) {
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

function buildFallbackBrief(input: CompanyResearchInput): CompanyResearchBrief {
  const focusConcepts = splitTags(
    input.focusConcepts?.length
      ? input.focusConcepts
      : ["主营业务", "新业务", "研发投入", "资本开支"],
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
    maturity: index === 0 ? "核心成熟" : index === 1 ? "成长加速" : "验证阶段",
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
  return questions.map((question, index) => ({
    question: question.question,
    answer:
      evidence[index]?.extractedFact ??
      "当前公开资料未直接给出可核验答案，需要继续查找财报附注、交流纪要或官网披露。",
    confidence: evidence[index] ? "medium" : "low",
    evidenceUrls: evidence[index] ? [evidence[index].url] : [],
    gaps: evidence[index]
      ? ["仍需用财报口径交叉核对具体占比"]
      : [question.dataHint],
  }));
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
      ? "优先研究"
      : mediumConfidenceCount >= 2
        ? "继续跟踪"
        : "暂不优先";

  return {
    stance,
    summary: `${params.brief.companyName} 当前更适合作为${stance === "优先研究" ? "优先深挖" : stance === "继续跟踪" ? "持续跟踪" : "低优先级观察"}对象，关键在于验证 ${params.conceptInsights[0]?.concept ?? "核心概念"} 是否真正转化为利润。`,
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

function mapSearchResultToEvidence(
  result: FirecrawlSearchResult,
  sourceType: CompanyEvidenceNote["sourceType"],
): CompanyEvidenceNote {
  const snippet = stripMarkdown(result.markdown ?? result.description, 280);

  return {
    title: result.title,
    url: result.url,
    sourceType,
    snippet,
    extractedFact: snippet || "命中相关网页，但需要进一步展开阅读原文。",
    relevance: "用于补齐概念兑现、利润贡献和投入强度的外部线索。",
  };
}

function mapScrapeDocumentToEvidence(
  document: FirecrawlScrapeDocument,
): CompanyEvidenceNote {
  const snippet = stripMarkdown(document.markdown ?? document.description, 320);

  return {
    title: document.title,
    url: document.url,
    sourceType: "official",
    snippet,
    extractedFact:
      snippet || "官网页面已抓取，但尚未发现可直接引用的关键事实。",
    relevance: "用于确认公司官方表述、业务定位与投资者沟通口径。",
  };
}

function dedupeEvidence(evidence: CompanyEvidenceNote[]) {
  const unique = new Map<string, CompanyEvidenceNote>();

  for (const item of evidence) {
    if (!unique.has(item.url)) {
      unique.set(item.url, item);
    }
  }

  return [...unique.values()];
}

function buildSearchQueries(
  brief: CompanyResearchBrief,
  questions: CompanyResearchQuestion[],
) {
  const leadConcept = brief.focusConcepts[0] ?? "新业务";

  return [
    `${brief.companyName} ${leadConcept} 收入占比 利润占比 财报`,
    `${brief.companyName} ${leadConcept} 研发投入 资本开支 利润`,
    `${brief.companyName} 投资者关系 ${questions[0]?.targetMetric ?? "新业务收入占比"}`,
  ];
}

export class CompanyResearchAgentService {
  private readonly deepSeekClient: DeepSeekClient;
  private readonly firecrawlClient: FirecrawlClient;
  private readonly confidenceAnalysisService: ConfidenceAnalysisService;

  constructor(dependencies: CompanyResearchAgentServiceDependencies) {
    this.deepSeekClient = dependencies.deepSeekClient;
    this.firecrawlClient = dependencies.firecrawlClient;
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
            "你是股票投研助手。请把用户输入整理为公司研究任务简报，输出 JSON，字段必须包含 companyName、stockCode、officialWebsite、researchGoal、focusConcepts、keyQuestions。focusConcepts 和 keyQuestions 都必须是数组。",
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
            "你是公司研究员。请围绕公司研究任务输出 3-5 条概念解析，输出 JSON 数组。每条包含 concept、whyItMatters、companyFit、monetizationPath、maturity。maturity 只能是 核心成熟 / 成长加速 / 验证阶段。",
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
            "你是基本面研究员。请输出 4-6 个需要深入验证的问题，重点关注利润来源、投入强度、技术兑现和概念含金量。输出 JSON 数组，每条包含 question、whyImportant、targetMetric、dataHint。",
        },
        {
          role: "user",
          content: JSON.stringify(params, null, 2),
        },
      ],
      fallback,
    );
  }

  async collectEvidence(params: {
    brief: CompanyResearchBrief;
    questions: CompanyResearchQuestion[];
  }): Promise<{
    evidence: CompanyEvidenceNote[];
    crawler: CompanyResearchResultDto["crawler"];
  }> {
    const queries = buildSearchQueries(params.brief, params.questions);
    const notes: string[] = [];

    if (!this.firecrawlClient.isConfigured()) {
      notes.push("未配置 Firecrawl，当前仅保留研究问题与手工核验方向。");

      return {
        evidence: [],
        crawler: {
          provider: "firecrawl",
          configured: false,
          queries,
          notes,
        },
      };
    }

    const collectedEvidence: CompanyEvidenceNote[] = [];

    if (params.brief.officialWebsite) {
      try {
        const officialDocument = await this.firecrawlClient.scrapeUrl(
          params.brief.officialWebsite,
        );

        if (officialDocument) {
          collectedEvidence.push(mapScrapeDocumentToEvidence(officialDocument));
        }
      } catch (error) {
        notes.push(
          `官网抓取失败: ${error instanceof Error ? error.message : "unknown error"}`,
        );
      }
    }

    for (const query of queries) {
      try {
        const searchResults = await this.firecrawlClient.search({
          query,
          limit: 3,
        });

        collectedEvidence.push(
          ...searchResults.map((result, index) =>
            mapSearchResultToEvidence(
              result,
              index === 0 ? "official" : index === 1 ? "news" : "industry",
            ),
          ),
        );
      } catch (error) {
        notes.push(
          `搜索失败 (${query}): ${error instanceof Error ? error.message : "unknown error"}`,
        );
      }
    }

    const evidence = dedupeEvidence(collectedEvidence).slice(0, 10);

    if (evidence.length === 0) {
      notes.push(
        "Firecrawl 已启用，但本次未抓到可用网页证据。建议补充官网、IR 页面或更精确的关键词。",
      );
    }

    return {
      evidence,
      crawler: {
        provider: "firecrawl",
        configured: true,
        queries,
        notes,
      },
    };
  }

  async answerQuestions(params: {
    brief: CompanyResearchBrief;
    questions: CompanyResearchQuestion[];
    evidence: CompanyEvidenceNote[];
  }): Promise<CompanyQuestionFinding[]> {
    const fallback = buildFallbackFindings(params.questions, params.evidence);

    if (params.evidence.length === 0) {
      return fallback;
    }

    const evidenceContext = params.evidence
      .map(
        (item, index) =>
          `[#${index + 1}] ${item.title}\nURL: ${item.url}\n类型: ${item.sourceType}\n摘要: ${item.snippet}\n提取事实: ${item.extractedFact}`,
      )
      .join("\n\n");

    return this.deepSeekClient.completeJson<CompanyQuestionFinding[]>(
      [
        {
          role: "system",
          content:
            "你是公司深度研究员。请根据证据回答问题，输出 JSON 数组。每条包含 question、answer、confidence、evidenceUrls、gaps。confidence 只能是 high / medium / low。不要编造数据；若证据不足，明确写出缺口。",
        },
        {
          role: "user",
          content: `研究简报:\n${JSON.stringify(params.brief, null, 2)}\n\n问题列表:\n${JSON.stringify(params.questions, null, 2)}\n\n证据:\n${evidenceContext}`,
        },
      ],
      fallback,
    );
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
            "你是投资研究负责人。请基于概念解析和问题发现给出研究判断，输出 JSON，字段必须包含 stance、summary、bullPoints、bearPoints、nextChecks。stance 只能是 优先研究 / 继续跟踪 / 暂不优先。",
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
  }): CompanyResearchResultDto {
    return {
      brief: params.brief,
      conceptInsights: params.conceptInsights,
      deepQuestions: params.deepQuestions,
      findings: params.findings,
      evidence: params.evidence,
      crawler: params.crawler,
      verdict: params.verdict,
      confidenceAnalysis: params.confidenceAnalysis,
      generatedAt: new Date().toISOString(),
    };
  }
}
