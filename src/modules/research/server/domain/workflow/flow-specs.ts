import { z } from "zod";
import {
  buildFlow,
  type FlowMap,
  type FlowMapNode,
  type FlowSpec,
  makeEdge,
  makeNode,
  makeStage,
  type NodeKind,
} from "~/modules/research/server/domain/workflow/flow-spec";
import {
  COMPANY_RESEARCH_NODE_KEYS,
  COMPANY_RESEARCH_TEMPLATE_CODE,
  COMPANY_RESEARCH_V1_NODE_KEYS,
  COMPANY_RESEARCH_V3_NODE_KEYS,
  COMPANY_RESEARCH_V4_NODE_KEYS,
  QUICK_RESEARCH_NODE_KEYS,
  QUICK_RESEARCH_TEMPLATE_CODE,
  SCREENING_INSIGHT_PIPELINE_NODE_KEYS,
  SCREENING_INSIGHT_PIPELINE_TEMPLATE_CODE,
  SCREENING_TO_TIMING_NODE_KEYS,
  SCREENING_TO_TIMING_TEMPLATE_CODE,
  TIMING_REVIEW_LOOP_NODE_KEYS,
  TIMING_REVIEW_LOOP_TEMPLATE_CODE,
  TIMING_SIGNAL_PIPELINE_NODE_KEYS,
  TIMING_SIGNAL_PIPELINE_TEMPLATE_CODE,
  WATCHLIST_TIMING_CARDS_PIPELINE_NODE_KEYS,
  WATCHLIST_TIMING_CARDS_PIPELINE_TEMPLATE_CODE,
  WATCHLIST_TIMING_PIPELINE_NODE_KEYS,
  WATCHLIST_TIMING_PIPELINE_TEMPLATE_CODE,
} from "~/modules/research/server/domain/workflow/types";

const anyRecord = z.record(z.string(), z.unknown());

type StageKey = "scope" | "collect" | "review" | "report";

type NodeDraft = {
  key: string;
  kind: NodeKind;
  name: string;
  goal: string;
  stage: StageKey;
  show?: boolean;
  routes?: string[];
  tools?: string[];
};

const STAGES = {
  scope: makeStage({ key: "scope", name: "范围澄清" }),
  collect: makeStage({ key: "collect", name: "资料收集" }),
  review: makeStage({ key: "review", name: "评审校验" }),
  report: makeStage({ key: "report", name: "结果输出" }),
} as const;

const stageByKey = (keys: readonly StageKey[]) =>
  keys.map((key) => STAGES[key]);

const nodeText: Record<
  string,
  {
    name: string;
    goal: string;
    kind: NodeKind;
    stage: StageKey;
    show?: boolean;
    routes?: string[];
    tools?: string[];
  }
> = {
  agent0_clarify_scope: {
    name: "澄清需求",
    goal: "澄清研究目标与输入范围",
    kind: "agent",
    stage: "scope",
    tools: ["brief"],
    routes: ["ok", "pause"],
  },
  agent1_extract_research_spec: {
    name: "制定计划",
    goal: "生成本轮研究计划",
    kind: "agent",
    stage: "scope",
    tools: ["plan"],
  },
  agent2_trend_analysis: {
    name: "趋势分析",
    goal: "分析主题趋势与驱动因素",
    kind: "agent",
    stage: "collect",
    tools: ["search"],
  },
  agent3_candidate_screening: {
    name: "筛选候选",
    goal: "筛选候选标的",
    kind: "agent",
    stage: "collect",
    tools: ["screen"],
  },
  agent4_credibility_and_competition: {
    name: "交叉验证",
    goal: "核验可信度与竞争格局",
    kind: "agent",
    stage: "collect",
    tools: ["check"],
  },
  agent5_report_synthesis: {
    name: "生成报告",
    goal: "生成最终研究报告",
    kind: "agent",
    stage: "report",
    tools: ["write"],
  },
  agent6_reflection: {
    name: "复盘反思",
    goal: "复核报告质量与缺口",
    kind: "gate",
    stage: "review",
    tools: ["score"],
  },
  agent1_company_briefing: {
    name: "公司简报",
    goal: "生成公司研究简报",
    kind: "agent",
    stage: "scope",
    tools: ["brief"],
  },
  agent2_concept_mapping: {
    name: "概念映射",
    goal: "梳理关键概念与主题映射",
    kind: "agent",
    stage: "collect",
    tools: ["map"],
  },
  agent3_question_design: {
    name: "设计问题",
    goal: "设计研究问题与验证路径",
    kind: "agent",
    stage: "scope",
    tools: ["plan"],
  },
  agent4_evidence_collection: {
    name: "收集证据",
    goal: "收集公司研究证据",
    kind: "tool",
    stage: "collect",
    tools: ["search"],
  },
  agent5_investment_synthesis: {
    name: "投资结论",
    goal: "生成投资观点结论",
    kind: "agent",
    stage: "report",
    tools: ["write"],
  },
  agent1_write_research_brief: {
    name: "研究简报",
    goal: "编写研究简报",
    kind: "agent",
    stage: "scope",
    tools: ["brief"],
  },
  agent2_plan_research_units: {
    name: "任务拆解",
    goal: "拆解研究任务单元",
    kind: "agent",
    stage: "scope",
    tools: ["plan"],
  },
  agent3_execute_research_units: {
    name: "执行单元",
    goal: "执行研究任务单元",
    kind: "agent",
    stage: "collect",
    tools: ["search"],
  },
  agent4_evidence_curation: {
    name: "整理证据",
    goal: "整理并筛选证据",
    kind: "agent",
    stage: "collect",
    tools: ["curate"],
  },
  agent5_gap_analysis: {
    name: "缺口分析",
    goal: "识别缺失信息与盲区",
    kind: "gate",
    stage: "review",
    tools: ["check"],
  },
  agent6_compress_findings: {
    name: "压缩结论",
    goal: "压缩提炼核心发现",
    kind: "agent",
    stage: "report",
    tools: ["compress"],
  },
  agent7_reference_enrichment: {
    name: "补充引用",
    goal: "补充来源引用",
    kind: "tool",
    stage: "report",
    tools: ["refs"],
  },
  agent8_investment_synthesis: {
    name: "投资结论",
    goal: "生成投资观点结论",
    kind: "agent",
    stage: "report",
    tools: ["write"],
  },
  agent3_source_grounding: {
    name: "来源规划",
    goal: "规划证据来源通道",
    kind: "agent",
    stage: "collect",
    tools: ["plan"],
  },
  collector_official_sources: {
    name: "官方来源",
    goal: "采集官方来源资料",
    kind: "tool",
    stage: "collect",
    tools: ["web"],
    show: false,
  },
  collector_financial_sources: {
    name: "财经来源",
    goal: "采集财经来源资料",
    kind: "tool",
    stage: "collect",
    tools: ["finance"],
    show: false,
  },
  collector_news_sources: {
    name: "新闻来源",
    goal: "采集新闻来源资料",
    kind: "tool",
    stage: "collect",
    tools: ["news"],
    show: false,
  },
  collector_industry_sources: {
    name: "行业来源",
    goal: "采集行业来源资料",
    kind: "tool",
    stage: "collect",
    tools: ["industry"],
    show: false,
  },
  agent4_source_grounding: {
    name: "来源规划",
    goal: "规划证据来源通道",
    kind: "agent",
    stage: "collect",
    tools: ["plan"],
  },
  agent9_evidence_curation: {
    name: "整理证据",
    goal: "整理并筛选证据",
    kind: "agent",
    stage: "collect",
    tools: ["curate"],
  },
  agent10_reference_enrichment: {
    name: "补充引用",
    goal: "补充来源引用",
    kind: "tool",
    stage: "report",
    tools: ["refs"],
  },
  agent11_investment_synthesis: {
    name: "投资结论",
    goal: "生成投资观点结论",
    kind: "agent",
    stage: "report",
    tools: ["write"],
  },
  agent4_synthesis: {
    name: "合并证据",
    goal: "汇总并合并证据",
    kind: "agent",
    stage: "collect",
    tools: ["merge"],
  },
  agent5_gap_analysis_and_replan: {
    name: "缺口与重规划",
    goal: "检查缺口并重新规划",
    kind: "gate",
    stage: "review",
    tools: ["check"],
  },
  agent8_finalize_report: {
    name: "定稿报告",
    goal: "完成报告定稿",
    kind: "agent",
    stage: "report",
    tools: ["write"],
  },
  agent9_reflection: {
    name: "复盘反思",
    goal: "复核最终结果质量",
    kind: "gate",
    stage: "review",
    tools: ["score"],
  },
  load_run_context: {
    name: "加载上下文",
    goal: "加载运行上下文",
    kind: "system",
    stage: "scope",
  },
  screen_candidates: {
    name: "筛选候选",
    goal: "筛选候选标的",
    kind: "tool",
    stage: "collect",
    routes: ["ok", "empty"],
  },
  collect_evidence_batch: {
    name: "批量收集",
    goal: "为候选标的批量收集证据",
    kind: "tool",
    stage: "collect",
  },
  synthesize_insights: {
    name: "起草洞察",
    goal: "起草洞察卡片",
    kind: "agent",
    stage: "collect",
  },
  validate_insights: {
    name: "校验洞察",
    goal: "校验洞察卡片质量",
    kind: "gate",
    stage: "review",
  },
  review_gate: {
    name: "等待评审",
    goal: "等待评审审批",
    kind: "gate",
    stage: "review",
    routes: ["ok", "pause"],
  },
  archive_insights: {
    name: "保存洞察",
    goal: "保存已批准洞察",
    kind: "system",
    stage: "report",
  },
  schedule_review_reminders: {
    name: "安排提醒",
    goal: "安排复盘提醒",
    kind: "system",
    stage: "report",
    show: false,
  },
  archive_empty_result: {
    name: "保存空结果",
    goal: "保存空结果记录",
    kind: "system",
    stage: "report",
    show: false,
  },
  notify_user: {
    name: "通知用户",
    goal: "通知用户结果已生成",
    kind: "system",
    stage: "report",
  },
  load_targets: {
    name: "加载目标",
    goal: "加载择时目标",
    kind: "system",
    stage: "scope",
  },
  fetch_signal_snapshots: {
    name: "抓取快照",
    goal: "抓取择时信号快照",
    kind: "tool",
    stage: "collect",
  },
  technical_signal_agent: {
    name: "信号评分",
    goal: "评估技术信号强弱",
    kind: "agent",
    stage: "collect",
  },
  timing_synthesis_agent: {
    name: "生成卡片",
    goal: "生成择时卡片",
    kind: "agent",
    stage: "report",
  },
  persist_cards: {
    name: "保存卡片",
    goal: "保存择时卡片",
    kind: "system",
    stage: "report",
  },
  load_watchlist_context: {
    name: "加载自选股",
    goal: "加载自选股上下文",
    kind: "system",
    stage: "scope",
  },
  fetch_signal_snapshots_batch: {
    name: "批量抓取",
    goal: "批量抓取信号快照",
    kind: "tool",
    stage: "collect",
  },
  market_regime_agent: {
    name: "市场研判",
    goal: "评估市场状态",
    kind: "agent",
    stage: "review",
  },
  watchlist_risk_manager: {
    name: "风险规划",
    goal: "生成风险控制方案",
    kind: "agent",
    stage: "review",
  },
  watchlist_portfolio_manager: {
    name: "组合建议",
    goal: "生成组合建议",
    kind: "agent",
    stage: "report",
  },
  persist_recommendations: {
    name: "保存建议",
    goal: "保存组合建议",
    kind: "system",
    stage: "report",
  },
  load_screening_results: {
    name: "加载筛选结果",
    goal: "加载筛选结果",
    kind: "system",
    stage: "scope",
  },
  select_top_candidates: {
    name: "选择标的",
    goal: "选择优先候选标的",
    kind: "tool",
    stage: "collect",
  },
  run_timing_pipeline: {
    name: "执行择时",
    goal: "执行择时分析流程",
    kind: "agent",
    stage: "report",
  },
  archive_results: {
    name: "保存结果",
    goal: "保存最终结果",
    kind: "system",
    stage: "report",
  },
  load_due_reviews: {
    name: "加载待复盘",
    goal: "加载到期复盘任务",
    kind: "system",
    stage: "scope",
  },
  evaluate_outcomes: {
    name: "评估结果",
    goal: "评估复盘结果",
    kind: "tool",
    stage: "collect",
  },
  review_agent: {
    name: "生成复盘",
    goal: "生成复盘结论",
    kind: "agent",
    stage: "review",
  },
  persist_reviews: {
    name: "保存复盘",
    goal: "保存复盘记录",
    kind: "system",
    stage: "report",
  },
  schedule_next_review: {
    name: "安排下次复盘",
    goal: "安排下一次复盘",
    kind: "system",
    stage: "report",
  },
};

function buildNode({
  key,
  kind,
  name,
  goal,
  stage,
  show = true,
  routes = ["ok"],
  tools = [],
}: NodeDraft) {
  return makeNode({
    key,
    kind,
    name,
    goal,
    tools,
    in: anyRecord,
    out: anyRecord,
    routes,
    view: {
      stage,
      show,
    },
  });
}

function getNodeDraft(key: string): NodeDraft {
  const draft = nodeText[key];
  if (!draft) {
    return {
      key,
      kind: "system",
      name: key,
      goal: key,
      stage: "collect",
    };
  }

  return {
    key,
    kind: draft.kind,
    name: draft.name,
    goal: draft.goal,
    stage: draft.stage,
    show: draft.show,
    routes: draft.routes,
    tools: draft.tools,
  };
}

function makeFlowFromOrder(params: {
  templateCode: string;
  templateVersion?: number;
  name: string;
  stageKeys: readonly StageKey[];
  nodeKeys: readonly string[];
  edgeOverrides?: Array<{ from: string; to: string; when: string }>;
}) {
  const defaultEdges = params.nodeKeys
    .slice(0, -1)
    .flatMap((nodeKey, index) => {
      const nextKey = params.nodeKeys[index + 1];

      if (!nextKey) {
        return [];
      }

      return [makeEdge({ from: nodeKey, to: nextKey, when: "ok" })];
    });

  return buildFlow({
    templateCode: params.templateCode,
    templateVersion: params.templateVersion,
    name: params.name,
    stages: stageByKey(params.stageKeys),
    nodes: params.nodeKeys.map((nodeKey) => buildNode(getNodeDraft(nodeKey))),
    edges: params.edgeOverrides?.map(makeEdge) ?? defaultEdges,
  });
}

const flowSpecs = [
  makeFlowFromOrder({
    templateCode: QUICK_RESEARCH_TEMPLATE_CODE,
    templateVersion: 3,
    name: "行业研究",
    stageKeys: ["scope", "collect", "review", "report"],
    nodeKeys: QUICK_RESEARCH_NODE_KEYS,
  }),
  makeFlowFromOrder({
    templateCode: COMPANY_RESEARCH_TEMPLATE_CODE,
    templateVersion: 1,
    name: "公司研究",
    stageKeys: ["scope", "collect", "report"],
    nodeKeys: COMPANY_RESEARCH_V1_NODE_KEYS,
  }),
  makeFlowFromOrder({
    templateCode: COMPANY_RESEARCH_TEMPLATE_CODE,
    templateVersion: 2,
    name: "公司研究",
    stageKeys: ["scope", "collect", "report"],
    nodeKeys: COMPANY_RESEARCH_NODE_KEYS,
    edgeOverrides: [
      {
        from: "agent1_company_briefing",
        to: "agent2_concept_mapping",
        when: "ok",
      },
      {
        from: "agent2_concept_mapping",
        to: "agent3_question_design",
        when: "ok",
      },
      {
        from: "agent3_question_design",
        to: "agent4_source_grounding",
        when: "ok",
      },
      {
        from: "agent4_source_grounding",
        to: "collector_official_sources",
        when: "ok",
      },
      {
        from: "agent4_source_grounding",
        to: "collector_financial_sources",
        when: "ok",
      },
      {
        from: "agent4_source_grounding",
        to: "collector_news_sources",
        when: "ok",
      },
      {
        from: "agent4_source_grounding",
        to: "collector_industry_sources",
        when: "ok",
      },
      {
        from: "collector_official_sources",
        to: "agent9_evidence_curation",
        when: "ok",
      },
      {
        from: "collector_financial_sources",
        to: "agent9_evidence_curation",
        when: "ok",
      },
      {
        from: "collector_news_sources",
        to: "agent9_evidence_curation",
        when: "ok",
      },
      {
        from: "collector_industry_sources",
        to: "agent9_evidence_curation",
        when: "ok",
      },
      {
        from: "agent9_evidence_curation",
        to: "agent10_reference_enrichment",
        when: "ok",
      },
      {
        from: "agent10_reference_enrichment",
        to: "agent11_investment_synthesis",
        when: "ok",
      },
    ],
  }),
  makeFlowFromOrder({
    templateCode: COMPANY_RESEARCH_TEMPLATE_CODE,
    templateVersion: 3,
    name: "公司研究",
    stageKeys: ["scope", "collect", "review", "report"],
    nodeKeys: COMPANY_RESEARCH_V3_NODE_KEYS,
  }),
  makeFlowFromOrder({
    templateCode: COMPANY_RESEARCH_TEMPLATE_CODE,
    templateVersion: 4,
    name: "公司研究",
    stageKeys: ["scope", "collect", "review", "report"],
    nodeKeys: COMPANY_RESEARCH_V4_NODE_KEYS,
    edgeOverrides: [
      {
        from: "agent0_clarify_scope",
        to: "agent1_write_research_brief",
        when: "ok",
      },
      {
        from: "agent1_write_research_brief",
        to: "agent2_plan_research_units",
        when: "ok",
      },
      {
        from: "agent2_plan_research_units",
        to: "agent3_source_grounding",
        when: "ok",
      },
      {
        from: "agent3_source_grounding",
        to: "collector_official_sources",
        when: "ok",
      },
      {
        from: "agent3_source_grounding",
        to: "collector_financial_sources",
        when: "ok",
      },
      {
        from: "agent3_source_grounding",
        to: "collector_news_sources",
        when: "ok",
      },
      {
        from: "agent3_source_grounding",
        to: "collector_industry_sources",
        when: "ok",
      },
      {
        from: "collector_official_sources",
        to: "agent4_synthesis",
        when: "ok",
      },
      {
        from: "collector_financial_sources",
        to: "agent4_synthesis",
        when: "ok",
      },
      { from: "collector_news_sources", to: "agent4_synthesis", when: "ok" },
      {
        from: "collector_industry_sources",
        to: "agent4_synthesis",
        when: "ok",
      },
      {
        from: "agent4_synthesis",
        to: "agent5_gap_analysis_and_replan",
        when: "ok",
      },
      {
        from: "agent5_gap_analysis_and_replan",
        to: "agent6_compress_findings",
        when: "ok",
      },
      {
        from: "agent6_compress_findings",
        to: "agent7_reference_enrichment",
        when: "ok",
      },
      {
        from: "agent7_reference_enrichment",
        to: "agent8_finalize_report",
        when: "ok",
      },
      { from: "agent8_finalize_report", to: "agent9_reflection", when: "ok" },
    ],
  }),
  makeFlowFromOrder({
    templateCode: SCREENING_INSIGHT_PIPELINE_TEMPLATE_CODE,
    templateVersion: 1,
    name: "筛选洞察",
    stageKeys: ["scope", "collect", "review", "report"],
    nodeKeys: SCREENING_INSIGHT_PIPELINE_NODE_KEYS,
    edgeOverrides: [
      { from: "load_run_context", to: "screen_candidates", when: "ok" },
      { from: "screen_candidates", to: "collect_evidence_batch", when: "ok" },
      { from: "screen_candidates", to: "archive_empty_result", when: "empty" },
      { from: "collect_evidence_batch", to: "synthesize_insights", when: "ok" },
      { from: "synthesize_insights", to: "validate_insights", when: "ok" },
      { from: "validate_insights", to: "review_gate", when: "ok" },
      { from: "review_gate", to: "archive_insights", when: "ok" },
      { from: "review_gate", to: "review_gate", when: "pause" },
      { from: "archive_insights", to: "schedule_review_reminders", when: "ok" },
      { from: "schedule_review_reminders", to: "notify_user", when: "ok" },
      { from: "archive_empty_result", to: "notify_user", when: "ok" },
    ],
  }),
  makeFlowFromOrder({
    templateCode: TIMING_SIGNAL_PIPELINE_TEMPLATE_CODE,
    templateVersion: 1,
    name: "单股择时",
    stageKeys: ["scope", "collect", "report"],
    nodeKeys: TIMING_SIGNAL_PIPELINE_NODE_KEYS,
  }),
  makeFlowFromOrder({
    templateCode: WATCHLIST_TIMING_CARDS_PIPELINE_TEMPLATE_CODE,
    templateVersion: 1,
    name: "自选股卡片",
    stageKeys: ["scope", "collect", "report"],
    nodeKeys: WATCHLIST_TIMING_CARDS_PIPELINE_NODE_KEYS,
  }),
  makeFlowFromOrder({
    templateCode: WATCHLIST_TIMING_PIPELINE_TEMPLATE_CODE,
    templateVersion: 1,
    name: "自选股组合建议",
    stageKeys: ["scope", "collect", "review", "report"],
    nodeKeys: WATCHLIST_TIMING_PIPELINE_NODE_KEYS,
  }),
  makeFlowFromOrder({
    templateCode: SCREENING_TO_TIMING_TEMPLATE_CODE,
    templateVersion: 1,
    name: "筛选到择时",
    stageKeys: ["scope", "collect", "report"],
    nodeKeys: SCREENING_TO_TIMING_NODE_KEYS,
  }),
  makeFlowFromOrder({
    templateCode: TIMING_REVIEW_LOOP_TEMPLATE_CODE,
    templateVersion: 1,
    name: "择时复盘",
    stageKeys: ["scope", "collect", "review", "report"],
    nodeKeys: TIMING_REVIEW_LOOP_NODE_KEYS,
  }),
] as const satisfies readonly FlowSpec[];

function buildNodeMap(spec: FlowSpec, mode: "user" | "debug") {
  return spec.nodes.filter((node) => mode === "debug" || node.view.show);
}

function buildCollapsedEdges(spec: FlowSpec, nodes: FlowMapNode[]) {
  const visibleKeys = new Set(nodes.map((node) => node.key));
  const outgoing = new Map<string, Array<{ to: string; when: string }>>();

  for (const edge of spec.edges) {
    outgoing.set(edge.from, [...(outgoing.get(edge.from) ?? []), edge]);
  }

  const collapsed = new Map<
    string,
    { from: string; to: string; when: string }
  >();

  for (const node of nodes) {
    const stack = [...(outgoing.get(node.key) ?? [])];
    const visited = new Set<string>();

    while (stack.length > 0) {
      const edge = stack.shift();

      if (!edge) {
        continue;
      }

      const visitKey = `${edge.when}:${edge.to}`;
      if (visited.has(visitKey)) {
        continue;
      }
      visited.add(visitKey);

      if (visibleKeys.has(edge.to)) {
        collapsed.set(`${node.key}:${edge.to}:${edge.when}`, {
          from: node.key,
          to: edge.to,
          when: edge.when,
        });
        continue;
      }

      for (const nextEdge of outgoing.get(edge.to) ?? []) {
        stack.push({
          to: nextEdge.to,
          when: edge.when === "ok" ? nextEdge.when : edge.when,
        });
      }
    }
  }

  return [...collapsed.values()];
}

export function listFlowSpecs() {
  return [...flowSpecs];
}

export function getFlowSpec(templateCode: string, templateVersion?: number) {
  if (typeof templateVersion === "number") {
    const exact = flowSpecs.find(
      (spec) =>
        spec.templateCode === templateCode &&
        spec.templateVersion === templateVersion,
    );

    if (exact) {
      return exact;
    }
  }

  const latest = [...flowSpecs]
    .filter((spec) => spec.templateCode === templateCode)
    .sort(
      (left, right) =>
        (right.templateVersion ?? 0) - (left.templateVersion ?? 0),
    )[0];

  if (!latest) {
    throw new Error(
      `Unknown flow spec: ${templateCode}@${templateVersion ?? "latest"}`,
    );
  }

  return latest;
}

export function buildFlowMap(
  spec: FlowSpec,
  mode: "user" | "debug" = "user",
): FlowMap {
  const nodes = buildNodeMap(spec, mode).map((node) => ({
    key: node.key,
    name: node.name,
    kind: node.kind,
    goal: node.goal,
    stage: node.view.stage,
  }));
  const stageKeys = new Set(nodes.map((node) => node.stage));

  return {
    templateCode: spec.templateCode,
    templateVersion: spec.templateVersion,
    name: spec.name,
    mode,
    stages: spec.stages.filter((stage) => stageKeys.has(stage.key)),
    nodes,
    edges:
      mode === "debug" ? [...spec.edges] : buildCollapsedEdges(spec, nodes),
  };
}
