export const MARKET_BASELINE_PHASES = ["盘前", "盘中", "盘后", "前瞻"] as const;
export type MarketBaselinePhase = (typeof MARKET_BASELINE_PHASES)[number];

export const MARKET_BASELINE_DOMAIN_IDS = [
  "market",
  "flow",
  "company",
  "news",
  "expectation",
  "calendar",
] as const;
export type MarketBaselineDomainId =
  (typeof MARKET_BASELINE_DOMAIN_IDS)[number];

export type MarketBaselineAvailability = "ready" | "partial" | "waiting";
export type MarketBaselineWeight = "重点" | "观察" | "日程";
export type MarketBaselineSnapshotState =
  | "CURRENT_READY"
  | "CURRENT_READY_WITH_LIMITATION"
  | "FALLBACK_TO_PREVIOUS"
  | "BLOCKED_REQUIRED_DATA";

export type MarketBaselineDomain = {
  id: MarketBaselineDomainId;
  label: string;
  shortLabel: string;
  note: string;
};

export type MarketBaselineItem = {
  id: string;
  phase: MarketBaselinePhase;
  domain: MarketBaselineDomainId;
  time: string;
  title: string;
  summary: string;
  source: string;
  asOf: string;
  availability: MarketBaselineAvailability;
  weight: MarketBaselineWeight;
  delta: string;
  evidence: string;
  related: string[];
  limitation: string;
  degradation: string;
  requiredDataReady: boolean;
};

export type MarketBaselineChartSnapshot = {
  coverageId: string;
  actualDataCutoff: string;
  status: MarketBaselineAvailability;
  breadth: {
    values: number[];
    labels: string[];
    headline: string;
    note: string;
  };
  flows: Array<{
    label: string;
    value: number;
    display: string;
    tone: "positive" | "neutral" | "negative";
  }>;
  events: Array<{
    time: string;
    label: string;
    state: "done" | "next" | "watch";
  }>;
};

export type MarketBaselineReadModel = {
  snapshotId: string;
  state: MarketBaselineSnapshotState;
  generatedAt: string;
  globalActualDataCutoff: string;
  coverageId: string;
  limitations: string[];
  degradation: string;
  phases: typeof PHASE_DEFINITIONS;
  domains: typeof MARKET_BASELINE_DOMAINS;
  items: typeof MARKET_BASELINE_ITEMS;
  charts: typeof MARKET_BASELINE_CHARTS;
};

export const PHASE_DEFINITIONS: Array<{
  id: MarketBaselinePhase;
  label: string;
  description: string;
}> = [
  { id: "盘前", label: "盘前", description: "开盘前的结构与今日准备" },
  { id: "盘中", label: "盘中", description: "交易时段的变化与异常" },
  { id: "盘后", label: "盘后", description: "收盘后的事实与修订" },
  { id: "前瞻", label: "前瞻", description: "未来几日的日程与预期" },
];

export const MARKET_BASELINE_DOMAINS: MarketBaselineDomain[] = [
  {
    id: "market",
    label: "市场结构",
    shortLabel: "结构",
    note: "指数、广度、行业与主题强弱",
  },
  {
    id: "flow",
    label: "资金与交易行为",
    shortLabel: "资金",
    note: "资金流、两融、龙虎榜与热度",
  },
  {
    id: "company",
    label: "公司信息",
    shortLabel: "公司",
    note: "财报、公告、回购与公司动作",
  },
  {
    id: "news",
    label: "新闻与政策",
    shortLabel: "新闻",
    note: "政策、新闻和需要核实的事实",
  },
  {
    id: "expectation",
    label: "预期变化",
    shortLabel: "预期",
    note: "盈利预测、评级与市场共识",
  },
  {
    id: "calendar",
    label: "事件日历",
    shortLabel: "日历",
    note: "宏观数据、披露和交易制度节点",
  },
];

const PHASE_CUTOFFS: Record<MarketBaselinePhase, string> = {
  盘前: "2026-08-03 08:50",
  盘中: "2026-08-03 11:15",
  盘后: "2026-08-03 19:20",
  前瞻: "2026-08-03 20:02",
};

function baselineItem(
  input: Omit<
    MarketBaselineItem,
    "asOf" | "limitation" | "degradation" | "requiredDataReady"
  > & {
    asOf?: string;
    limitation?: string;
    degradation?: string;
    requiredDataReady?: boolean;
  },
): MarketBaselineItem {
  const waiting = input.availability === "waiting";
  const partial = input.availability === "partial";
  return {
    ...input,
    asOf: input.asOf ?? PHASE_CUTOFFS[input.phase],
    limitation:
      input.limitation ??
      (waiting
        ? "必需数据未达标，继续读取上一份可用快照或显示占位状态。"
        : partial
          ? "可选数据存在缺口，新快照以受限状态展示。"
          : "必需数据已达到本区域目标截止点。"),
    degradation:
      input.degradation ??
      (waiting
        ? "未校准能力降级，不标记为实时，不触发异常紧急提醒。"
        : partial
          ? "READY_WITH_LIMITATION：保留完整排序并标注缺口。"
          : "正常读取。"),
    requiredDataReady: input.requiredDataReady ?? !waiting,
  };
}

export const MARKET_BASELINE_ITEMS: MarketBaselineItem[] = [
  baselineItem({
    id: "pre-market-breadth",
    phase: "盘前",
    domain: "market",
    time: "08:45",
    title: "上一交易日上涨家数回落，结构仍偏窄",
    summary:
      "沪深主要指数收盘接近持平，行业涨跌分化扩大，关注开盘后是否继续由少数主题贡献指数强度。",
    source: "TuShare · daily / index_daily",
    asOf: "2026-08-02 16:10",
    availability: "ready",
    weight: "重点",
    delta: "广度 42% -> 35%",
    evidence: "沪深 A 股上涨 1,862 家，下跌 3,021 家；申万一级行业 8/31 上涨。",
    related: ["市场广度", "主题集中度", "开盘观察"],
  }),
  baselineItem({
    id: "pre-flow-northbound",
    phase: "盘前",
    domain: "flow",
    time: "08:52",
    title: "北向资金净流入转正，但持续性尚待确认",
    summary:
      "上一交易日互联互通口径净流入 18.4 亿元，集中在电力设备与银行；单日资金变化只作为观测。",
    source: "TuShare · moneyflow_mkt_dc",
    asOf: "2026-08-02 19:12",
    availability: "ready",
    weight: "观察",
    delta: "+18.4 亿元",
    evidence: "沪股通净流入 11.2 亿元，深股通净流入 7.2 亿元；行业集中度 63%。",
    related: ["资金集中", "电力设备", "银行"],
  }),
  baselineItem({
    id: "pre-company-earnings",
    phase: "盘前",
    domain: "company",
    time: "08:58",
    title: "隔夜业绩快报进入候选队列",
    summary:
      "公司披露先形成候选，等待同一方案去重和公告证据校验，不直接生成交易动作结论。",
    source: "Minishare · 公告标题 / TuShare · express",
    availability: "partial",
    weight: "观察",
    delta: "新增 3 家",
    evidence: "3 家公司披露快报，其中 1 家缺少公告 PDF 原文确认。",
    related: ["业绩快报", "公告证据", "候选"],
  }),
  baselineItem({
    id: "pre-news-policy",
    phase: "盘前",
    domain: "news",
    time: "09:05",
    title: "政策窗口：设备更新相关表述出现新增细则",
    summary: "来源文本已归一化为研究事件候选，页面只显示可核实事实与原文入口。",
    source: "Minishare · 政策法规",
    asOf: "2026-08-03 07:34",
    availability: "partial",
    weight: "重点",
    delta: "新增 1 条",
    evidence: "原文包含资金支持范围和申报时间要求，涉及行业边界仍需确认。",
    related: ["设备更新", "政策候选", "待核实"],
  }),
  baselineItem({
    id: "pre-expectation-sellside",
    phase: "盘前",
    domain: "expectation",
    time: "09:12",
    title: "卖方预测上修集中在电网设备",
    summary:
      "预期变化保留机构、报告日和覆盖数，只表达共识变化，不展示为投资建议。",
    source: "TuShare · report_rc",
    asOf: "2026-08-02 22:00",
    availability: "ready",
    weight: "观察",
    delta: "EPS +3.4%",
    evidence: "7 家公司 FY2026 EPS 中位数较上一快照上修超过 3%。",
    related: ["盈利预测", "卖方数据", "电网设备"],
  }),
  baselineItem({
    id: "pre-calendar-pmi",
    phase: "盘前",
    domain: "calendar",
    time: "09:30",
    title: "今日节点：制造业 PMI 发布",
    summary:
      "事件日历作为准备工作，不提前写成方向判断；发布后由数据观测更新结构与预期。",
    source: "国家统计局 · 日历",
    asOf: "2026-08-02 20:00",
    availability: "ready",
    weight: "日程",
    delta: "距离 25 分钟",
    evidence: "数据发布时间为 09:30，发布后预计先更新宏观数据观测。",
    related: ["宏观数据", "盘中观察", "数据更新"],
  }),
  baselineItem({
    id: "intraday-market-permission",
    phase: "盘中",
    domain: "market",
    time: "10:30",
    title: "盘中市场结构需实时权限，当前仅保留上一快照",
    summary:
      "这是明确的产品降级状态：不使用过期快照伪装实时，不在缺少权限时发出紧急提醒。",
    source: "TuShare · rt_k（未校准）",
    asOf: "尚未接入",
    availability: "waiting",
    weight: "观察",
    delta: "权限待确认",
    evidence: "实时日线属于独立权限，需完成授权、质量和延迟校准。",
    related: ["数据权利", "盘中降级", "不发提醒"],
  }),
  baselineItem({
    id: "intraday-flow-hot-theme",
    phase: "盘中",
    domain: "flow",
    time: "11:15",
    title: "主题热度仅作为观测，不直接升级为研究事件",
    summary:
      "盘中热榜可进入候选队列，只有出现可引用现实变化、去重通过并完成评估后才进入收件箱。",
    source: "TuShare · ths_hot（待校准）",
    availability: "waiting",
    weight: "观察",
    delta: "候选，不分发",
    evidence: "热榜属于供应商加工口径，实际数据截止点尚未核定。",
    related: ["热度观测", "候选事件", "分发门控"],
  }),
  baselineItem({
    id: "intraday-company-response",
    phase: "盘中",
    domain: "company",
    time: "11:20",
    title: "董秘问答只显示新增答复事实",
    summary:
      "问题文本不作为公司事实，只有公司答复包含新增、可验证信息时才进入候选。",
    source: "Minishare · irm_qa",
    availability: "partial",
    weight: "观察",
    delta: "2 条答复",
    evidence: "2 条答复涉及订单交付进度，但缺少公告级材料交叉验证。",
    related: ["董秘问答", "公司回应", "证据缺口"],
  }),
  baselineItem({
    id: "intraday-news-candidate",
    phase: "盘中",
    domain: "news",
    time: "11:30",
    title: "快讯进入候选，不替代已确认事件",
    summary: "快讯材料保留来源和 URL，等待跨来源去重、实体关联和现实变化判断。",
    source: "Minishare · news",
    availability: "partial",
    weight: "观察",
    delta: "待核实 5 条",
    evidence: "5 条快讯缺少第二独立来源或公告原文，当前展示为待核实变化。",
    related: ["快讯", "待核实", "来源独立性"],
  }),
  baselineItem({
    id: "intraday-expectation-placeholder",
    phase: "盘中",
    domain: "expectation",
    time: "11:35",
    title: "盘中预期变化未校准，不生成实时共识",
    summary: "卖方预测主干为盘后更新，盘中只展示上一批次截止点和等待状态。",
    source: "TuShare · report_rc",
    asOf: "2026-08-02 22:00",
    availability: "waiting",
    weight: "观察",
    delta: "沿用旧批次",
    evidence: "当前没有经校准的盘中卖方预期增量源。",
    related: ["预期变化", "盘中降级", "旧批次"],
  }),
  baselineItem({
    id: "intraday-calendar-next",
    phase: "盘中",
    domain: "calendar",
    time: "14:30",
    title: "下午节点：主题复核窗口",
    summary: "前瞻日历在盘中只提示待观察节点，不把待发生事项包装为已确认变化。",
    source: "AlphaFlow · 事件日历",
    availability: "ready",
    weight: "日程",
    delta: "1 个节点",
    evidence: "14:30 复核上午候选主题与收盘结构是否一致。",
    related: ["复核窗口", "主题", "日历"],
  }),
  baselineItem({
    id: "post-market-structure",
    phase: "盘后",
    domain: "market",
    time: "16:20",
    title: "收盘结构：电力设备领涨，市场强度集中于两条主线",
    summary:
      "收盘后把指数、行业和主题放在同一张结构摘要中，便于决定下一步是否展开研究。",
    source: "TuShare · daily / sw_daily",
    asOf: "2026-08-03 16:18",
    availability: "ready",
    weight: "重点",
    delta: "+2.8% 领涨",
    evidence: "电力设备 +2.8%，通信 +2.1%；全市场上涨家数占比 58%。",
    related: ["电力设备", "通信", "行业研究"],
  }),
  baselineItem({
    id: "post-flow-optional-gap",
    phase: "盘后",
    domain: "flow",
    time: "17:20",
    title: "可选资金源缺口：概念资金暂未结算",
    summary:
      "必需行情和行业结构已达标，可选概念资金失败不阻塞新快照，但必须显示限制。",
    source: "TuShare · moneyflow_cnt_ths",
    availability: "partial",
    weight: "观察",
    delta: "缺口 1 源",
    evidence:
      "大盘和行业资金已结算，概念资金接口返回限流，快照状态为 READY_WITH_LIMITATION。",
    related: ["可选缺口", "资金流", "受限快照"],
  }),
  baselineItem({
    id: "post-company-buyback",
    phase: "盘后",
    domain: "company",
    time: "18:05",
    title: "公司动作：两家公司披露回购进展",
    summary:
      "把公告事实与公司实体关联后再进入研究事件候选，展示披露时间、原文链接和修订状态。",
    source: "TuShare · repurchase",
    asOf: "2026-08-03 17:58",
    availability: "ready",
    weight: "观察",
    delta: "新增 2 条",
    evidence:
      "公告披露回购金额区间和完成比例；暂不生成对价格或交易动作的判断。",
    related: ["公司公告", "回购", "证据链"],
  }),
  baselineItem({
    id: "post-news-confirmed",
    phase: "盘后",
    domain: "news",
    time: "18:40",
    title: "政策原文修订完成，候选仍需影响评估",
    summary:
      "新闻与政策区域区分原文事实、研究含义和证据缺口，不用摘要替代来源。",
    source: "Minishare · npr",
    availability: "ready",
    weight: "重点",
    delta: "修订 1 条",
    evidence: "政策原文、发文机构和文号已归一化；影响对象等待四维评估。",
    related: ["政策", "修订", "证据"],
  }),
  baselineItem({
    id: "post-expectation-revision",
    phase: "盘后",
    domain: "expectation",
    time: "19:20",
    title: "预期变化：卖方盈利预测出现集中上修",
    summary:
      "将预测修订作为跨公司可比较的研究信号，保留覆盖数、季度和原始来源。",
    source: "TuShare · report_rc",
    asOf: "2026-08-03 19:14",
    availability: "partial",
    weight: "重点",
    delta: "覆盖 12 家",
    evidence:
      "本日 12 家公司 FY2026 EPS 预测上修超过 3%，其中 7 家属于同一行业。",
    related: ["盈利预测", "行业扩散", "卖方数据"],
  }),
  baselineItem({
    id: "post-calendar-close",
    phase: "盘后",
    domain: "calendar",
    time: "20:00",
    title: "明日披露与解禁清单已进入前瞻",
    summary: "盘后日历把已发生数据结算和未来节点分开，供次日盘前直接复用。",
    source: "TuShare · disclosure_date / share_float",
    availability: "ready",
    weight: "日程",
    delta: "18 个节点",
    evidence: "明日披露 11 家、解禁 7 家；全部保留来源日历截止点。",
    related: ["披露", "解禁", "次日准备"],
  }),
  baselineItem({
    id: "forward-market-scenarios",
    phase: "前瞻",
    domain: "market",
    time: "未来 3 日",
    title: "市场结构前瞻：观察广度能否扩散",
    summary: "前瞻只提出观察条件，等待新数据观测到达后再形成修订。",
    source: "AlphaFlow · 基线推导",
    availability: "ready",
    weight: "观察",
    delta: "2 个条件",
    evidence: "连续两日上涨家数超过 55% 才视为广度扩散初步成立。",
    related: ["广度", "观察条件", "前瞻"],
  }),
  baselineItem({
    id: "forward-flow-watch",
    phase: "前瞻",
    domain: "flow",
    time: "未来 3 日",
    title: "资金前瞻：两融与行业资金等待同向确认",
    summary: "资金方向作为验证项，不把单一来源资金变化提前写成事件。",
    source: "TuShare · margin / moneyflow_ind_ths",
    availability: "partial",
    weight: "观察",
    delta: "待确认 2 源",
    evidence: "两融次日 08:30 更新上一日，行业资金预计盘后结算。",
    related: ["两融", "行业资金", "验证项"],
  }),
  baselineItem({
    id: "forward-company-disclosure",
    phase: "前瞻",
    domain: "company",
    time: "未来 7 日",
    title: "公司披露窗口：中报密集期开始",
    summary:
      "把将发生的公司节点与已发生事实分开，降低关键日期被信息流淹没的概率。",
    source: "TuShare · disclosure_date",
    availability: "ready",
    weight: "日程",
    delta: "23 家公司",
    evidence: "已确认披露日期 23 个，行业集中在电子、医药和机械。",
    related: ["财报窗口", "公司清单", "提前准备"],
  }),
  baselineItem({
    id: "forward-news-policy-window",
    phase: "前瞻",
    domain: "news",
    time: "未来 7 日",
    title: "政策与宏观窗口：等待原文发布",
    summary: "政策前瞻只记录发布日期和核实入口，不预设行业方向。",
    source: "TuShare · cn_schedule / Minishare · npr",
    availability: "partial",
    weight: "日程",
    delta: "3 条",
    evidence: "3 条宏观与政策发布时间已确认，原文尚未发布。",
    related: ["政策日历", "宏观", "待发布"],
  }),
  baselineItem({
    id: "forward-expectation-consensus",
    phase: "前瞻",
    domain: "expectation",
    time: "未来 7 日",
    title: "一致预期窗口：关注预期与现实数据的错位",
    summary:
      "前瞻区只提出待验证问题，等新数据观测和研究事件到达后再形成可追溯修订。",
    source: "TuShare · forecast / express",
    availability: "partial",
    weight: "观察",
    delta: "待验证 4 组",
    evidence: "4 组公司存在较高预期差，当前仅有预测值，缺少下一期实际披露。",
    related: ["预期差", "待验证", "财报"],
  }),
  baselineItem({
    id: "forward-calendar-macro",
    phase: "前瞻",
    domain: "calendar",
    time: "未来 7 日",
    title: "事件日历：财报、分红、解禁和宏观数据集中",
    summary:
      "首批前瞻覆盖财报披露、分红、解禁、IPO 和宏观数据；派生日历需指向原始材料。",
    source: "TuShare · disclosure_date / dividend / new_share / cn_schedule",
    availability: "ready",
    weight: "日程",
    delta: "41 个节点",
    evidence: "财报 23 个、分红 6 个、解禁 7 个、IPO 2 个、宏观数据 3 个。",
    related: ["财报", "分红", "解禁"],
  }),
];

export const MARKET_BASELINE_CHARTS: Record<
  MarketBaselinePhase,
  MarketBaselineChartSnapshot
> = {
  盘前: {
    coverageId: "baseline-coverage-20260803-pre",
    actualDataCutoff: "2026-08-03 08:50",
    status: "partial",
    breadth: {
      values: [49, 44, 57, 52, 45, 42, 35],
      labels: ["07/27", "07/28", "07/29", "07/30", "07/31", "08/02", "今"],
      headline: "35% 上涨家数",
      note: "较 5 日均值低 8 个百分点",
    },
    flows: [
      { label: "沪股通", value: 11.2, display: "+11.2", tone: "positive" },
      { label: "深股通", value: 7.2, display: "+7.2", tone: "positive" },
      { label: "两融余额", value: -3.1, display: "-3.1", tone: "negative" },
      { label: "龙虎榜", value: 2.4, display: "+2.4", tone: "neutral" },
    ],
    events: [
      { time: "09:30", label: "制造业 PMI", state: "next" },
      { time: "11:00", label: "政策窗口", state: "watch" },
      { time: "15:00", label: "收盘数据", state: "watch" },
    ],
  },
  盘中: {
    coverageId: "baseline-coverage-20260803-intraday",
    actualDataCutoff: "2026-08-02 22:00",
    status: "waiting",
    breadth: {
      values: [35, 42, 38, 51, 48, 45, 40],
      labels: ["09:35", "09:50", "10:10", "10:30", "11:00", "11:30", "旧"],
      headline: "盘中实时未校准",
      note: "图表为降级占位，不代表实时市场结构",
    },
    flows: [
      { label: "沪股通", value: 0, display: "待校准", tone: "neutral" },
      { label: "深股通", value: 0, display: "待校准", tone: "neutral" },
      { label: "主力大单", value: 0, display: "待校准", tone: "neutral" },
      { label: "热度候选", value: 4, display: "4 条", tone: "neutral" },
    ],
    events: [
      { time: "09:30", label: "PMI 已发布", state: "done" },
      { time: "11:00", label: "政策窗口", state: "next" },
      { time: "14:30", label: "主题复核", state: "watch" },
    ],
  },
  盘后: {
    coverageId: "baseline-coverage-20260803-post",
    actualDataCutoff: "2026-08-03 19:20",
    status: "partial",
    breadth: {
      values: [35, 40, 43, 48, 53, 55, 58],
      labels: ["07/27", "07/28", "07/29", "07/30", "07/31", "08/02", "今"],
      headline: "58% 上涨家数",
      note: "较昨日增加 16 个百分点",
    },
    flows: [
      { label: "沪股通", value: 18.4, display: "+18.4", tone: "positive" },
      { label: "行业资金", value: 11.2, display: "+11.2", tone: "positive" },
      { label: "两融余额", value: 4.2, display: "+4.2", tone: "positive" },
      { label: "概念资金", value: 0, display: "缺口", tone: "negative" },
    ],
    events: [
      { time: "16:20", label: "收盘结构", state: "done" },
      { time: "18:05", label: "公司公告", state: "done" },
      { time: "19:20", label: "预期修订", state: "next" },
    ],
  },
  前瞻: {
    coverageId: "baseline-coverage-20260803-forward",
    actualDataCutoff: "2026-08-03 20:02",
    status: "partial",
    breadth: {
      values: [42, 45, 44, 51, 48, 55, 53],
      labels: ["今", "+1 日", "+2 日", "+3 日", "+4 日", "+5 日", "+7 日"],
      headline: "53% 预期广度",
      note: "由已确认披露与行业预期推导",
    },
    flows: [
      { label: "披露窗口", value: 23, display: "23 家", tone: "neutral" },
      { label: "预期上修", value: 12, display: "12 家", tone: "positive" },
      { label: "待验证组", value: 4, display: "4 组", tone: "negative" },
      { label: "政策节点", value: 3, display: "3 条", tone: "neutral" },
    ],
    events: [
      { time: "+1 日", label: "披露窗口", state: "next" },
      { time: "+3 日", label: "宏观数据", state: "watch" },
      { time: "+7 日", label: "预期复核", state: "watch" },
    ],
  },
};

export const PROFESSIONAL_MARKET_BASELINE: MarketBaselineReadModel = {
  snapshotId: "baseline-snapshot-20260803-v04",
  state: "CURRENT_READY_WITH_LIMITATION",
  generatedAt: "2026-08-03T20:05:00.000+08:00",
  globalActualDataCutoff: "2026-08-03 20:02",
  coverageId: "baseline-coverage-20260803",
  limitations: [
    "盘中实时行情尚未完成授权、完整性和延迟校准。",
    "盘后概念资金为可选缺口，当前快照以受限状态展示。",
    "必需数据未达标时继续读取上一份可用专业市场基线快照。",
  ],
  degradation:
    "未校准盘中能力只展示实际截止点和降级状态，不承诺实时，不触发异常紧急提醒。",
  phases: PHASE_DEFINITIONS,
  domains: MARKET_BASELINE_DOMAINS,
  items: MARKET_BASELINE_ITEMS,
  charts: MARKET_BASELINE_CHARTS,
};

export function getBaselineItemsForPhase(phase: MarketBaselinePhase) {
  return MARKET_BASELINE_ITEMS.filter((item) => item.phase === phase);
}

export function getBaselineItemsForDomain(
  phase: MarketBaselinePhase,
  _domain: MarketBaselineDomainId | "all",
) {
  return getBaselineItemsForPhase(phase);
}

export function getBaselinePhaseCounts() {
  return Object.fromEntries(
    MARKET_BASELINE_PHASES.map((phase) => [
      phase,
      getBaselineItemsForPhase(phase).length,
    ]),
  ) as Record<MarketBaselinePhase, number>;
}
