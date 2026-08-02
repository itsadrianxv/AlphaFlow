"use client";

import {
  ArrowLeft,
  ArrowRight,
  CalendarDays,
  Check,
  ChevronDown,
  ChevronRight,
  CircleAlert,
  Clock3,
  ExternalLink,
  Filter,
  Layers3,
  ListFilter,
  Pin,
  Radio,
  Search,
  SlidersHorizontal,
  Sparkles,
  X,
} from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";

import { WorkspaceShell } from "~/app/_components/ui";

type Phase = "盘前" | "盘中" | "盘后" | "前瞻";
type DomainId =
  | "market"
  | "flow"
  | "company"
  | "news"
  | "expectation"
  | "calendar";
type Availability = "ready" | "partial" | "waiting";
type Weight = "重点" | "观察" | "日程";

type Domain = {
  id: DomainId;
  label: string;
  shortLabel: string;
  note: string;
};

type MarketItem = {
  id: string;
  phase: Phase;
  domain: DomainId;
  time: string;
  title: string;
  summary: string;
  source: string;
  asOf: string;
  availability: Availability;
  weight: Weight;
  delta: string;
  evidence: string;
  related: string[];
};

const PHASES: Array<{
  id: Phase;
  label: string;
  description: string;
}> = [
  { id: "盘前", label: "盘前", description: "开盘前的结构与今日准备" },
  { id: "盘中", label: "盘中", description: "交易时段的变化与异常" },
  { id: "盘后", label: "盘后", description: "收盘后的事实与修订" },
  { id: "前瞻", label: "前瞻", description: "未来几日的日程与预期" },
];

const DOMAINS: Domain[] = [
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

const ITEMS: MarketItem[] = [
  {
    id: "pre-market-breadth",
    phase: "盘前",
    domain: "market",
    time: "08:45",
    title: "上一交易日上涨家数回落，结构仍偏窄",
    summary:
      "沪深主要指数收盘接近持平，行业涨跌分化扩大，关注开盘后是否继续由少数主题贡献指数强度。",
    source: "TuShare · daily / index_daily",
    asOf: "2026-08-01 16:10",
    availability: "ready",
    weight: "重点",
    delta: "广度 42% → 35%",
    evidence: "沪深 A 股上涨 1,862 家，下跌 3,021 家；申万一级行业 8/31 上涨。",
    related: ["市场广度", "主题集中度", "开盘观察"],
  },
  {
    id: "pre-flow-northbound",
    phase: "盘前",
    domain: "flow",
    time: "08:52",
    title: "北向资金净流入转正，但持续性尚待盘中确认",
    summary:
      "上一交易日互联互通口径净流入 18.4 亿元，集中在电力设备与银行；不把单日资金变化直接当作事件。",
    source: "TuShare · moneyflow_mkt_dc",
    asOf: "2026-08-01 19:12",
    availability: "ready",
    weight: "观察",
    delta: "+18.4 亿元",
    evidence: "沪股通净流入 11.2 亿元，深股通净流入 7.2 亿元；行业集中度 63%。",
    related: ["资金集中", "电力设备", "银行"],
  },
  {
    id: "pre-policy-window",
    phase: "盘前",
    domain: "news",
    time: "09:05",
    title: "政策窗口：设备更新相关表述出现新增细则",
    summary:
      "来源文本已归一化为研究事件候选，页面只显示可核实事实与原文入口，不将政策表述直接转成个股结论。",
    source: "Minishare · 政策法规",
    asOf: "2026-08-02 07:34",
    availability: "partial",
    weight: "重点",
    delta: "新增 1 条",
    evidence: "原文包含资金支持范围和申报时间要求，涉及行业边界仍需人工确认。",
    related: ["设备更新", "政策候选", "待核实"],
  },
  {
    id: "pre-calendar-pmi",
    phase: "盘前",
    domain: "calendar",
    time: "09:30",
    title: "今日节点：制造业 PMI 发布",
    summary:
      "把事件日历作为准备工作，不提前写成方向判断；发布后由数据观测更新市场结构与预期变化。",
    source: "国家统计局 · 日历",
    asOf: "2026-08-01 20:00",
    availability: "ready",
    weight: "日程",
    delta: "距离 25 分钟",
    evidence: "数据发布时间为 09:30，发布后预计先更新宏观数据观测。",
    related: ["宏观数据", "盘中观察", "数据更新"],
  },
  {
    id: "intraday-permission",
    phase: "盘中",
    domain: "market",
    time: "10:30",
    title: "盘中市场结构需实时权限，当前仅保留上一快照",
    summary:
      "这是一条明确的产品降级状态：不使用过期快照伪装实时，不在缺少权限时发出紧急提醒。",
    source: "TuShare · rt_k（未开通）",
    asOf: "尚未接入",
    availability: "waiting",
    weight: "观察",
    delta: "权限待确认",
    evidence:
      "实时日线属于独立权限，与 15,000 积分无关；需完成授权、质量和延迟校准。",
    related: ["数据权利", "盘中降级", "不发提醒"],
  },
  {
    id: "intraday-hot-theme",
    phase: "盘中",
    domain: "flow",
    time: "11:15",
    title: "主题热度仅作为观测，不直接升级为研究事件",
    summary:
      "盘中热榜可进入候选队列，只有出现可引用的现实变化、去重通过并完成四维评估后才进入收件箱。",
    source: "TuShare · ths_hot（待授权）",
    asOf: "待权限校准",
    availability: "waiting",
    weight: "观察",
    delta: "候选，不分发",
    evidence: "热榜属于供应商加工口径，商业再分发权与实际数据截止点尚未核定。",
    related: ["热度观测", "候选事件", "分发门控"],
  },
  {
    id: "post-close-structure",
    phase: "盘后",
    domain: "market",
    time: "16:20",
    title: "收盘结构：电力设备领涨，市场强度集中于两条主线",
    summary:
      "收盘后把指数、行业和主题放在同一张结构摘要中，便于决定下一步是否展开行业或公司研究。",
    source: "TuShare · daily / sw_daily",
    asOf: "2026-08-02 16:18",
    availability: "ready",
    weight: "重点",
    delta: "+2.8% 领涨",
    evidence: "电力设备 +2.8%，通信 +2.1%；全市场上涨家数占比 58%。",
    related: ["电力设备", "通信", "行业研究"],
  },
  {
    id: "post-financial-change",
    phase: "盘后",
    domain: "company",
    time: "18:05",
    title: "公司动作：两家公司披露回购进展",
    summary:
      "把公告事实与公司实体关联后再进入研究事件候选，展示披露时间、原文链接和修订状态。",
    source: "TuShare · repurchase",
    asOf: "2026-08-02 17:58",
    availability: "ready",
    weight: "观察",
    delta: "新增 2 条",
    evidence:
      "公告披露回购金额区间和完成比例；暂不生成对价格或交易动作的判断。",
    related: ["公司公告", "回购", "证据链"],
  },
  {
    id: "post-expectation",
    phase: "盘后",
    domain: "expectation",
    time: "19:20",
    title: "预期变化：卖方盈利预测出现集中上修",
    summary:
      "将预测修订作为跨公司可比较的研究信号，保留覆盖数、季度和原始来源，不把评级当作建议。",
    source: "TuShare · report_rc",
    asOf: "2026-08-02 19:14",
    availability: "partial",
    weight: "重点",
    delta: "覆盖 12 家",
    evidence:
      "本日 12 家公司 FY2026 EPS 预测上修超过 3%，其中 7 家属于同一行业。",
    related: ["盈利预测", "行业扩散", "卖方数据"],
  },
  {
    id: "forward-disclosure",
    phase: "前瞻",
    domain: "calendar",
    time: "未来 3 日",
    title: "披露日历：下周一进入中报密集窗口",
    summary:
      "把将发生的节点与今日已发生的事实分开，降低研究者在信息流中漏掉关键日期的概率。",
    source: "TuShare · disclosure_date",
    asOf: "2026-08-02 20:02",
    availability: "ready",
    weight: "日程",
    delta: "23 家公司",
    evidence: "已确认披露日期 23 个，行业集中在电子、医药和机械。",
    related: ["财报窗口", "公司清单", "提前准备"],
  },
  {
    id: "forward-consensus",
    phase: "前瞻",
    domain: "expectation",
    time: "未来 7 日",
    title: "一致预期窗口：关注预期与现实数据的错位",
    summary:
      "前瞻区只提出待验证的问题，等新数据观测和研究事件到达后再形成可追溯的修订。",
    source: "TuShare · forecast / express",
    asOf: "2026-08-02 20:02",
    availability: "partial",
    weight: "观察",
    delta: "待验证 4 组",
    evidence: "4 组公司存在较高预期差，当前仅有预测值，缺少下一期实际披露。",
    related: ["预期差", "待验证", "财报"],
  },
];

type ChartSnapshot = {
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

const CHART_SNAPSHOTS: Record<Phase, ChartSnapshot> = {
  盘前: {
    breadth: {
      values: [49, 44, 57, 52, 45, 42, 35],
      labels: ["07/25", "07/28", "07/29", "07/30", "07/31", "08/01", "今"],
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
    breadth: {
      values: [35, 42, 38, 51, 48, 45, 40],
      labels: ["09:35", "09:50", "10:10", "10:30", "11:00", "11:30", "今"],
      headline: "40% 上涨家数",
      note: "实时权限未开通，当前仅作状态占位",
    },
    flows: [
      { label: "沪股通", value: 6.4, display: "+6.4", tone: "positive" },
      { label: "深股通", value: 2.8, display: "+2.8", tone: "positive" },
      { label: "主力大单", value: -1.6, display: "-1.6", tone: "negative" },
      { label: "热度候选", value: 4.0, display: "4 条", tone: "neutral" },
    ],
    events: [
      { time: "09:30", label: "PMI 已发布", state: "done" },
      { time: "11:00", label: "政策窗口", state: "next" },
      { time: "14:30", label: "主题复核", state: "watch" },
    ],
  },
  盘后: {
    breadth: {
      values: [35, 40, 43, 48, 53, 55, 58],
      labels: ["07/25", "07/28", "07/29", "07/30", "07/31", "08/01", "今"],
      headline: "58% 上涨家数",
      note: "较昨日增加 16 个百分点",
    },
    flows: [
      { label: "沪股通", value: 18.4, display: "+18.4", tone: "positive" },
      { label: "行业资金", value: 11.2, display: "+11.2", tone: "positive" },
      { label: "两融余额", value: 4.2, display: "+4.2", tone: "positive" },
      { label: "龙虎榜", value: -2.1, display: "-2.1", tone: "negative" },
    ],
    events: [
      { time: "16:20", label: "收盘结构", state: "done" },
      { time: "18:05", label: "公司公告", state: "done" },
      { time: "19:20", label: "预期修订", state: "next" },
    ],
  },
  前瞻: {
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

const VARIANTS = ["A", "B", "C"] as const;
type Variant = (typeof VARIANTS)[number];

const VARIANT_NAMES: Record<Variant, string> = {
  A: "时段走廊",
  B: "研究工作台",
  C: "简报流",
};

function getDomain(domainId: DomainId) {
  return (
    DOMAINS.find((domain) => domain.id === domainId) ?? {
      id: "market",
      label: "市场结构",
      shortLabel: "结构",
      note: "指数、广度、行业与主题强弱",
    }
  );
}

function availabilityLabel(value: Availability) {
  if (value === "ready") return "可用";
  if (value === "partial") return "部分可用";
  return "待权限";
}

function availabilityClass(value: Availability) {
  if (value === "ready") {
    return "border-[rgba(17,255,153,0.28)] bg-[rgba(17,255,153,0.08)] text-[var(--app-success-text)]";
  }
  if (value === "partial") {
    return "border-[rgba(255,197,61,0.28)] bg-[rgba(255,197,61,0.08)] text-[var(--app-warning)]";
  }
  return "border-[var(--app-border-soft)] bg-[var(--app-bg-raised)] text-[var(--app-text-subtle)]";
}

function weightClass(value: Weight) {
  if (value === "重点") return "text-[var(--app-flame)]";
  if (value === "日程") return "text-[var(--app-info)]";
  return "text-[var(--app-text-muted)]";
}

function PhaseTabs(props: {
  active: Phase;
  onChange: (phase: Phase) => void;
  counts: Record<Phase, number>;
  compact?: boolean;
}) {
  return (
    <div
      className="grid grid-cols-2 border-b border-[var(--app-border-soft)] sm:grid-cols-4"
      role="tablist"
      aria-label="交易阶段"
    >
      {PHASES.map((phase) => (
        <button
          key={phase.id}
          type="button"
          role="tab"
          aria-selected={props.active === phase.id}
          onClick={() => props.onChange(phase.id)}
          className={`min-h-[72px] border-b-2 px-3 py-3 text-left transition-colors ${
            props.active === phase.id
              ? "border-[var(--app-brand)] bg-[var(--app-selection)] text-[var(--app-text-strong)]"
              : "border-transparent text-[var(--app-text-muted)] hover:bg-[var(--app-bg-raised)] hover:text-[var(--app-text-strong)]"
          } ${props.compact ? "min-h-[58px]" : ""}`}
        >
          <span className="flex items-center justify-between gap-2 text-sm font-medium">
            {phase.label}
            <span className="app-data text-xs text-[var(--app-text-subtle)]">
              {props.counts[phase.id]}
            </span>
          </span>
          <span className="mt-1 block text-xs leading-5 text-[var(--app-text-subtle)]">
            {phase.description}
          </span>
        </button>
      ))}
    </div>
  );
}

function DomainList(props: {
  active: DomainId | "all";
  onChange: (domain: DomainId | "all") => void;
  items: MarketItem[];
  heading?: string;
}) {
  const counts = useMemo(() => {
    const next = Object.fromEntries(
      DOMAINS.map((domain) => [domain.id, 0]),
    ) as Record<DomainId, number>;
    for (const item of props.items) next[item.domain] += 1;
    return next;
  }, [props.items]);

  return (
    <div>
      {props.heading ? (
        <div className="mb-2 flex items-center gap-2 text-xs font-medium text-[var(--app-text-subtle)]">
          <Layers3 className="h-3.5 w-3.5" />
          {props.heading}
        </div>
      ) : null}
      <div className="grid gap-1">
        <button
          type="button"
          aria-pressed={props.active === "all"}
          onClick={() => props.onChange("all")}
          className={`flex items-center justify-between gap-3 border-l-2 px-3 py-2 text-left text-sm transition-colors ${
            props.active === "all"
              ? "border-[var(--app-brand)] bg-[var(--app-selection)] text-[var(--app-text-strong)]"
              : "border-transparent text-[var(--app-text-muted)] hover:bg-[var(--app-bg-raised)] hover:text-[var(--app-text-strong)]"
          }`}
        >
          <span>全部信息域</span>
          <span className="app-data text-xs text-[var(--app-text-subtle)]">
            {props.items.length}
          </span>
        </button>
        {DOMAINS.map((domain) => (
          <button
            key={domain.id}
            type="button"
            aria-pressed={props.active === domain.id}
            onClick={() => props.onChange(domain.id)}
            className={`flex items-center justify-between gap-3 border-l-2 px-3 py-2 text-left text-sm transition-colors ${
              props.active === domain.id
                ? "border-[var(--app-brand)] bg-[var(--app-selection)] text-[var(--app-text-strong)]"
                : "border-transparent text-[var(--app-text-muted)] hover:bg-[var(--app-bg-raised)] hover:text-[var(--app-text-strong)]"
            }`}
          >
            <span className="min-w-0 truncate">{domain.label}</span>
            <span className="app-data shrink-0 text-xs text-[var(--app-text-subtle)]">
              {counts[domain.id]}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

function PhasePicker(props: {
  active: Phase;
  onChange: (phase: Phase) => void;
  counts: Record<Phase, number>;
}) {
  const [open, setOpen] = useState(false);
  const current =
    PHASES.find((phase) => phase.id === props.active) ?? PHASES[0];

  return (
    <div className="relative">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="选择交易阶段"
        onClick={() => setOpen((value) => !value)}
        className="inline-flex min-h-9 items-center gap-2 border border-[var(--app-border-soft)] bg-[var(--app-bg-raised)] px-3 text-sm text-[var(--app-text-strong)] transition-colors hover:border-[var(--app-hover-border)]"
      >
        <Clock3 className="h-3.5 w-3.5 text-[var(--app-brand)]" />
        <span>{current?.label}</span>
        <ChevronDown className="h-3.5 w-3.5 text-[var(--app-text-subtle)]" />
      </button>
      {open ? (
        <div
          role="menu"
          aria-label="交易阶段"
          className="absolute right-0 top-full z-30 mt-1 min-w-[220px] border border-[var(--app-border-strong)] bg-[var(--app-panel-strong)] p-1 shadow-[0_4px_16px_rgba(0,0,0,0.28)]"
        >
          {PHASES.map((phase) => (
            <button
              key={phase.id}
              type="button"
              role="menuitem"
              onClick={() => {
                props.onChange(phase.id);
                setOpen(false);
              }}
              className={`flex w-full items-start justify-between gap-4 px-3 py-2 text-left transition-colors ${
                props.active === phase.id
                  ? "bg-[var(--app-selection)] text-[var(--app-text-strong)]"
                  : "text-[var(--app-text-muted)] hover:bg-[var(--app-bg-raised)] hover:text-[var(--app-text-strong)]"
              }`}
            >
              <span>
                <span className="block text-sm font-medium">{phase.label}</span>
                <span className="mt-0.5 block text-xs text-[var(--app-text-subtle)]">
                  {phase.description}
                </span>
              </span>
              <span className="app-data pt-0.5 text-xs text-[var(--app-text-subtle)]">
                {props.counts[phase.id]}
              </span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function DomainTabs(props: {
  active: DomainId | "all";
  onChange: (domain: DomainId | "all") => void;
  items: MarketItem[];
}) {
  const counts = useMemo(() => {
    const next = Object.fromEntries(
      DOMAINS.map((domain) => [domain.id, 0]),
    ) as Record<DomainId, number>;
    for (const item of props.items) next[item.domain] += 1;
    return next;
  }, [props.items]);

  return (
    <nav
      className="app-scroll flex min-w-0 gap-1 overflow-x-auto border-b border-[var(--app-border-soft)] px-5"
      aria-label="信息域"
    >
      <button
        type="button"
        aria-pressed={props.active === "all"}
        onClick={() => props.onChange("all")}
        className={`shrink-0 border-b-2 px-3 py-3 text-sm transition-colors ${
          props.active === "all"
            ? "border-[var(--app-brand)] text-[var(--app-text-strong)]"
            : "border-transparent text-[var(--app-text-muted)] hover:text-[var(--app-text-strong)]"
        }`}
      >
        全部
        <span className="app-data ml-2 text-xs text-[var(--app-text-subtle)]">
          {props.items.length}
        </span>
      </button>
      {DOMAINS.map((domain) => (
        <button
          key={domain.id}
          type="button"
          aria-pressed={props.active === domain.id}
          onClick={() => props.onChange(domain.id)}
          className={`shrink-0 border-b-2 px-3 py-3 text-sm transition-colors ${
            props.active === domain.id
              ? "border-[var(--app-brand)] text-[var(--app-text-strong)]"
              : "border-transparent text-[var(--app-text-muted)] hover:text-[var(--app-text-strong)]"
          }`}
        >
          {domain.label}
          <span className="app-data ml-2 text-xs text-[var(--app-text-subtle)]">
            {counts[domain.id]}
          </span>
        </button>
      ))}
    </nav>
  );
}

function TrendChart(props: { values: number[]; labels: string[] }) {
  const min = Math.min(...props.values);
  const max = Math.max(...props.values);
  const range = max - min || 1;
  const points = props.values
    .map((value, index) => {
      const x = (index / Math.max(props.values.length - 1, 1)) * 100;
      const y = 84 - ((value - min) / range) * 68;
      return `${x},${y}`;
    })
    .join(" ");
  const lastPoint = points.split(" ").at(-1)?.split(",") ?? ["100", "16"];

  return (
    <div>
      <svg
        viewBox="0 0 100 92"
        preserveAspectRatio="none"
        className="h-[92px] w-full"
        role="img"
        aria-label="市场广度趋势图"
      >
        <line
          x1="0"
          x2="100"
          y1="84"
          y2="84"
          stroke="var(--app-border-soft)"
          strokeWidth="0.8"
        />
        <line
          x1="0"
          x2="100"
          y1="50"
          y2="50"
          stroke="var(--app-border-soft)"
          strokeWidth="0.5"
          strokeDasharray="1.5 2"
        />
        <polyline
          points={points}
          fill="none"
          stroke="var(--app-brand)"
          strokeWidth="1.8"
          strokeLinecap="square"
          strokeLinejoin="round"
        />
        <circle
          cx={lastPoint[0]}
          cy={lastPoint[1]}
          r="2.4"
          fill="var(--app-brand)"
        />
      </svg>
      <div className="flex justify-between gap-2 text-[10px] text-[var(--app-text-soft)]">
        {props.labels.map((label) => (
          <span key={label}>{label}</span>
        ))}
      </div>
    </div>
  );
}

function FlowBarsChart({ flows }: { flows: ChartSnapshot["flows"] }) {
  const max = Math.max(...flows.map((flow) => Math.abs(flow.value)), 1);
  return (
    <div className="grid gap-2.5">
      {flows.map((flow) => {
        const width = `${Math.max(8, (Math.abs(flow.value) / max) * 100)}%`;
        const color =
          flow.tone === "positive"
            ? "var(--app-success)"
            : flow.tone === "negative"
              ? "var(--app-danger)"
              : "var(--app-info)";
        return (
          <div
            key={flow.label}
            className="grid grid-cols-[64px_minmax(0,1fr)_44px] items-center gap-2 text-xs"
          >
            <span className="truncate text-[var(--app-text-muted)]">
              {flow.label}
            </span>
            <span className="h-2 bg-[var(--app-bg-raised)]">
              <span
                className="block h-full"
                style={{ width, backgroundColor: color }}
              />
            </span>
            <span className="app-data text-right text-[var(--app-text-muted)]">
              {flow.display}
            </span>
          </div>
        );
      })}
    </div>
  );
}

function EventTimelineChart({ events }: { events: ChartSnapshot["events"] }) {
  return (
    <div className="relative pl-1">
      <div
        className="absolute bottom-2 left-[5px] top-2 w-px bg-[var(--app-border-soft)]"
        aria-hidden="true"
      />
      <div className="grid gap-3">
        {events.map((event) => {
          const color =
            event.state === "done"
              ? "var(--app-success)"
              : event.state === "next"
                ? "var(--app-brand)"
                : "var(--app-info)";
          return (
            <div
              key={`${event.time}-${event.label}`}
              className="relative grid grid-cols-[28px_minmax(0,1fr)] items-start gap-2"
            >
              <span
                className="relative z-10 mt-1 h-2.5 w-2.5 border-2 border-[var(--app-bg-inset)]"
                style={{ backgroundColor: color }}
              />
              <div className="min-w-0">
                <div className="flex items-center justify-between gap-2 text-xs">
                  <span className="app-data text-[var(--app-text-subtle)]">
                    {event.time}
                  </span>
                  <span style={{ color }}>
                    {event.state === "done"
                      ? "已完成"
                      : event.state === "next"
                        ? "下一节点"
                        : "留意"}
                  </span>
                </div>
                <div className="mt-1 text-sm text-[var(--app-text-strong)]">
                  {event.label}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function MarketCharts({ phase }: { phase: Phase }) {
  const snapshot = CHART_SNAPSHOTS[phase];
  return (
    <div className="grid border-b border-[var(--app-border-soft)] md:grid-cols-[1.2fr_1fr_0.9fr]">
      <section className="min-w-0 border-b border-[var(--app-border-soft)] px-5 py-4 md:border-b-0 md:border-r">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="text-sm font-medium text-[var(--app-text-strong)]">
              市场广度
            </h3>
            <p className="mt-1 text-xs text-[var(--app-text-subtle)]">
              上涨家数占比 · 近 7 个观测点
            </p>
          </div>
          <div className="text-right">
            <div className="app-data text-base text-[var(--app-brand)]">
              {snapshot.breadth.headline}
            </div>
            <div className="mt-1 text-[10px] text-[var(--app-text-subtle)]">
              {snapshot.breadth.note}
            </div>
          </div>
        </div>
        <div className="mt-3">
          <TrendChart
            values={snapshot.breadth.values}
            labels={snapshot.breadth.labels}
          />
        </div>
      </section>
      <section className="min-w-0 border-b border-[var(--app-border-soft)] px-5 py-4 md:border-b-0 md:border-r">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="text-sm font-medium text-[var(--app-text-strong)]">
              资金方向
            </h3>
            <p className="mt-1 text-xs text-[var(--app-text-subtle)]">
              来源口径 · 单位按项目展示
            </p>
          </div>
          <SlidersHorizontal className="h-4 w-4 text-[var(--app-text-subtle)]" />
        </div>
        <div className="mt-5">
          <FlowBarsChart flows={snapshot.flows} />
        </div>
      </section>
      <section className="min-w-0 px-5 py-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="text-sm font-medium text-[var(--app-text-strong)]">
              关键节点
            </h3>
            <p className="mt-1 text-xs text-[var(--app-text-subtle)]">
              按当前阶段排序
            </p>
          </div>
          <CalendarDays className="h-4 w-4 text-[var(--app-text-subtle)]" />
        </div>
        <div className="mt-4">
          <EventTimelineChart events={snapshot.events} />
        </div>
      </section>
    </div>
  );
}

function PrototypeNotice() {
  return (
    <div className="mb-5 flex flex-wrap items-start justify-between gap-4 border border-[var(--app-warning-border)] bg-[var(--app-warning-surface)] px-4 py-3 text-sm">
      <div className="flex min-w-0 items-start gap-3">
        <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-[var(--app-warning)]" />
        <div>
          <div className="font-medium text-[var(--app-text-strong)]">
            这是决策原型，不是生产页面
          </div>
          <div className="mt-1 max-w-3xl leading-6 text-[var(--app-text-muted)]">
            三种方案使用同一组 mock
            信息，重点观察研究者如何在四个交易阶段和六类信息域之间建立方向感。
          </div>
        </div>
      </div>
      <div className="app-data shrink-0 text-xs text-[var(--app-text-subtle)]">
        数据截至 2026-08-02 20:02
      </div>
    </div>
  );
}

function StatusMark(props: { value: Availability }) {
  return (
    <span
      className={`inline-flex items-center gap-1 border px-2 py-1 text-[11px] ${availabilityClass(props.value)}`}
    >
      {props.value === "ready" ? (
        <Check className="h-3 w-3" />
      ) : props.value === "partial" ? (
        <CircleAlert className="h-3 w-3" />
      ) : (
        <Clock3 className="h-3 w-3" />
      )}
      {availabilityLabel(props.value)}
    </span>
  );
}

function ItemDetail(props: {
  item: MarketItem;
  pinned: boolean;
  onTogglePin: () => void;
  onClose: () => void;
}) {
  const { item } = props;
  return (
    <aside className="border-l border-[var(--app-border-soft)] bg-[var(--app-bg-raised)] p-5 lg:w-[320px] lg:shrink-0">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2 text-xs text-[var(--app-text-subtle)]">
            <span>{getDomain(item.domain).label}</span>
            <span aria-hidden="true">·</span>
            <span>{item.phase}</span>
          </div>
          <h3 className="mt-3 text-base font-semibold leading-6 text-[var(--app-text-strong)]">
            {item.title}
          </h3>
        </div>
        <button
          type="button"
          aria-label="关闭详情"
          title="关闭详情"
          onClick={props.onClose}
          className="inline-flex h-8 w-8 shrink-0 items-center justify-center border border-transparent text-[var(--app-text-subtle)] hover:border-[var(--app-border-soft)] hover:text-[var(--app-text-strong)]"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
      <p className="mt-4 text-sm leading-6 text-[var(--app-text-muted)]">
        {item.summary}
      </p>
      <dl className="mt-5 grid gap-3 border-y border-[var(--app-border-soft)] py-4 text-xs">
        <div className="flex justify-between gap-3">
          <dt className="text-[var(--app-text-subtle)]">来源</dt>
          <dd className="text-right text-[var(--app-text-muted)]">
            {item.source}
          </dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt className="text-[var(--app-text-subtle)]">数据截至</dt>
          <dd className="app-data text-right text-[var(--app-text-muted)]">
            {item.asOf}
          </dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt className="text-[var(--app-text-subtle)]">变化</dt>
          <dd className={`text-right ${weightClass(item.weight)}`}>
            {item.delta}
          </dd>
        </div>
      </dl>
      <div className="mt-5">
        <div className="text-xs font-medium text-[var(--app-text-subtle)]">
          引用证据
        </div>
        <p className="mt-2 border-l-2 border-[var(--app-border-strong)] pl-3 text-sm leading-6 text-[var(--app-text-muted)]">
          {item.evidence}
        </p>
      </div>
      <div className="mt-5 flex flex-wrap gap-2">
        {item.related.map((tag) => (
          <span
            key={tag}
            className="border border-[var(--app-border-soft)] px-2 py-1 text-xs text-[var(--app-text-subtle)]"
          >
            {tag}
          </span>
        ))}
      </div>
      <div className="mt-6 grid gap-2">
        <button
          type="button"
          onClick={props.onTogglePin}
          className={`flex min-h-10 items-center justify-center gap-2 border px-3 text-sm transition-colors ${
            props.pinned
              ? "border-[var(--app-brand)] bg-[var(--app-selection)] text-[var(--app-text-strong)]"
              : "border-[var(--app-border-soft)] text-[var(--app-text-muted)] hover:border-[var(--app-hover-border)] hover:text-[var(--app-text-strong)]"
          }`}
        >
          <Pin className="h-4 w-4" />
          {props.pinned ? "已加入研究雷达" : "加入研究雷达"}
        </button>
        <button
          type="button"
          className="flex min-h-10 items-center justify-center gap-2 border border-transparent px-3 text-sm text-[var(--app-text-muted)] hover:text-[var(--app-text-strong)]"
        >
          打开证据上下文
          <ExternalLink className="h-3.5 w-3.5" />
        </button>
      </div>
    </aside>
  );
}

function PrototypeSwitcher({ current }: { current: Variant }) {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const currentIndex = VARIANTS.indexOf(current);

  const move = useCallback(
    (direction: -1 | 1) => {
      const nextIndex =
        (currentIndex + direction + VARIANTS.length) % VARIANTS.length;
      const nextParams = new URLSearchParams(searchParams.toString());
      nextParams.set("variant", VARIANTS[nextIndex] ?? VARIANTS[0]);
      router.replace(`${pathname}?${nextParams.toString()}`, { scroll: false });
    },
    [currentIndex, pathname, router, searchParams],
  );

  useEffect(() => {
    if (process.env.NODE_ENV === "production") return;
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (
        target?.matches("input, textarea, select, [contenteditable='true']")
      ) {
        return;
      }
      if (event.key === "ArrowLeft") {
        event.preventDefault();
        move(-1);
      }
      if (event.key === "ArrowRight") {
        event.preventDefault();
        move(1);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [move]);

  if (process.env.NODE_ENV === "production") return null;

  return (
    <div className="fixed bottom-5 left-1/2 z-50 flex -translate-x-1/2 items-center border border-[var(--app-border-strong)] bg-[var(--app-panel-strong)] text-[var(--app-text-strong)] shadow-[0_4px_16px_rgba(0,0,0,0.28)]">
      <button
        type="button"
        aria-label="上一个方案"
        title="上一个方案"
        onClick={() => move(-1)}
        className="inline-flex h-10 w-10 items-center justify-center border-r border-[var(--app-border-soft)] text-[var(--app-text-muted)] hover:bg-[var(--app-bg-raised)] hover:text-[var(--app-text-strong)]"
      >
        <ArrowLeft className="h-4 w-4" />
      </button>
      <div className="min-w-[154px] px-4 text-center text-xs">
        <span className="app-data text-[var(--app-brand)]">{current}</span>
        <span className="mx-2 text-[var(--app-text-soft)]">/</span>
        <span>{VARIANT_NAMES[current]}</span>
      </div>
      <button
        type="button"
        aria-label="下一个方案"
        title="下一个方案"
        onClick={() => move(1)}
        className="inline-flex h-10 w-10 items-center justify-center border-l border-[var(--app-border-soft)] text-[var(--app-text-muted)] hover:bg-[var(--app-bg-raised)] hover:text-[var(--app-text-strong)]"
      >
        <ArrowRight className="h-4 w-4" />
      </button>
    </div>
  );
}

function PhaseHeader({ phase, count }: { phase: Phase; count: number }) {
  const definition = PHASES.find((item) => item.id === phase);
  return (
    <div className="flex flex-wrap items-end justify-between gap-3 border-b border-[var(--app-border-soft)] pb-4">
      <div>
        <h2 className="text-lg font-semibold text-[var(--app-text-strong)]">
          {phase}
        </h2>
        <p className="mt-1 text-sm text-[var(--app-text-muted)]">
          {definition?.description}
        </p>
      </div>
      <div className="app-data text-xs text-[var(--app-text-subtle)]">
        {count} 条信息
      </div>
    </div>
  );
}

function ActionLink({ children }: { children: ReactNode }) {
  return (
    <button
      type="button"
      className="inline-flex items-center gap-1 text-xs text-[var(--app-text-muted)] hover:text-[var(--app-text-strong)]"
    >
      {children}
      <ChevronRight className="h-3.5 w-3.5" />
    </button>
  );
}

function VariantA(props: VariantProps) {
  const phaseItems = props.phaseItems;
  const visibleItems = props.visibleItems;
  const selectedItem = props.selectedItem;
  return (
    <div className="border border-[var(--app-border-soft)] bg-[var(--app-bg-inset)]">
      <div className="border-b border-[var(--app-border-soft)] px-5 py-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-sm text-[var(--app-text-muted)]">
            <Radio className="h-4 w-4 text-[var(--app-brand)]" />
            今日研究路径
          </div>
          <div className="flex items-center gap-2 text-xs text-[var(--app-text-subtle)]">
            <span className="h-2 w-2 bg-[var(--app-success)]" />
            盘后主干可用
          </div>
        </div>
        <div className="mt-4 flex items-center justify-between gap-3">
          <div className="text-xs text-[var(--app-text-subtle)]">
            先选工作阶段，再在下方横向浏览信息域
          </div>
          <PhasePicker
            active={props.activePhase}
            onChange={props.onPhaseChange}
            counts={props.phaseCounts}
          />
        </div>
      </div>
      <DomainTabs
        active={props.activeDomain}
        onChange={props.onDomainChange}
        items={phaseItems}
      />
      <MarketCharts phase={props.activePhase} />
      <div className="flex min-w-0 flex-col lg:flex-row">
        <div className="min-w-0 flex-1 p-5">
          <PhaseHeader phase={props.activePhase} count={visibleItems.length} />
          <div className="relative mt-5">
            <div
              className="absolute bottom-4 left-[7px] top-4 w-px bg-[var(--app-border-soft)]"
              aria-hidden="true"
            />
            <div className="grid gap-1">
              {visibleItems.map((item) => {
                const selected = item.id === props.selectedId;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => props.onSelect(item.id)}
                    className={`relative grid grid-cols-[36px_minmax(0,1fr)] gap-3 py-3 text-left transition-colors ${selected ? "bg-[var(--app-selection)]" : "hover:bg-[var(--app-bg-raised)]"}`}
                  >
                    <span className="relative z-10 mt-1.5 ml-[3px] h-2.5 w-2.5 border-2 border-[var(--app-bg-inset)] bg-[var(--app-brand)]" />
                    <span className="min-w-0 pr-3">
                      <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-[var(--app-text-subtle)]">
                        <span className="app-data">{item.time}</span>
                        <span>{getDomain(item.domain).shortLabel}</span>
                        <StatusMark value={item.availability} />
                      </span>
                      <span className="mt-2 block text-sm font-medium leading-6 text-[var(--app-text-strong)]">
                        {item.title}
                      </span>
                      <span className="mt-1 block text-sm leading-6 text-[var(--app-text-muted)]">
                        {item.summary}
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
        {selectedItem ? (
          <ItemDetail
            item={selectedItem}
            pinned={props.isPinned(selectedItem.id)}
            onTogglePin={() => props.togglePin(selectedItem.id)}
            onClose={() => props.onSelect(null)}
          />
        ) : (
          <aside className="hidden border-l border-[var(--app-border-soft)] bg-[var(--app-bg-raised)] p-5 text-sm leading-6 text-[var(--app-text-muted)] lg:block lg:w-[320px] lg:shrink-0">
            <div className="flex items-center gap-2 text-[var(--app-text-strong)]">
              <ListFilter className="h-4 w-4" />
              选择一条信息
            </div>
            <p className="mt-3">
              查看来源、证据和下一步研究入口。这个侧栏是否应该常驻，是本方案需要验证的取舍。
            </p>
          </aside>
        )}
      </div>
    </div>
  );
}

function VariantB(props: VariantProps) {
  const phaseItems = props.visibleItems;
  const selectedItem = props.selectedItem;
  const readyItems = phaseItems.filter((item) => item.availability === "ready");
  const needsReview = phaseItems.filter(
    (item) => item.availability !== "ready",
  );
  return (
    <div className="border border-[var(--app-border-soft)] bg-[var(--app-bg-inset)]">
      <div className="grid border-b border-[var(--app-border-soft)] lg:grid-cols-[minmax(0,1fr)_250px]">
        <div className="min-w-0 px-5 py-4">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <h2 className="text-lg font-semibold text-[var(--app-text-strong)]">
                研究工作台
              </h2>
              <p className="mt-1 text-sm text-[var(--app-text-muted)]">
                先看变化，再决定是否进入个性化研究。
              </p>
            </div>
            <button
              type="button"
              className="inline-flex min-h-9 items-center gap-2 border border-[var(--app-border-soft)] px-3 text-xs text-[var(--app-text-muted)] hover:border-[var(--app-hover-border)] hover:text-[var(--app-text-strong)]"
            >
              <SlidersHorizontal className="h-3.5 w-3.5" />
              调整视图
            </button>
          </div>
          <div className="mt-4">
            <PhaseTabs
              active={props.activePhase}
              onChange={props.onPhaseChange}
              counts={props.phaseCounts}
              compact
            />
          </div>
        </div>
        <div className="border-t border-[var(--app-border-soft)] px-5 py-4 lg:border-l lg:border-t-0">
          <div className="flex items-center justify-between gap-3 text-xs text-[var(--app-text-subtle)]">
            <span>我的研究雷达</span>
            <span className="app-data text-[var(--app-brand)]">
              {props.pinnedItems.size}
            </span>
          </div>
          {props.pinnedItems.size ? (
            <div className="mt-3 grid gap-2">
              {phaseItems
                .filter((item) => props.isPinned(item.id))
                .slice(0, 2)
                .map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => props.onSelect(item.id)}
                    className="truncate border-l-2 border-[var(--app-brand)] pl-2 text-left text-xs text-[var(--app-text-muted)] hover:text-[var(--app-text-strong)]"
                  >
                    {item.title}
                  </button>
                ))}
            </div>
          ) : (
            <p className="mt-3 text-xs leading-5 text-[var(--app-text-subtle)]">
              从左侧信息加入后，这里会形成你的研究队列。
            </p>
          )}
        </div>
      </div>
      <div className="grid min-w-0 lg:grid-cols-[188px_minmax(0,1fr)_320px]">
        <nav
          className="border-b border-[var(--app-border-soft)] p-4 lg:border-b-0 lg:border-r"
          aria-label="信息域"
        >
          <DomainList
            active={props.activeDomain}
            onChange={props.onDomainChange}
            items={phaseItems}
          />
          <div className="mt-6 border-t border-[var(--app-border-soft)] pt-4">
            <div className="flex items-center gap-2 text-xs text-[var(--app-text-subtle)]">
              <Filter className="h-3.5 w-3.5" />
              当前筛选
            </div>
            <div className="mt-3 text-xs leading-5 text-[var(--app-text-muted)]">
              {props.activePhase} ·{" "}
              {props.activeDomain === "all"
                ? "全部信息域"
                : getDomain(props.activeDomain).label}
            </div>
          </div>
        </nav>
        <div className="min-w-0 p-5">
          <PhaseHeader phase={props.activePhase} count={phaseItems.length} />
          <div className="mt-5 grid gap-5 xl:grid-cols-2">
            <section>
              <div className="mb-2 flex items-center justify-between gap-3">
                <h3 className="text-sm font-medium text-[var(--app-text-strong)]">
                  已形成观测
                </h3>
                <span className="app-data text-xs text-[var(--app-text-subtle)]">
                  {readyItems.length}
                </span>
              </div>
              <div className="divide-y divide-[var(--app-border-soft)] border-y border-[var(--app-border-soft)]">
                {readyItems.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => props.onSelect(item.id)}
                    className={`block w-full px-3 py-3 text-left transition-colors ${item.id === props.selectedId ? "bg-[var(--app-selection)]" : "hover:bg-[var(--app-bg-raised)]"}`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <span className="min-w-0 text-sm font-medium leading-5 text-[var(--app-text-strong)]">
                        {item.title}
                      </span>
                      <span
                        className={`shrink-0 text-xs ${weightClass(item.weight)}`}
                      >
                        {item.delta}
                      </span>
                    </div>
                    <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-[var(--app-text-subtle)]">
                      <span>{getDomain(item.domain).shortLabel}</span>
                      <span>·</span>
                      <span className="app-data">{item.time}</span>
                      <StatusMark value={item.availability} />
                    </div>
                  </button>
                ))}
              </div>
            </section>
            <section>
              <div className="mb-2 flex items-center justify-between gap-3">
                <h3 className="text-sm font-medium text-[var(--app-text-strong)]">
                  需要研究者判断
                </h3>
                <span className="app-data text-xs text-[var(--app-text-subtle)]">
                  {needsReview.length}
                </span>
              </div>
              <div className="divide-y divide-[var(--app-border-soft)] border-y border-[var(--app-border-soft)]">
                {needsReview.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => props.onSelect(item.id)}
                    className={`block w-full px-3 py-3 text-left transition-colors ${item.id === props.selectedId ? "bg-[var(--app-selection)]" : "hover:bg-[var(--app-bg-raised)]"}`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <span className="min-w-0 text-sm font-medium leading-5 text-[var(--app-text-strong)]">
                        {item.title}
                      </span>
                      <StatusMark value={item.availability} />
                    </div>
                    <p className="mt-2 line-clamp-2 text-xs leading-5 text-[var(--app-text-muted)]">
                      {item.summary}
                    </p>
                  </button>
                ))}
              </div>
            </section>
          </div>
          {selectedItem ? (
            <div className="mt-5 border-t border-[var(--app-border-soft)] pt-5 lg:hidden">
              <ItemDetail
                item={selectedItem}
                pinned={props.isPinned(selectedItem.id)}
                onTogglePin={() => props.togglePin(selectedItem.id)}
                onClose={() => props.onSelect(null)}
              />
            </div>
          ) : null}
        </div>
        {selectedItem ? (
          <div className="hidden lg:col-start-3 lg:row-start-1 lg:block">
            <ItemDetail
              item={selectedItem}
              pinned={props.isPinned(selectedItem.id)}
              onTogglePin={() => props.togglePin(selectedItem.id)}
              onClose={() => props.onSelect(null)}
            />
          </div>
        ) : null}
      </div>
    </div>
  );
}

function VariantC(props: VariantProps) {
  const phaseItems = props.visibleItems;
  const selectedItem = props.selectedItem;
  const grouped = DOMAINS.map((domain) => ({
    domain,
    items: phaseItems.filter((item) => item.domain === domain.id),
  })).filter((group) => group.items.length);
  return (
    <div className="border border-[var(--app-border-soft)] bg-[var(--app-bg-inset)]">
      <div className="border-b border-[var(--app-border-soft)] px-5 py-4">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold text-[var(--app-text-strong)]">
              今日简报流
            </h2>
            <p className="mt-1 text-sm text-[var(--app-text-muted)]">
              按时间阅读，按信息域回看，不把个性化内容混进市场基线。
            </p>
          </div>
          <div className="flex items-center gap-2 border border-[var(--app-border-soft)] px-3 py-2 text-xs text-[var(--app-text-muted)]">
            <Search className="h-3.5 w-3.5" />
            <span>搜索 mock 内容</span>
          </div>
        </div>
        <div className="mt-4">
          <PhaseTabs
            active={props.activePhase}
            onChange={props.onPhaseChange}
            counts={props.phaseCounts}
          />
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <span className="mr-1 text-xs text-[var(--app-text-subtle)]">
            信息域
          </span>
          <button
            type="button"
            onClick={() => props.onDomainChange("all")}
            className={`border px-2.5 py-1.5 text-xs ${props.activeDomain === "all" ? "border-[var(--app-brand)] text-[var(--app-text-strong)]" : "border-[var(--app-border-soft)] text-[var(--app-text-muted)]"}`}
          >
            全部
          </button>
          {DOMAINS.map((domain) => (
            <button
              key={domain.id}
              type="button"
              onClick={() => props.onDomainChange(domain.id)}
              className={`border px-2.5 py-1.5 text-xs ${props.activeDomain === domain.id ? "border-[var(--app-brand)] text-[var(--app-text-strong)]" : "border-[var(--app-border-soft)] text-[var(--app-text-muted)]"}`}
            >
              {domain.shortLabel}
            </button>
          ))}
        </div>
      </div>
      <div className="grid min-w-0 lg:grid-cols-[minmax(0,1fr)_238px]">
        <div className="min-w-0 px-5 py-5">
          <PhaseHeader phase={props.activePhase} count={phaseItems.length} />
          <div className="mt-5 grid gap-6">
            {grouped.map(({ domain, items }) => (
              <section key={domain.id}>
                <div className="mb-2 flex items-center justify-between gap-3">
                  <div>
                    <h3 className="text-sm font-medium text-[var(--app-text-strong)]">
                      {domain.label}
                    </h3>
                    <p className="mt-1 text-xs text-[var(--app-text-subtle)]">
                      {domain.note}
                    </p>
                  </div>
                  <span className="app-data text-xs text-[var(--app-text-subtle)]">
                    {items.length}
                  </span>
                </div>
                <div className="divide-y divide-[var(--app-border-soft)] border-y border-[var(--app-border-soft)]">
                  {items.map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => props.onSelect(item.id)}
                      className={`grid w-full gap-3 px-3 py-4 text-left transition-colors sm:grid-cols-[78px_minmax(0,1fr)_92px] ${item.id === props.selectedId ? "bg-[var(--app-selection)]" : "hover:bg-[var(--app-bg-raised)]"}`}
                    >
                      <span className="app-data text-xs text-[var(--app-text-subtle)]">
                        {item.time}
                      </span>
                      <span className="min-w-0">
                        <span className="block text-sm font-medium leading-6 text-[var(--app-text-strong)]">
                          {item.title}
                        </span>
                        <span className="mt-1 block text-sm leading-6 text-[var(--app-text-muted)]">
                          {item.summary}
                        </span>
                        <span className="mt-2 block text-xs text-[var(--app-text-subtle)]">
                          {item.source}
                        </span>
                      </span>
                      <span className="flex items-start justify-start sm:justify-end">
                        <StatusMark value={item.availability} />
                      </span>
                    </button>
                  ))}
                </div>
              </section>
            ))}
          </div>
        </div>
        <aside className="border-t border-[var(--app-border-soft)] bg-[var(--app-bg-raised)] p-5 lg:border-l lg:border-t-0">
          <div className="flex items-center gap-2 text-sm font-medium text-[var(--app-text-strong)]">
            <CalendarDays className="h-4 w-4 text-[var(--app-brand)]" />
            下一步
          </div>
          <div className="mt-4 grid gap-4">
            <div className="border-l-2 border-[var(--app-brand)] pl-3">
              <div className="text-xs text-[var(--app-text-subtle)]">
                研究雷达
              </div>
              <div className="mt-1 text-sm leading-6 text-[var(--app-text-muted)]">
                {props.pinnedItems.size
                  ? `已保存 ${props.pinnedItems.size} 条，等待你进入研究。`
                  : "从简报中保存一条信息，建立第一条研究线索。"}
              </div>
            </div>
            <div className="border-l-2 border-[var(--app-info)] pl-3">
              <div className="text-xs text-[var(--app-text-subtle)]">
                前瞻提醒
              </div>
              <div className="mt-1 text-sm leading-6 text-[var(--app-text-muted)]">
                下周一有 23 家公司进入披露窗口。
              </div>
            </div>
            <div className="border-l-2 border-[var(--app-warning)] pl-3">
              <div className="text-xs text-[var(--app-text-subtle)]">
                数据纪律
              </div>
              <div className="mt-1 text-sm leading-6 text-[var(--app-text-muted)]">
                盘中实时数据尚未授权，不用旧快照模拟即时提醒。
              </div>
            </div>
          </div>
          <div className="mt-6 border-t border-[var(--app-border-soft)] pt-4">
            <ActionLink>查看全部研究收件箱</ActionLink>
          </div>
        </aside>
      </div>
      {selectedItem ? (
        <div className="border-t border-[var(--app-border-soft)] lg:hidden">
          <ItemDetail
            item={selectedItem}
            pinned={props.isPinned(selectedItem.id)}
            onTogglePin={() => props.togglePin(selectedItem.id)}
            onClose={() => props.onSelect(null)}
          />
        </div>
      ) : null}
    </div>
  );
}

type VariantProps = {
  activePhase: Phase;
  onPhaseChange: (phase: Phase) => void;
  phaseCounts: Record<Phase, number>;
  activeDomain: DomainId | "all";
  onDomainChange: (domain: DomainId | "all") => void;
  phaseItems: MarketItem[];
  visibleItems: MarketItem[];
  selectedId: string | null;
  selectedItem: MarketItem | null;
  onSelect: (id: string | null) => void;
  pinnedItems: Set<string>;
  isPinned: (id: string) => boolean;
  togglePin: (id: string) => void;
};

function parseVariant(value: string | null): Variant {
  return value === "B" || value === "C" ? value : "A";
}

export function MarketBaselinePrototype() {
  const searchParams = useSearchParams();
  const variant = parseVariant(searchParams.get("variant"));
  const [activePhase, setActivePhase] = useState<Phase>("盘前");
  const [activeDomain, setActiveDomain] = useState<DomainId | "all">("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [pinnedItems, setPinnedItems] = useState<Set<string>>(() => new Set());

  const phaseCounts = useMemo(
    () =>
      Object.fromEntries(
        PHASES.map((phase) => [
          phase.id,
          ITEMS.filter((item) => item.phase === phase.id).length,
        ]),
      ) as Record<Phase, number>,
    [],
  );
  const visibleItems = useMemo(
    () =>
      ITEMS.filter(
        (item) =>
          item.phase === activePhase &&
          (activeDomain === "all" || item.domain === activeDomain),
      ),
    [activeDomain, activePhase],
  );
  const phaseItems = useMemo(
    () => ITEMS.filter((item) => item.phase === activePhase),
    [activePhase],
  );
  const selectedItem = ITEMS.find((item) => item.id === selectedId) ?? null;

  const togglePin = useCallback((id: string) => {
    setPinnedItems((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const sharedProps: VariantProps = {
    activePhase,
    onPhaseChange: (phase) => {
      setActivePhase(phase);
      setSelectedId(null);
    },
    phaseCounts,
    activeDomain,
    onDomainChange: (domain) => {
      setActiveDomain(domain);
      setSelectedId(null);
    },
    phaseItems,
    visibleItems,
    selectedId,
    selectedItem,
    onSelect: setSelectedId,
    pinnedItems,
    isPinned: (id) => pinnedItems.has(id),
    togglePin,
  };

  return (
    <WorkspaceShell
      section="home"
      showHistory={false}
      contentWidth="wide"
      titleSize="compact"
      title="专业市场基线原型"
      description="零配置市场信息的时段化组织探索"
    >
      <PrototypeNotice />
      {variant === "A" ? <VariantA {...sharedProps} /> : null}
      {variant === "B" ? <VariantB {...sharedProps} /> : null}
      {variant === "C" ? <VariantC {...sharedProps} /> : null}
      <div className="mt-4 flex flex-wrap items-center justify-between gap-3 text-xs text-[var(--app-text-subtle)]">
        <div className="flex items-center gap-2">
          <Radio className="h-3.5 w-3.5" />
          当前方案：{VARIANT_NAMES[variant]}
        </div>
        <div>盘中数据按权限状态降级；研究雷达状态仅保存在本次原型会话。</div>
      </div>
      <PrototypeSwitcher current={variant} />
    </WorkspaceShell>
  );
}
