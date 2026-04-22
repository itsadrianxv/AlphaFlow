import type {
  WorkflowDiagramEdge,
  WorkflowDiagramLane,
  WorkflowDiagramNode,
  WorkflowDiagramSpec,
} from "~/app/workflows/workflow-diagram";

type DiagramTemplateCode =
  | "quick_industry_research"
  | "company_research_center"
  | "timing_signal_pipeline_v1"
  | "watchlist_timing_cards_pipeline_v1"
  | "watchlist_timing_pipeline_v1"
  | "timing_review_loop_v1";

type DiagramDraftNode = Omit<WorkflowDiagramNode, "width" | "height"> & {
  width?: number;
  height?: number;
};

const defaultNodeSize = {
  width: 168,
  height: 64,
} as const;

const lanes = {
  scope: {
    id: "scope",
    label: "范围定义",
    y: 24,
    height: 88,
  },
  collect: {
    id: "collect",
    label: "信息采集",
    y: 136,
    height: 112,
  },
  review: {
    id: "review",
    label: "校验复核",
    y: 272,
    height: 88,
  },
  report: {
    id: "report",
    label: "结论输出",
    y: 384,
    height: 88,
  },
} satisfies Record<string, WorkflowDiagramLane>;

function toNode(node: DiagramDraftNode): WorkflowDiagramNode {
  return {
    ...node,
    width: node.width ?? defaultNodeSize.width,
    height: node.height ?? defaultNodeSize.height,
  };
}

function buildSpec(params: {
  templateCode: DiagramTemplateCode;
  templateVersion: number;
  title: string;
  layout: WorkflowDiagramSpec["layout"];
  lanes: WorkflowDiagramLane[];
  nodes: DiagramDraftNode[];
  edges: WorkflowDiagramEdge[];
}): WorkflowDiagramSpec {
  return {
    templateCode: params.templateCode,
    templateVersion: params.templateVersion,
    title: params.title,
    layout: params.layout,
    lanes: params.lanes,
    nodes: params.nodes.map(toNode),
    edges: params.edges,
  };
}

const quickResearchV3 = buildSpec({
  templateCode: "quick_industry_research",
  templateVersion: 3,
  title: "行业研究流程图",
  layout: {
    width: 1260,
    height: 500,
  },
  lanes: [lanes.scope, lanes.collect, lanes.review, lanes.report],
  nodes: [
    {
      id: "agent0_clarify_scope",
      label: "澄清研究范围",
      description: "明确主题、边界与约束条件。",
      kind: "agent",
      laneId: "scope",
      x: 48,
      y: 36,
    },
    {
      id: "agent1_extract_research_spec",
      label: "提炼研究任务",
      description: "生成研究简报和执行单元。",
      kind: "agent",
      laneId: "scope",
      x: 256,
      y: 36,
    },
    {
      id: "agent2_trend_analysis",
      label: "分析主题趋势",
      description: "判断主题热度与资金动能。",
      kind: "agent",
      laneId: "collect",
      x: 48,
      y: 160,
    },
    {
      id: "agent3_candidate_screening",
      label: "筛选候选标的",
      description: "筛出值得继续跟踪的标的。",
      kind: "agent",
      laneId: "collect",
      x: 256,
      y: 160,
    },
    {
      id: "agent4_credibility_and_competition",
      label: "核验可信度与竞争格局",
      description: "校验证据质量并比较竞争位置。",
      kind: "agent",
      laneId: "collect",
      x: 464,
      y: 160,
    },
    {
      id: "agent5_report_synthesis",
      label: "汇总研究报告",
      description: "生成行业研究结论。",
      kind: "agent",
      laneId: "report",
      x: 672,
      y: 396,
    },
    {
      id: "agent6_reflection",
      label: "反思校验",
      description: "评估质量、缺口与重规划需求。",
      kind: "gate",
      laneId: "review",
      x: 880,
      y: 284,
    },
  ],
  edges: [
    { from: "agent0_clarify_scope", to: "agent1_extract_research_spec" },
    { from: "agent1_extract_research_spec", to: "agent2_trend_analysis" },
    { from: "agent2_trend_analysis", to: "agent3_candidate_screening" },
    {
      from: "agent3_candidate_screening",
      to: "agent4_credibility_and_competition",
    },
    {
      from: "agent4_credibility_and_competition",
      to: "agent5_report_synthesis",
    },
    { from: "agent5_report_synthesis", to: "agent6_reflection" },
    {
      from: "agent6_reflection",
      to: "agent1_extract_research_spec",
      label: "replan",
    },
  ],
});

const companyResearchV1 = buildSpec({
  templateCode: "company_research_center",
  templateVersion: 1,
  title: "公司研究流程图 v1",
  layout: {
    width: 1120,
    height: 500,
  },
  lanes: [lanes.scope, lanes.collect, lanes.report],
  nodes: [
    {
      id: "agent1_company_briefing",
      label: "梳理公司简报",
      description: "生成公司研究简报。",
      kind: "agent",
      laneId: "scope",
      x: 48,
      y: 36,
    },
    {
      id: "agent2_concept_mapping",
      label: "映射业务概念",
      description: "梳理业务与概念的匹配关系。",
      kind: "agent",
      laneId: "collect",
      x: 256,
      y: 160,
    },
    {
      id: "agent3_question_design",
      label: "设计关键问题",
      description: "设计需要深挖的核心问题。",
      kind: "agent",
      laneId: "scope",
      x: 464,
      y: 36,
    },
    {
      id: "agent4_evidence_collection",
      label: "采集研究证据",
      description: "收集可验证的证据包。",
      kind: "tool",
      laneId: "collect",
      x: 672,
      y: 160,
    },
    {
      id: "agent5_investment_synthesis",
      label: "生成投资结论",
      description: "输出最终投资判断。",
      kind: "agent",
      laneId: "report",
      x: 880,
      y: 396,
    },
  ],
  edges: [
    { from: "agent1_company_briefing", to: "agent2_concept_mapping" },
    { from: "agent2_concept_mapping", to: "agent3_question_design" },
    { from: "agent3_question_design", to: "agent4_evidence_collection" },
    { from: "agent4_evidence_collection", to: "agent5_investment_synthesis" },
  ],
});

const companyResearchV2 = buildSpec({
  templateCode: "company_research_center",
  templateVersion: 2,
  title: "公司研究流程图 v2",
  layout: {
    width: 1460,
    height: 500,
  },
  lanes: [lanes.scope, lanes.collect, lanes.report],
  nodes: [
    {
      id: "agent1_company_briefing",
      label: "梳理公司简报",
      description: "生成公司研究简报。",
      kind: "agent",
      laneId: "scope",
      x: 40,
      y: 36,
    },
    {
      id: "agent2_concept_mapping",
      label: "映射业务概念",
      description: "梳理核心业务概念。",
      kind: "agent",
      laneId: "collect",
      x: 248,
      y: 160,
    },
    {
      id: "agent3_question_design",
      label: "设计关键问题",
      description: "定义本轮研究问题。",
      kind: "agent",
      laneId: "scope",
      x: 456,
      y: 36,
    },
    {
      id: "agent4_source_grounding",
      label: "锚定信源范围",
      description: "规划本轮优先信源。",
      kind: "agent",
      laneId: "collect",
      x: 664,
      y: 160,
    },
    {
      id: "collector_official_sources",
      label: "采集官网信源",
      description: "抓取官网和公告等一手资料。",
      kind: "tool",
      laneId: "collect",
      x: 872,
      y: 136,
      width: 152,
      height: 56,
    },
    {
      id: "collector_financial_sources",
      label: "采集财务信源",
      description: "抓取财报和财务数据。",
      kind: "tool",
      laneId: "collect",
      x: 872,
      y: 200,
      width: 152,
      height: 56,
    },
    {
      id: "collector_news_sources",
      label: "采集新闻信源",
      description: "抓取近期新闻与催化事件。",
      kind: "tool",
      laneId: "collect",
      x: 1048,
      y: 136,
      width: 152,
      height: 56,
    },
    {
      id: "collector_industry_sources",
      label: "采集行业信源",
      description: "抓取行业格局与产业链资料。",
      kind: "tool",
      laneId: "collect",
      x: 1048,
      y: 200,
      width: 152,
      height: 56,
    },
    {
      id: "agent9_evidence_curation",
      label: "整理研究证据",
      description: "筛选并整理已采集证据。",
      kind: "agent",
      laneId: "collect",
      x: 1224,
      y: 160,
    },
    {
      id: "agent10_reference_enrichment",
      label: "补充引用证据",
      description: "补充结论所需引用。",
      kind: "tool",
      laneId: "report",
      x: 1224,
      y: 396,
    },
    {
      id: "agent11_investment_synthesis",
      label: "生成投资结论",
      description: "输出最终投资判断。",
      kind: "agent",
      laneId: "report",
      x: 1008,
      y: 396,
    },
  ],
  edges: [
    { from: "agent1_company_briefing", to: "agent2_concept_mapping" },
    { from: "agent2_concept_mapping", to: "agent3_question_design" },
    { from: "agent3_question_design", to: "agent4_source_grounding" },
    { from: "agent4_source_grounding", to: "collector_official_sources" },
    { from: "agent4_source_grounding", to: "collector_financial_sources" },
    { from: "agent4_source_grounding", to: "collector_news_sources" },
    { from: "agent4_source_grounding", to: "collector_industry_sources" },
    { from: "collector_official_sources", to: "agent9_evidence_curation" },
    { from: "collector_financial_sources", to: "agent9_evidence_curation" },
    { from: "collector_news_sources", to: "agent9_evidence_curation" },
    { from: "collector_industry_sources", to: "agent9_evidence_curation" },
    { from: "agent9_evidence_curation", to: "agent10_reference_enrichment" },
    {
      from: "agent10_reference_enrichment",
      to: "agent11_investment_synthesis",
    },
  ],
});

const companyResearchV3 = buildSpec({
  templateCode: "company_research_center",
  templateVersion: 3,
  title: "公司研究流程图 v3",
  layout: {
    width: 1320,
    height: 500,
  },
  lanes: [lanes.scope, lanes.collect, lanes.review, lanes.report],
  nodes: [
    {
      id: "agent0_clarify_scope",
      label: "澄清研究范围",
      description: "澄清本轮研究的范围与重点。",
      kind: "agent",
      laneId: "scope",
      x: 40,
      y: 36,
    },
    {
      id: "agent1_write_research_brief",
      label: "撰写研究简报",
      description: "整理本轮研究简报。",
      kind: "agent",
      laneId: "scope",
      x: 248,
      y: 36,
    },
    {
      id: "agent2_plan_research_units",
      label: "规划研究单元",
      description: "拆分研究任务与依赖关系。",
      kind: "agent",
      laneId: "scope",
      x: 456,
      y: 36,
    },
    {
      id: "agent3_execute_research_units",
      label: "执行研究单元",
      description: "执行各个研究单元。",
      kind: "agent",
      laneId: "collect",
      x: 664,
      y: 160,
    },
    {
      id: "agent4_evidence_curation",
      label: "整理研究证据",
      description: "整理已拿到的证据。",
      kind: "agent",
      laneId: "collect",
      x: 872,
      y: 160,
    },
    {
      id: "agent5_gap_analysis",
      label: "分析研究缺口",
      description: "识别证据缺口与待补项。",
      kind: "gate",
      laneId: "review",
      x: 1080,
      y: 284,
    },
    {
      id: "agent6_compress_findings",
      label: "压缩研究发现",
      description: "提炼重点发现。",
      kind: "agent",
      laneId: "report",
      x: 872,
      y: 396,
    },
    {
      id: "agent7_reference_enrichment",
      label: "补充引用证据",
      description: "补充结论引用。",
      kind: "tool",
      laneId: "report",
      x: 1080,
      y: 396,
    },
    {
      id: "agent8_investment_synthesis",
      label: "生成投资结论",
      description: "写出最终投资判断。",
      kind: "agent",
      laneId: "report",
      x: 248,
      y: 396,
    },
  ],
  edges: [
    { from: "agent0_clarify_scope", to: "agent1_write_research_brief" },
    { from: "agent1_write_research_brief", to: "agent2_plan_research_units" },
    { from: "agent2_plan_research_units", to: "agent3_execute_research_units" },
    { from: "agent3_execute_research_units", to: "agent4_evidence_curation" },
    { from: "agent4_evidence_curation", to: "agent5_gap_analysis" },
    { from: "agent5_gap_analysis", to: "agent6_compress_findings" },
    {
      from: "agent5_gap_analysis",
      to: "agent2_plan_research_units",
      label: "replan",
    },
    { from: "agent6_compress_findings", to: "agent7_reference_enrichment" },
    { from: "agent7_reference_enrichment", to: "agent8_investment_synthesis" },
  ],
});

const companyResearchV4 = buildSpec({
  templateCode: "company_research_center",
  templateVersion: 4,
  title: "公司研究流程图 v4",
  layout: {
    width: 1520,
    height: 500,
  },
  lanes: [lanes.scope, lanes.collect, lanes.review, lanes.report],
  nodes: [
    {
      id: "agent0_clarify_scope",
      label: "澄清研究范围",
      description: "明确研究边界与限制条件。",
      kind: "agent",
      laneId: "scope",
      x: 32,
      y: 36,
    },
    {
      id: "agent1_write_research_brief",
      label: "撰写研究简报",
      description: "整理研究目标与问题。",
      kind: "agent",
      laneId: "scope",
      x: 232,
      y: 36,
    },
    {
      id: "agent2_plan_research_units",
      label: "规划研究单元",
      description: "拆解研究任务与依赖关系。",
      kind: "agent",
      laneId: "scope",
      x: 432,
      y: 36,
    },
    {
      id: "agent3_source_grounding",
      label: "锚定信源范围",
      description: "确定优先信源渠道。",
      kind: "agent",
      laneId: "collect",
      x: 632,
      y: 160,
    },
    {
      id: "collector_official_sources",
      label: "采集官网信源",
      description: "抓取官网和公告等一手资料。",
      kind: "tool",
      laneId: "collect",
      x: 832,
      y: 136,
      width: 152,
      height: 56,
    },
    {
      id: "collector_financial_sources",
      label: "采集财务信源",
      description: "抓取财报和财务数据。",
      kind: "tool",
      laneId: "collect",
      x: 832,
      y: 200,
      width: 152,
      height: 56,
    },
    {
      id: "collector_news_sources",
      label: "采集新闻信源",
      description: "抓取近期新闻与催化事件。",
      kind: "tool",
      laneId: "collect",
      x: 1008,
      y: 136,
      width: 152,
      height: 56,
    },
    {
      id: "collector_industry_sources",
      label: "采集行业信源",
      description: "抓取行业格局与产业链资料。",
      kind: "tool",
      laneId: "collect",
      x: 1008,
      y: 200,
      width: 152,
      height: 56,
    },
    {
      id: "agent4_synthesis",
      label: "整合研究结论",
      description: "汇总各路信源与中间结论。",
      kind: "agent",
      laneId: "collect",
      x: 1184,
      y: 160,
    },
    {
      id: "agent5_gap_analysis_and_replan",
      label: "分析缺口并重规划",
      description: "识别缺口并决定是否补充研究。",
      kind: "gate",
      laneId: "review",
      x: 1184,
      y: 284,
    },
    {
      id: "agent6_compress_findings",
      label: "压缩研究发现",
      description: "提炼关键发现。",
      kind: "agent",
      laneId: "report",
      x: 584,
      y: 396,
    },
    {
      id: "agent7_reference_enrichment",
      label: "补充引用证据",
      description: "补足结论引用与出处。",
      kind: "tool",
      laneId: "report",
      x: 784,
      y: 396,
    },
    {
      id: "agent8_finalize_report",
      label: "整理最终报告",
      description: "生成最终研究报告。",
      kind: "agent",
      laneId: "report",
      x: 984,
      y: 396,
    },
    {
      id: "agent9_reflection",
      label: "反思校验",
      description: "校验输出质量与完整性。",
      kind: "gate",
      laneId: "review",
      x: 1184,
      y: 396,
    },
  ],
  edges: [
    { from: "agent0_clarify_scope", to: "agent1_write_research_brief" },
    { from: "agent1_write_research_brief", to: "agent2_plan_research_units" },
    { from: "agent2_plan_research_units", to: "agent3_source_grounding" },
    { from: "agent3_source_grounding", to: "collector_official_sources" },
    { from: "agent3_source_grounding", to: "collector_financial_sources" },
    { from: "agent3_source_grounding", to: "collector_news_sources" },
    { from: "agent3_source_grounding", to: "collector_industry_sources" },
    { from: "collector_official_sources", to: "agent4_synthesis" },
    { from: "collector_financial_sources", to: "agent4_synthesis" },
    { from: "collector_news_sources", to: "agent4_synthesis" },
    { from: "collector_industry_sources", to: "agent4_synthesis" },
    { from: "agent4_synthesis", to: "agent5_gap_analysis_and_replan" },
    {
      from: "agent5_gap_analysis_and_replan",
      to: "agent2_plan_research_units",
      label: "replan",
    },
    {
      from: "agent5_gap_analysis_and_replan",
      to: "agent6_compress_findings",
    },
    { from: "agent6_compress_findings", to: "agent7_reference_enrichment" },
    { from: "agent7_reference_enrichment", to: "agent8_finalize_report" },
    { from: "agent8_finalize_report", to: "agent9_reflection" },
  ],
});

const timingSignalV1 = buildSpec({
  templateCode: "timing_signal_pipeline_v1",
  templateVersion: 1,
  title: "单股择时流程图",
  layout: {
    width: 1080,
    height: 500,
  },
  lanes: [lanes.scope, lanes.collect, lanes.report],
  nodes: [
    {
      id: "load_targets",
      label: "载入分析标的",
      description: "载入本次要分析的股票。",
      kind: "system",
      laneId: "scope",
      x: 48,
      y: 36,
    },
    {
      id: "fetch_signal_snapshots",
      label: "抓取信号快照",
      description: "抓取最新技术信号快照。",
      kind: "tool",
      laneId: "collect",
      x: 256,
      y: 160,
    },
    {
      id: "technical_signal_agent",
      label: "技术信号研判",
      description: "评估技术指标与趋势信号。",
      kind: "agent",
      laneId: "collect",
      x: 464,
      y: 160,
    },
    {
      id: "timing_synthesis_agent",
      label: "综合择时结论",
      description: "生成单股择时卡片。",
      kind: "agent",
      laneId: "report",
      x: 672,
      y: 396,
    },
    {
      id: "persist_cards",
      label: "写入择时卡片",
      description: "保存本次择时结果。",
      kind: "system",
      laneId: "report",
      x: 880,
      y: 396,
    },
  ],
  edges: [
    { from: "load_targets", to: "fetch_signal_snapshots" },
    { from: "fetch_signal_snapshots", to: "technical_signal_agent" },
    { from: "technical_signal_agent", to: "timing_synthesis_agent" },
    { from: "timing_synthesis_agent", to: "persist_cards" },
  ],
});

const watchlistTimingCardsV1 = buildSpec({
  templateCode: "watchlist_timing_cards_pipeline_v1",
  templateVersion: 1,
  title: "候选信号流程图",
  layout: {
    width: 1080,
    height: 500,
  },
  lanes: [lanes.scope, lanes.collect, lanes.report],
  nodes: [
    {
      id: "load_watchlist_context",
      label: "载入自选股上下文",
      description: "载入本次候选池。",
      kind: "system",
      laneId: "scope",
      x: 48,
      y: 36,
    },
    {
      id: "fetch_signal_snapshots_batch",
      label: "批量抓取信号快照",
      description: "批量抓取候选标的信号。",
      kind: "tool",
      laneId: "collect",
      x: 256,
      y: 160,
    },
    {
      id: "technical_signal_agent",
      label: "技术信号研判",
      description: "评估候选标的技术信号。",
      kind: "agent",
      laneId: "collect",
      x: 464,
      y: 160,
    },
    {
      id: "timing_synthesis_agent",
      label: "综合择时结论",
      description: "生成批量择时卡片。",
      kind: "agent",
      laneId: "report",
      x: 672,
      y: 396,
    },
    {
      id: "persist_cards",
      label: "写入择时卡片",
      description: "保存批量择时结果。",
      kind: "system",
      laneId: "report",
      x: 880,
      y: 396,
    },
  ],
  edges: [
    { from: "load_watchlist_context", to: "fetch_signal_snapshots_batch" },
    { from: "fetch_signal_snapshots_batch", to: "technical_signal_agent" },
    { from: "technical_signal_agent", to: "timing_synthesis_agent" },
    { from: "timing_synthesis_agent", to: "persist_cards" },
  ],
});

const watchlistTimingV1 = buildSpec({
  templateCode: "watchlist_timing_pipeline_v1",
  templateVersion: 1,
  title: "组合择时流程图",
  layout: {
    width: 1520,
    height: 500,
  },
  lanes: [lanes.scope, lanes.collect, lanes.review, lanes.report],
  nodes: [
    {
      id: "load_watchlist_context",
      label: "载入自选股上下文",
      description: "载入候选池与组合持仓。",
      kind: "system",
      laneId: "scope",
      x: 32,
      y: 36,
    },
    {
      id: "fetch_signal_snapshots_batch",
      label: "批量抓取信号快照",
      description: "抓取候选标的信号。",
      kind: "tool",
      laneId: "collect",
      x: 232,
      y: 160,
    },
    {
      id: "technical_signal_agent",
      label: "技术信号研判",
      description: "评估候选标的技术信号。",
      kind: "agent",
      laneId: "collect",
      x: 432,
      y: 160,
    },
    {
      id: "timing_synthesis_agent",
      label: "综合择时结论",
      description: "生成择时卡片初稿。",
      kind: "agent",
      laneId: "collect",
      x: 632,
      y: 160,
    },
    {
      id: "market_regime_agent",
      label: "市场环境判断",
      description: "判断市场所处环境。",
      kind: "agent",
      laneId: "review",
      x: 832,
      y: 284,
    },
    {
      id: "watchlist_risk_manager",
      label: "组合风险约束",
      description: "评估组合风险边界。",
      kind: "agent",
      laneId: "review",
      x: 1032,
      y: 284,
    },
    {
      id: "watchlist_portfolio_manager",
      label: "组合动作建议",
      description: "生成组合层面的动作建议。",
      kind: "agent",
      laneId: "report",
      x: 1232,
      y: 396,
    },
    {
      id: "persist_recommendations",
      label: "写入组合建议",
      description: "保存组合建议结果。",
      kind: "system",
      laneId: "report",
      x: 1032,
      y: 396,
    },
  ],
  edges: [
    { from: "load_watchlist_context", to: "fetch_signal_snapshots_batch" },
    { from: "fetch_signal_snapshots_batch", to: "technical_signal_agent" },
    { from: "technical_signal_agent", to: "timing_synthesis_agent" },
    { from: "timing_synthesis_agent", to: "market_regime_agent" },
    { from: "market_regime_agent", to: "watchlist_risk_manager" },
    { from: "watchlist_risk_manager", to: "watchlist_portfolio_manager" },
    {
      from: "watchlist_portfolio_manager",
      to: "persist_recommendations",
    },
  ],
});

const timingReviewLoopV1 = buildSpec({
  templateCode: "timing_review_loop_v1",
  templateVersion: 1,
  title: "择时复盘流程图",
  layout: {
    width: 1080,
    height: 500,
  },
  lanes: [lanes.scope, lanes.collect, lanes.review, lanes.report],
  nodes: [
    {
      id: "load_due_reviews",
      label: "载入待复盘任务",
      description: "载入待处理的复盘任务。",
      kind: "system",
      laneId: "scope",
      x: 48,
      y: 36,
    },
    {
      id: "evaluate_outcomes",
      label: "评估实际结果",
      description: "评估信号后的真实表现。",
      kind: "agent",
      laneId: "collect",
      x: 256,
      y: 160,
    },
    {
      id: "review_agent",
      label: "生成复盘结论",
      description: "形成复盘分析结论。",
      kind: "agent",
      laneId: "review",
      x: 464,
      y: 284,
    },
    {
      id: "persist_reviews",
      label: "写入复盘记录",
      description: "保存复盘分析结果。",
      kind: "system",
      laneId: "report",
      x: 672,
      y: 396,
    },
    {
      id: "schedule_next_review",
      label: "安排下一次复盘",
      description: "触发后续复盘提醒。",
      kind: "system",
      laneId: "report",
      x: 880,
      y: 396,
    },
  ],
  edges: [
    { from: "load_due_reviews", to: "evaluate_outcomes" },
    { from: "evaluate_outcomes", to: "review_agent" },
    { from: "review_agent", to: "persist_reviews" },
    { from: "persist_reviews", to: "schedule_next_review" },
  ],
});

const specs = [
  quickResearchV3,
  companyResearchV1,
  companyResearchV2,
  companyResearchV3,
  companyResearchV4,
  timingSignalV1,
  watchlistTimingCardsV1,
  watchlistTimingV1,
  timingReviewLoopV1,
];

const specMap = new Map(
  specs.map((spec) => [`${spec.templateCode}@${spec.templateVersion}`, spec]),
);
const latestMap = new Map<DiagramTemplateCode, WorkflowDiagramSpec>();

for (const spec of specs) {
  const current = latestMap.get(spec.templateCode as DiagramTemplateCode);
  if (!current || spec.templateVersion >= current.templateVersion) {
    latestMap.set(spec.templateCode as DiagramTemplateCode, spec);
  }
}

export function getWorkflowDiagramSpec(
  templateCode: string,
  templateVersion: number,
): WorkflowDiagramSpec | null {
  return specMap.get(`${templateCode}@${templateVersion}`) ?? null;
}

export function getLatestWorkflowDiagramSpec(
  templateCode: string,
): WorkflowDiagramSpec | null {
  return latestMap.get(templateCode as DiagramTemplateCode) ?? null;
}
