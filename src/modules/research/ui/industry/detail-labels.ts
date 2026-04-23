const sourceTypeLabelMap: Record<string, string> = {
  official: "官网",
  financial: "财务",
  news: "新闻",
  industry: "行业",
};

const sourceTierLabelMap: Record<string, string> = {
  first_party: "一手",
  third_party: "第三方",
};

const claimLabelMap: Record<string, string> = {
  supported: "已支持",
  insufficient: "证据不足",
  contradicted: "存在冲突",
  abstain: "暂不判断",
};

const researchStatusLabelMap: Record<string, string> = {
  planned: "已计划",
  pending: "待执行",
  running: "进行中",
  completed: "已完成",
  failed: "失败",
  skipped: "已跳过",
};

const reflectionStatusLabelMap: Record<string, string> = {
  pass: "通过",
  fail: "失败",
  warn: "需关注",
};

const priorityLabelMap: Record<string, string> = {
  high: "高优先级",
  medium: "中优先级",
  low: "低优先级",
};

const capabilityLabelMap: Record<string, string> = {
  official_sources: "官网信源",
  financial_sources: "财务信源",
  news_sources: "新闻信源",
  industry_sources: "行业信源",
  web_search: "网页搜索",
  official_search: "官网检索",
  news_search: "新闻搜索",
  industry_search: "行业检索",
  page_scrape: "页面抓取",
  financial_pack: "财务数据包",
  theme_overview: "主题总览",
  market_heat: "市场热度",
  candidate_screening: "候选筛选",
  credibility_lookup: "可信度核验",
  competition_synthesis: "竞争格局综合",
  research_analyst: "研究分析",
  unknown: "未知",
};

const roleLabelMap: Record<string, string> = {
  junior_researcher: "初级研究员",
  senior_analyst: "高级分析师",
  screening_analyst: "筛选分析师",
  validation_analyst: "验证分析师",
  lead_analyst: "主分析师",
  official_collector: "官网资料研究员",
  news_collector: "新闻资料研究员",
  industry_collector: "行业资料研究员",
  first_party_verifier: "一手页面核验员",
  financial_collector: "财务数据研究员",
  research_analyst: "研究分析师",
};

const artifactLabelMap: Record<string, string> = {
  research_note: "研究备忘录",
  artifact: "研究产出",
  research_artifact: "研究产出",
  trend_snapshot: "主题趋势快照",
  market_heat_assessment: "热度评估",
  candidate_list: "候选清单",
  credibility_matrix: "可信度矩阵",
  competition_summary: "竞争格局总结",
  official_evidence_bundle: "官网证据包",
  financial_evidence_bundle: "财务证据包",
  news_evidence_bundle: "新闻证据包",
  industry_evidence_bundle: "行业证据包",
  first_party_page_bundle: "一手页面证据包",
};

const replanActionLabelMap: Record<string, string> = {
  expand_sources: "扩展信源",
};

const runtimeIssueLabelMap: Record<string, string> = {
  source_coverage_low: "信源覆盖不足",
  citation_coverage_low: "引用覆盖不足",
  citation_coverage_below_target: "引用覆盖未达到目标",
  financial_pack_unavailable: "财务数据包不可用",
  unit_failed: "研究单元失败",
  first_party_low: "一手信源覆盖不足",
  missing_required_sections: "缺少必填章节",
  no_theme_news: "缺少主题新闻",
  no_heat_news: "缺少热度新闻",
  no_candidates: "缺少候选标的",
  gap_followup: "需要补充求证",
  reflection_fail: "反思校验未通过",
  "missing_section:top_picks": "缺少章节：重点标的",
};

const workflowNodeLabelMap: Record<string, string> = {
  collect_company_evidence: "采集公司证据",
  agent0_clarify_scope: "澄清研究范围",
  agent1_extract_research_spec: "提炼研究任务",
  agent1_company_briefing: "梳理公司简报",
  agent1_write_research_brief: "撰写研究简报",
  agent2_concept_mapping: "映射业务概念",
  agent2_plan_research_units: "规划研究单元",
  agent2_trend_analysis: "分析主题趋势",
  agent3_question_design: "设计关键问题",
  agent3_execute_research_units: "执行研究单元",
  agent3_source_grounding: "锚定信源范围",
  agent3_candidate_screening: "筛选候选标的",
  agent4_evidence_collection: "采集研究证据",
  agent4_evidence_curation: "整理研究证据",
  agent4_source_grounding: "锚定信源范围",
  agent4_synthesis: "整合研究结论",
  agent4_credibility_and_competition: "核验可信度与竞争格局",
  agent5_gap_analysis: "分析研究缺口",
  agent5_gap_analysis_and_replan: "分析缺口并重规划",
  agent5_investment_synthesis: "生成投资结论",
  agent5_report_synthesis: "汇总研究报告",
  agent6_compress_findings: "压缩研究发现",
  agent6_reflection: "反思校验",
  agent7_reference_enrichment: "补充引用证据",
  agent8_finalize_report: "整理最终报告",
  agent8_investment_synthesis: "生成投资结论",
  agent9_evidence_curation: "整理研究证据",
  agent9_reflection: "反思校验",
  agent10_reference_enrichment: "补充引用证据",
  agent11_investment_synthesis: "生成投资结论",
  collector_official_sources: "采集官网信源",
  collector_financial_sources: "采集财务信源",
  collector_news_sources: "采集新闻信源",
  collector_industry_sources: "采集行业信源",
  load_run_context: "载入运行上下文",
  screen_candidates: "筛选候选标的",
  collect_evidence_batch: "批量采集证据",
  synthesize_insights: "整合筛选洞察",
  validate_insights: "校验洞察质量",
  review_gate: "人工复核关口",
  archive_insights: "归档洞察结果",
  schedule_review_reminders: "安排复盘提醒",
  archive_empty_result: "归档空结果",
  notify_user: "通知用户",
  load_targets: "载入分析标的",
  fetch_signal_snapshots: "抓取信号快照",
  fetch_signal_snapshots_batch: "批量抓取信号快照",
  technical_signal_agent: "技术信号研判",
  timing_synthesis_agent: "综合择时结论",
  persist_cards: "写入择时卡片",
  load_watchlist_context: "载入自选股上下文",
  market_regime_agent: "市场环境判断",
  watchlist_risk_manager: "组合风险约束",
  watchlist_portfolio_manager: "组合动作建议",
  persist_recommendations: "写入组合建议",
  load_screening_results: "载入筛选结果",
  select_top_candidates: "挑选重点标的",
  run_timing_pipeline: "执行择时流程",
  archive_results: "归档分析结果",
  load_due_reviews: "载入待复盘任务",
  evaluate_outcomes: "评估实际结果",
  review_agent: "生成复盘结论",
  persist_reviews: "写入复盘记录",
  schedule_next_review: "安排下一次复盘",
};

const researchUnitIdLabelMap: Record<string, string> = {
  business_model: "商业模式",
  financial_quality: "财务质量",
  recent_events: "近期催化",
  industry_landscape: "行业格局",
  first_party_pages: "一手页面核验",
  theme_overview: "主题总览",
  market_heat: "市场热度",
  candidate_screening: "候选筛选",
  credibility_lookup: "可信度核验",
  competition_synthesis: "竞争格局综合",
};

const acceptanceCriteriaLabelMap: Record<string, string> = {
  "Summarize the investable theme in one concise paragraph.":
    "用一段精炼文字说明当前主题的投资主线。",
  "Include at least one concrete catalyst or market context signal.":
    "至少指出一个明确催化剂或市场环境信号。",
  "Return a bounded heat score and a short conclusion.":
    "输出有边界的热度分数和简短结论。",
  "Tie the score to observable news or market behavior.":
    "把分数和可观察到的新闻或市场表现对应起来。",
  "Return at least one candidate when the topic is investable.":
    "若主题具备投资价值，至少给出一个候选标的。",
  "Each candidate must include a concrete reason.":
    "每个候选标的都要附上明确理由。",
  "Validate the top candidates against external evidence.":
    "用外部证据核验重点候选标的。",
  "Surface at least one supporting point or one risk per candidate.":
    "每个候选标的至少给出一个支持点或一个风险点。",
  "Rank candidate quality or industry positioning.":
    "比较候选质量或行业位置，并给出排序。",
  "Explain the comparison in investor-friendly language.":
    "用投资者易理解的语言解释比较结论。",
  "Prefer first-party or near first-party disclosures.":
    "优先采用公司公告、官网或招股书等一手披露。",
  "Return URLs that can support downstream citations.":
    "返回可用于后续引用的链接。",
  "Return recent event evidence tied to catalysts or risks.":
    "返回与催化剂或风险点相关的近期事件证据。",
  "Avoid purely repetitive or low-signal coverage.":
    "避免重复性强、信息量低的内容。",
  "Map competition or supply-chain position.": "梳理竞争格局或产业链位置。",
  "Return evidence that helps answer strategic questions.":
    "返回能回答关键战略问题的证据。",
  "Extract verifiable first-party facts from the page.":
    "从页面中提取可核验的一手事实。",
  "Preserve the source URL for citation coverage.":
    "保留来源链接，便于后续引用。",
  "Return structured financial evidence when stock code exists.":
    "在有股票代码时返回结构化财务证据。",
  "Explain data gaps explicitly when no pack is returned.":
    "若未取到数据包，需要明确说明数据缺口。",
  "Return a concise, valid artifact for downstream synthesis.":
    "输出可供后续综合的精炼研究产出。",
};

const resultSummaryLabelMap: Record<string, string> = {
  "Some important questions remain under-supported and need a bounded follow-up search.":
    "仍有关键问题证据不足，需要追加一轮有边界的补充检索。",
  "Current evidence is sufficient for synthesis at this iteration.":
    "当前这一轮证据已足够进入综合判断。",
};

function formatFollowupLabel(value: string) {
  const match = /^follow[\s-_]?up(?:_(\d+))?(?:_(\d+))?$/i.exec(value);
  if (!match) {
    return null;
  }

  const index = match[2] ?? match[1] ?? "1";
  return `补充求证 ${Number(index)}`;
}

export function formatSourceTypeLabel(value: string) {
  return sourceTypeLabelMap[value] ?? value;
}

export function formatSourceTierLabel(value: string) {
  return sourceTierLabelMap[value] ?? value;
}

export function formatClaimLabel(value: string) {
  return claimLabelMap[value] ?? value;
}

export function formatResearchStatusLabel(value: string) {
  return researchStatusLabelMap[value] ?? value;
}

export function formatReflectionStatusLabel(value: string) {
  return reflectionStatusLabelMap[value] ?? formatResearchStatusLabel(value);
}

export function formatResearchPriorityLabel(value: string) {
  return priorityLabelMap[value] ?? value;
}

export function formatResearchCapabilityLabel(value: string) {
  return capabilityLabelMap[value] ?? workflowNodeLabelMap[value] ?? value;
}

export function formatResearchRoleLabel(value: string) {
  return roleLabelMap[value] ?? capabilityLabelMap[value] ?? value;
}

export function formatResearchArtifactLabel(value: string) {
  return artifactLabelMap[value] ?? capabilityLabelMap[value] ?? value;
}

export function formatResearchUnitTitle(
  unitId?: string | null,
  title?: string,
) {
  const normalizedId = unitId?.trim().toLowerCase();
  const normalizedTitle = title?.trim();

  if (normalizedId) {
    const mappedById = researchUnitIdLabelMap[normalizedId];
    if (mappedById) {
      return mappedById;
    }

    const followupById = formatFollowupLabel(normalizedId);
    if (followupById) {
      return followupById;
    }
  }

  if (normalizedTitle) {
    const followupByTitle = formatFollowupLabel(normalizedTitle);
    if (followupByTitle) {
      return followupByTitle;
    }

    const titleKey = normalizedTitle.toLowerCase().replace(/\s+/g, "_");
    const mappedByTitle = researchUnitIdLabelMap[titleKey];
    if (mappedByTitle) {
      return mappedByTitle;
    }
  }

  return normalizedTitle ?? unitId ?? "-";
}

export function formatResearchAcceptanceCriteria(value: string) {
  return acceptanceCriteriaLabelMap[value] ?? value;
}

export function formatResearchResultSummary(value: string) {
  return resultSummaryLabelMap[value] ?? value;
}

export function formatReplanActionLabel(value: string) {
  return replanActionLabelMap[value] ?? formatRuntimeIssueLabel(value);
}

export function formatRuntimeIssueLabel(value: string) {
  return runtimeIssueLabelMap[value] ?? value;
}

export function formatWorkflowNodeLabel(value?: string | null) {
  if (!value) {
    return "-";
  }

  return workflowNodeLabelMap[value] ?? value;
}
