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
  news_search: "新闻搜索",
  theme_overview: "主题总览",
  research_analyst: "研究分析",
  unknown: "未知",
};

const artifactLabelMap: Record<string, string> = {
  research_note: "研究备忘录",
  artifact: "研究产出",
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
  "missing_section:top_picks": "缺少章节：重点标的",
};

const workflowNodeLabelMap: Record<string, string> = {
  collect_company_evidence: "采集公司证据",
  agent0_clarify_scope: "澄清研究范围",
  agent1_company_briefing: "梳理公司简报",
  agent1_write_research_brief: "撰写研究简报",
  agent2_concept_mapping: "映射业务概念",
  agent2_plan_research_units: "规划研究单元",
  agent3_question_design: "设计关键问题",
  agent3_execute_research_units: "执行研究单元",
  agent3_source_grounding: "锚定信源范围",
  agent4_evidence_collection: "采集研究证据",
  agent4_evidence_curation: "整理研究证据",
  agent4_source_grounding: "锚定信源范围",
  agent4_synthesis: "整合研究结论",
  agent5_gap_analysis: "分析研究缺口",
  agent5_gap_analysis_and_replan: "分析缺口并重规划",
  agent5_investment_synthesis: "生成投资结论",
  agent6_compress_findings: "压缩研究发现",
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
};

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
  return capabilityLabelMap[value] ?? value;
}

export function formatResearchArtifactLabel(value: string) {
  return artifactLabelMap[value] ?? capabilityLabelMap[value] ?? value;
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
