"use client";

import {
  Archive,
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  BellRing,
  Bookmark,
  Check,
  CheckCheck,
  ChevronDown,
  ChevronRight,
  CircleAlert,
  Clock3,
  FileClock,
  Inbox,
  Link2,
  ListFilter,
  MessageSquareText,
  MoreHorizontal,
  Newspaper,
  Search,
  ShieldCheck,
  ThumbsDown,
  ThumbsUp,
  Undo2,
  UserRoundX,
  X,
} from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  type ComponentType,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";

import styles from "~/app/research-inbox/prototype/research-inbox-prototype.module.css";

type Variant = "A" | "B" | "C";
type InboxState = "unread" | "read" | "later" | "archived";
type Feedback = "useful" | "noise" | null;
type DeliveryKind = "urgent" | "briefing" | "inbox";
type EventState = "confirmed" | "pending" | "corrected";
type Session = "盘前" | "盘中" | "盘后" | "前瞻";
type Tone = "danger" | "warning" | "success" | "neutral" | "info";

type Evidence = {
  id: string;
  source: string;
  sourceType: string;
  excerpt: string;
  publishedAt: string;
  qualification: string;
  href: string;
};

type Revision = {
  id: string;
  at: string;
  label: string;
  summary: string;
};

type InboxItem = {
  id: string;
  session: Session;
  delivery: DeliveryKind;
  eventState: EventState;
  time: string;
  relativeTime: string;
  subject: string;
  subjectCode?: string;
  title: string;
  thesis: string;
  impact: string;
  nextCheck: string;
  whyHere: string;
  aiLabel: string;
  scores: {
    importance: string;
    confidence: string;
    relevance: string;
    novelty: string;
  };
  uncertainty: string;
  evidence: Evidence[];
  revisions: Revision[];
  related: string[];
  externalCopy: string;
};

type ItemViewState = {
  status: InboxState;
  feedback: Feedback;
};

type PrototypeState = {
  items: Record<string, ItemViewState>;
  selectedId: string;
  unfollowedSubjects: string[];
  lastAction: string;
};

type InboxActions = {
  select: (id: string) => void;
  setStatus: (id: string, status: InboxState) => void;
  setFeedback: (id: string, feedback: Feedback) => void;
  unfollow: (subject: string) => void;
  followAgain: (subject: string) => void;
  markAllRead: () => void;
};

const variants: Array<{ key: Variant; name: string }> = [
  { key: "A", name: "分拣台" },
  { key: "B", name: "时段简报" },
  { key: "C", name: "证据工作簿" },
];

const inboxItems: InboxItem[] = [
  {
    id: "evt-catl-plant",
    session: "盘中",
    delivery: "urgent",
    eventState: "confirmed",
    time: "10:42",
    relativeTime: "18 分钟前",
    subject: "宁德时代",
    subjectCode: "300750.SZ",
    title: "欧洲工厂量产节点调整，客户验证周期延后",
    thesis:
      "公司公告将欧洲新工厂的首批量产节点由三季度调整至四季度。延期本身不改变长期产能假设，但会推迟海外收入确认并抬高今年下半年的执行风险。",
    impact:
      "削弱“海外产能在三季度形成收入增量”的短期验证条件；对长期欧洲本地化逻辑影响有限。",
    nextCheck: "下一次经营交流中确认客户验证完成率与四季度爬坡曲线。",
    whyHere: "直接命中你明确关注的公司“宁德时代”和研究假设“欧洲本地产能兑现”。",
    aiLabel: "AI 生成研究解释 · 仅依据下列证据",
    scores: {
      importance: "高",
      confidence: "高",
      relevance: "极高",
      novelty: "高",
    },
    uncertainty: "公告未披露延期对应的具体收入金额；客户验证完成率仍未知。",
    evidence: [
      {
        id: "EV-1042-A",
        source: "宁德时代临时公告",
        sourceType: "公司公告 · 直接一手",
        excerpt: "首批量产时间预计由第三季度调整至第四季度。",
        publishedAt: "2026-08-02 10:31",
        qualification: "有资格证明项目进度；不能单独证明财务影响幅度。",
        href: "#evidence-EV-1042-A",
      },
      {
        id: "EV-1042-B",
        source: "深交所信息披露页面",
        sourceType: "交易所转载 · 同一事实链",
        excerpt: "公告文件签章与公司披露版本一致。",
        publishedAt: "2026-08-02 10:34",
        qualification: "用于确认披露身份，不构成第二个独立事实来源。",
        href: "#evidence-EV-1042-B",
      },
    ],
    revisions: [
      {
        id: "R2 · 当前",
        at: "10:42",
        label: "补充影响边界",
        summary: "明确延期影响短期收入确认，不外推为长期产能取消。",
      },
      {
        id: "R1",
        at: "10:36",
        label: "首次生成",
        summary: "根据公司公告形成研究事件。",
      },
    ],
    related: ["欧洲本地产能兑现", "海外收入增量", "动力电池竞争格局"],
    externalCopy: "飞书提醒副本已发送 · 10:43 · 可关闭",
  },
  {
    id: "evt-grid-capex",
    session: "盘前",
    delivery: "briefing",
    eventState: "confirmed",
    time: "08:12",
    relativeTime: "2 小时前",
    subject: "电网设备",
    title: "两项特高压设备招标规模高于上一轮",
    thesis:
      "本轮组合电器与换流阀招标数量较上一可比轮次增加，验证电网设备景气仍在兑现。当前证据只支持行业订单景气，不能直接推导单家公司份额。",
    impact:
      "强化“主网投资向核心设备传导”的行业判断，但尚不足以改变公司层面的盈利预测。",
    nextCheck: "跟踪中标公告，确认订单在头部供应商之间的实际分布。",
    whyHere: "命中你明确关注的行业“电网设备”，未命中具体公司研究假设。",
    aiLabel: "AI 生成研究解释 · 仅依据下列证据",
    scores: {
      importance: "中",
      confidence: "高",
      relevance: "高",
      novelty: "中",
    },
    uncertainty:
      "招标数量不等同于合同金额；部分标包的技术规格与上一轮不可直接比较。",
    evidence: [
      {
        id: "EV-0812-A",
        source: "国家电网电子商务平台",
        sourceType: "招标文件 · 直接一手",
        excerpt: "本批次组合电器与换流阀标包数量及规格清单。",
        publishedAt: "2026-08-02 07:20",
        qualification: "有资格证明本轮招标范围与数量。",
        href: "#evidence-EV-0812-A",
      },
      {
        id: "EV-0812-B",
        source: "历史招标规范化观测",
        sourceType: "系统数据观测 · 可重放",
        excerpt: "上一可比批次的同口径标包数量。",
        publishedAt: "数据截止 2026-06-18",
        qualification: "用于同口径比较；未覆盖合同价格。",
        href: "#evidence-EV-0812-B",
      },
    ],
    revisions: [
      {
        id: "R1 · 当前",
        at: "08:12",
        label: "首次生成",
        summary: "比较本轮与上一可比轮次招标清单。",
      },
    ],
    related: ["主网投资", "特高压设备", "招标兑现"],
    externalCopy: "包含于 08:15 盘前简报副本",
  },
  {
    id: "evt-wind-correction",
    session: "盘中",
    delivery: "inbox",
    eventState: "corrected",
    time: "09:56",
    relativeTime: "1 小时前",
    subject: "海上风电",
    title: "更正：沿海项目核准规模应为 6.4GW",
    thesis:
      "地方主管部门更正附件后，系统将此前记录的 8.0GW 下调为 6.4GW。方向仍是新增核准，但规模低于初始披露，原先基于 8.0GW 的增量判断已失效。",
    impact:
      "下调区域装机增量预期；此前基于错误规模生成的历史内容保留并醒目标记已更正。",
    nextCheck: "核对项目清单中 1.6GW 重复统计项是否在后续规划中另行出现。",
    whyHere: "命中你关注的主题“海上风电供给链”，作为权威记录保留修订通知。",
    aiLabel: "AI 生成研究解释 · 当前修订替代旧版本",
    scores: {
      importance: "中",
      confidence: "极高",
      relevance: "高",
      novelty: "极高",
    },
    uncertainty: "尚不确定被删除项目是否只是延后核准，而非完全取消。",
    evidence: [
      {
        id: "EV-0956-A",
        source: "省能源局更正附件",
        sourceType: "主管部门文件 · 直接一手",
        excerpt: "更正后项目清单合计核准规模为 6.4GW。",
        publishedAt: "2026-08-02 09:44",
        qualification: "有资格证明更正后的项目清单与规模。",
        href: "#evidence-EV-0956-A",
      },
      {
        id: "EV-0956-B",
        source: "原始附件修订 R1",
        sourceType: "历史来源快照 · 已被替代",
        excerpt: "原附件合计 8.0GW，其中一项被重复计入。",
        publishedAt: "2026-08-01 17:36",
        qualification: "仅用于解释修订差异，不再作为当前事实依据。",
        href: "#evidence-EV-0956-B",
      },
    ],
    revisions: [
      {
        id: "R2 · 当前",
        at: "09:56",
        label: "事实更正",
        summary: "以主管部门更正附件将核准规模由 8.0GW 调整为 6.4GW。",
      },
      {
        id: "R1 · 已替代",
        at: "昨天 18:02",
        label: "首次生成",
        summary: "按原始附件记录 8.0GW，现已失效。",
      },
    ],
    related: ["海上风电供给链", "沿海省份核准", "装机节奏"],
    externalCopy: "未发送外部副本 · 仅站内修订记录",
  },
  {
    id: "evt-solar-glass",
    session: "盘后",
    delivery: "briefing",
    eventState: "confirmed",
    time: "18:24",
    relativeTime: "昨天",
    subject: "光伏玻璃",
    title: "库存去化延续，但价格尚未形成明确拐点",
    thesis:
      "行业库存天数连续第二周下降，主流报价保持稳定。数据支持供需压力边际缓解，但两周样本不足以确认价格周期反转。",
    impact: "弱化“库存继续快速累积”的风险判断，尚不支持上调盈利假设。",
    nextCheck: "等待第三周库存与企业开工率数据，检验去化是否由供给收缩驱动。",
    whyHere:
      "行为信号显示你近期多次查看光伏材料，但未形成明确研究偏好，相关性最高只能为中。",
    aiLabel: "AI 生成研究解释 · 行为信号仅辅助排序",
    scores: {
      importance: "中",
      confidence: "中",
      relevance: "中",
      novelty: "中",
    },
    uncertainty:
      "样本窗口短；行业报价来源覆盖范围有限；尚不能区分需求改善与主动减产。",
    evidence: [
      {
        id: "EV-1824-A",
        source: "行业库存周度观测",
        sourceType: "规范化数据观测 · 降级",
        excerpt: "样本企业库存天数连续两周下降。",
        publishedAt: "数据截止 2026-08-01",
        qualification: "可证明样本内库存变化，不能代表全部产能。",
        href: "#evidence-EV-1824-A",
      },
      {
        id: "EV-1824-B",
        source: "主流规格报价观测",
        sourceType: "规范化数据观测 · 正常",
        excerpt: "3.2mm 镀膜玻璃主流报价周环比持平。",
        publishedAt: "数据截止 2026-08-01",
        qualification: "可证明报价稳定，不等同于实际成交均价。",
        href: "#evidence-EV-1824-B",
      },
    ],
    revisions: [
      {
        id: "R1 · 当前",
        at: "昨天 18:24",
        label: "首次生成",
        summary: "基于周度库存与报价观测形成谨慎结论。",
      },
    ],
    related: ["光伏材料", "库存周期", "供给收缩"],
    externalCopy: "包含于昨天 18:30 盘后简报副本",
  },
  {
    id: "candidate-lithium",
    session: "前瞻",
    delivery: "urgent",
    eventState: "pending",
    time: "16:08",
    relativeTime: "昨天",
    subject: "锂资源",
    title: "待核实：两处盐湖检修窗口可能重叠",
    thesis:
      "一家运营主体确认检修计划，另一处盐湖只出现地方排产口径变化。若两处窗口重叠，短期供给扰动可能高于市场认知；当前不能确认第二处检修已经成立。",
    impact: "这是潜在供给扰动，不得作为已经发生的减产事件使用。",
    nextCheck: "等待第二家运营主体公告，或由有资格证明排产安排的来源交叉印证。",
    whyHere:
      "直接命中你明确关注的主题“锂供给出清”；因置信度仅为中，提醒中必须标记待核实。",
    aiLabel: "AI 生成待核实解释 · 不代表事件已成立",
    scores: {
      importance: "高",
      confidence: "中",
      relevance: "高",
      novelty: "高",
    },
    uncertainty: "第二处盐湖的来源只能证明排产口径变化，不能证明检修决定。",
    evidence: [
      {
        id: "EV-1608-A",
        source: "盐湖 A 运营主体公告",
        sourceType: "公司公告 · 直接一手",
        excerpt: "计划于八月中旬进行为期七天的设备检修。",
        publishedAt: "2026-08-01 15:42",
        qualification: "有资格证明盐湖 A 检修计划。",
        href: "#evidence-EV-1608-A",
      },
      {
        id: "EV-1608-B",
        source: "地方月度排产表",
        sourceType: "主管部门数据 · 间接",
        excerpt: "盐湖 B 当月计划产量较上月下调。",
        publishedAt: "2026-08-01 15:18",
        qualification: "可证明排产口径变化，不能证明下调原因为检修。",
        href: "#evidence-EV-1608-B",
      },
    ],
    revisions: [
      {
        id: "C1 · 当前",
        at: "昨天 16:08",
        label: "暂缓候选",
        summary: "一项事实成立，第二项检修事实等待核实。",
      },
    ],
    related: ["锂供给出清", "盐湖产量", "检修窗口"],
    externalCopy: "飞书待核实提醒副本已发送 · 昨天 16:09",
  },
  {
    id: "evt-broker-it",
    session: "前瞻",
    delivery: "inbox",
    eventState: "confirmed",
    time: "14:20",
    relativeTime: "周五",
    subject: "证券 IT",
    title: "监管征求意见进入尾声，暂未出现新的实质条款",
    thesis:
      "征求意见窗口即将结束，但目前公开材料没有新增实质约束。该条目用于维持前瞻观察，不应被包装为政策催化。",
    impact: "不改变现有行业判断；保留下一次正式文件发布的跟踪入口。",
    nextCheck: "正式文件发布时比较条款差异与执行时间。",
    whyHere: "命中你收藏的主题“金融信创”，但当前信息增量低，仅进入站内。",
    aiLabel: "AI 生成研究解释 · 无主动提醒",
    scores: {
      importance: "低",
      confidence: "高",
      relevance: "高",
      novelty: "低",
    },
    uncertainty: "最终条款及生效时间尚未公布。",
    evidence: [
      {
        id: "EV-1420-A",
        source: "监管机构征求意见页面",
        sourceType: "监管页面 · 直接一手",
        excerpt: "意见反馈截止日期与当前公开附件。",
        publishedAt: "页面核验 2026-08-01 14:02",
        qualification: "可证明征求意见状态，不能预判最终条款。",
        href: "#evidence-EV-1420-A",
      },
    ],
    revisions: [
      {
        id: "R1 · 当前",
        at: "周五 14:20",
        label: "首次生成",
        summary: "记录征求意见窗口状态，没有外推政策方向。",
      },
    ],
    related: ["金融信创", "券商核心系统", "监管节奏"],
    externalCopy: "未发送外部副本 · 仅站内记录",
  },
];

const initialItemState: Record<string, ItemViewState> = {
  "evt-catl-plant": { status: "unread", feedback: null },
  "evt-grid-capex": { status: "unread", feedback: null },
  "evt-wind-correction": { status: "unread", feedback: null },
  "evt-solar-glass": { status: "read", feedback: "useful" },
  "candidate-lithium": { status: "later", feedback: null },
  "evt-broker-it": { status: "archived", feedback: "noise" },
};

function getItemViewState(
  items: Record<string, ItemViewState>,
  id: string,
): ItemViewState {
  return (
    items[id] ?? initialItemState[id] ?? { status: "unread", feedback: null }
  );
}

function cx(...values: Array<string | false | null | undefined>) {
  return values.filter(Boolean).join(" ");
}

function deliveryLabel(kind: DeliveryKind) {
  if (kind === "urgent") return "紧急提醒";
  if (kind === "briefing") return "定时简报";
  return "仅站内";
}

function eventLabel(state: EventState) {
  if (state === "pending") return "待核实";
  if (state === "corrected") return "已更正";
  return "已确认";
}

function statusLabel(status: InboxState) {
  if (status === "unread") return "未读";
  if (status === "read") return "已读";
  if (status === "later") return "稍后";
  return "归档";
}

function StatusText(props: { children: ReactNode; tone?: Tone }) {
  return (
    <span className={styles.statusText} data-tone={props.tone ?? "neutral"}>
      {props.children}
    </span>
  );
}

function IconButton(props: {
  label: string;
  children: ReactNode;
  onClick?: () => void;
  active?: boolean;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      className={styles.iconButton}
      aria-label={props.label}
      title={props.label}
      data-active={props.active || undefined}
      disabled={props.disabled}
      onClick={props.onClick}
    >
      {props.children}
    </button>
  );
}

function InboxToolbar(props: {
  item: InboxItem;
  itemState: ItemViewState;
  actions: InboxActions;
  compact?: boolean;
}) {
  const { item, itemState, actions } = props;
  const isUnfollowed = false;

  return (
    <div
      className={cx(styles.actionRow, props.compact && styles.actionRowCompact)}
    >
      <button
        type="button"
        className={styles.textButton}
        onClick={() =>
          actions.setStatus(
            item.id,
            itemState.status === "read" ? "unread" : "read",
          )
        }
      >
        {itemState.status === "read" ? (
          <Undo2 size={15} />
        ) : (
          <Check size={15} />
        )}
        {itemState.status === "read" ? "标为未读" : "已读"}
      </button>
      <button
        type="button"
        className={styles.textButton}
        data-active={itemState.status === "later" || undefined}
        onClick={() =>
          actions.setStatus(
            item.id,
            itemState.status === "later" ? "unread" : "later",
          )
        }
      >
        <Bookmark size={15} />
        稍后
      </button>
      <button
        type="button"
        className={styles.textButton}
        data-active={itemState.status === "archived" || undefined}
        onClick={() =>
          actions.setStatus(
            item.id,
            itemState.status === "archived" ? "unread" : "archived",
          )
        }
      >
        <Archive size={15} />
        {itemState.status === "archived" ? "移出归档" : "归档"}
      </button>
      {!props.compact ? (
        <span className={styles.actionDivider} aria-hidden="true" />
      ) : null}
      <button
        type="button"
        className={styles.textButton}
        data-active={itemState.feedback === "useful" || undefined}
        onClick={() =>
          actions.setFeedback(
            item.id,
            itemState.feedback === "useful" ? null : "useful",
          )
        }
      >
        <ThumbsUp size={15} />
        有用
      </button>
      <button
        type="button"
        className={styles.textButton}
        data-active={itemState.feedback === "noise" || undefined}
        onClick={() =>
          actions.setFeedback(
            item.id,
            itemState.feedback === "noise" ? null : "noise",
          )
        }
      >
        <ThumbsDown size={15} />
        噪声
      </button>
      {!isUnfollowed ? (
        <button
          type="button"
          className={styles.textButton}
          onClick={() => actions.unfollow(item.subject)}
        >
          <UserRoundX size={15} />
          不再关注
        </button>
      ) : null}
    </div>
  );
}

function ScoreStrip(props: { item: InboxItem; compact?: boolean }) {
  const entries = [
    ["重要性", props.item.scores.importance],
    ["置信度", props.item.scores.confidence],
    ["相关性", props.item.scores.relevance],
    ["信息增量", props.item.scores.novelty],
  ];

  return (
    <dl
      className={cx(
        styles.scoreStrip,
        props.compact && styles.scoreStripCompact,
      )}
    >
      {entries.map(([label, value]) => (
        <div key={label}>
          <dt>{label}</dt>
          <dd>{value}</dd>
        </div>
      ))}
    </dl>
  );
}

function EvidenceList(props: { item: InboxItem; dense?: boolean }) {
  return (
    <div className={styles.evidenceList}>
      {props.item.evidence.map((evidence, index) => (
        <article
          className={cx(
            styles.evidenceItem,
            props.dense && styles.evidenceItemDense,
          )}
          id={`evidence-${evidence.id}`}
          key={evidence.id}
        >
          <div className={styles.evidenceIndex}>{index + 1}</div>
          <div>
            <div className={styles.evidenceHeading}>
              <strong>{evidence.source}</strong>
              <StatusText tone={index === 0 ? "success" : "neutral"}>
                {evidence.sourceType}
              </StatusText>
            </div>
            <blockquote>{evidence.excerpt}</blockquote>
            <p>{evidence.qualification}</p>
            <div className={styles.evidenceMeta}>
              <span>{evidence.id}</span>
              <span>{evidence.publishedAt}</span>
              <a href={evidence.href}>
                来源记录 <Link2 size={12} />
              </a>
            </div>
          </div>
        </article>
      ))}
    </div>
  );
}

function RevisionList(props: { item: InboxItem }) {
  return (
    <div className={styles.revisionList}>
      {props.item.revisions.map((revision, index) => (
        <div className={styles.revisionItem} key={revision.id}>
          <div className={styles.revisionRail}>
            <span data-current={index === 0 || undefined} />
          </div>
          <div>
            <div className={styles.revisionHeading}>
              <strong>{revision.id}</strong>
              <span>{revision.at}</span>
            </div>
            <p>{revision.label}</p>
            <small>{revision.summary}</small>
          </div>
        </div>
      ))}
    </div>
  );
}

function SourceExplanation(props: { item: InboxItem }) {
  return (
    <div className={styles.sourceExplanation}>
      <ShieldCheck size={17} />
      <div>
        <strong>为什么这些来源足够</strong>
        <p>
          {props.item.evidence[0]?.qualification}
          {props.item.evidence.length > 1
            ? ` 第二项来源用于${props.item.evidence[1]?.qualification}`
            : " 当前只有一项直接来源。"}
        </p>
      </div>
    </div>
  );
}

function StateInspector(props: { state: PrototypeState }) {
  const [open, setOpen] = useState(false);

  return (
    <aside className={styles.stateInspector} data-open={open || undefined}>
      <button type="button" onClick={() => setOpen((value) => !value)}>
        <span>原型状态</span>
        {open ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
      </button>
      {open ? (
        <div className={styles.stateBody}>
          <div>
            <span>当前条目</span>
            <strong>{props.state.selectedId}</strong>
          </div>
          <div>
            <span>最后动作</span>
            <strong>{props.state.lastAction}</strong>
          </div>
          <div>
            <span>已取消关注</span>
            <strong>{props.state.unfollowedSubjects.join("、") || "无"}</strong>
          </div>
          <pre>{JSON.stringify(props.state.items, null, 2)}</pre>
        </div>
      ) : null}
    </aside>
  );
}

function PrototypeChrome(props: {
  current: "inbox" | "briefing" | "evidence";
  children: ReactNode;
  right?: ReactNode;
}) {
  return (
    <div className={styles.prototypeChrome}>
      <header className={styles.productHeader}>
        <a className={styles.wordmark} href="#top">
          AlphaFlow
        </a>
        <nav aria-label="原型主导航">
          <a href="#overview">概览</a>
          <a
            href="#inbox"
            aria-current={props.current === "inbox" ? "page" : undefined}
          >
            研究收件箱
          </a>
          <a href="#research">研究工作台</a>
          <a href="#targets">投研收藏</a>
        </nav>
        <div className={styles.headerRight}>
          <span className={styles.mockLabel}>模拟数据</span>
          {props.right}
          <button type="button" className={styles.avatar} aria-label="账号菜单">
            林
          </button>
        </div>
      </header>
      {props.children}
    </div>
  );
}

function VariantA(props: { state: PrototypeState; actions: InboxActions }) {
  const { state, actions } = props;
  const [filter, setFilter] = useState<"active" | InboxState>("active");
  const [query, setQuery] = useState("");
  const selected =
    inboxItems.find((item) => item.id === state.selectedId) ?? inboxItems[0];
  if (!selected) return null;
  const selectedState = getItemViewState(state.items, selected.id);
  const filteredItems = inboxItems.filter((item) => {
    const itemState = state.items[item.id];
    const matchesFilter =
      filter === "active"
        ? itemState?.status !== "archived"
        : itemState?.status === filter;
    const normalizedQuery = query.trim().toLowerCase();
    return (
      matchesFilter &&
      (!normalizedQuery ||
        `${item.subject}${item.title}`.toLowerCase().includes(normalizedQuery))
    );
  });
  const unreadCount = Object.values(state.items).filter(
    (item) => item.status === "unread",
  ).length;

  return (
    <PrototypeChrome
      current="inbox"
      right={
        <button
          type="button"
          className={styles.headerBell}
          aria-label="紧急提醒"
        >
          <BellRing size={17} />
          <span>1</span>
        </button>
      }
    >
      <main className={styles.triageLayout} id="inbox">
        <aside className={styles.triageSidebar}>
          <div className={styles.sidebarTitle}>
            <div>
              <h1>研究收件箱</h1>
              <p>权威记录 · 外部渠道仅提醒</p>
            </div>
            <IconButton label="筛选">
              <ListFilter size={17} />
            </IconButton>
          </div>
          <div className={styles.searchBox}>
            <Search size={16} />
            <input
              value={query}
              aria-label="搜索研究收件箱"
              placeholder="搜索公司、行业或事件"
              onChange={(event) => setQuery(event.target.value)}
            />
            {query ? (
              <button
                type="button"
                aria-label="清除搜索"
                onClick={() => setQuery("")}
              >
                <X size={14} />
              </button>
            ) : null}
          </div>
          <div className={styles.folderList}>
            {(
              [
                ["active", "待处理", Inbox, inboxItems.length - 1],
                ["unread", "未读", MessageSquareText, unreadCount],
                ["later", "稍后", Bookmark, 1],
                ["archived", "归档", Archive, 1],
              ] as Array<
                [
                  "active" | InboxState,
                  string,
                  ComponentType<{ size?: number }>,
                  number,
                ]
              >
            ).map(([key, label, Icon, count]) => (
              <button
                type="button"
                key={key}
                data-active={filter === key || undefined}
                onClick={() => setFilter(key)}
              >
                <Icon size={16} />
                <span>{label}</span>
                <strong>{count}</strong>
              </button>
            ))}
          </div>
          <div className={styles.sidebarSection}>
            <span>今日分发</span>
            <div>
              <b>1</b> 紧急提醒
            </div>
            <div>
              <b>3</b> 定时简报条目
            </div>
          </div>
          <button
            type="button"
            className={styles.markAllButton}
            onClick={actions.markAllRead}
          >
            <CheckCheck size={15} />
            全部标为已读
          </button>
        </aside>

        <section className={styles.messageColumn} aria-label="研究条目列表">
          <div className={styles.listHeader}>
            <span>{filteredItems.length} 条记录</span>
            <button type="button">
              按分发时间 <ChevronDown size={14} />
            </button>
          </div>
          <div className={styles.messageList}>
            {filteredItems.map((item) => {
              const itemState = state.items[item.id];
              const isSelected = item.id === selected.id;
              return (
                <button
                  type="button"
                  className={styles.messageRow}
                  data-selected={isSelected || undefined}
                  data-unread={itemState?.status === "unread" || undefined}
                  key={item.id}
                  onClick={() => actions.select(item.id)}
                >
                  <h2>{item.title}</h2>
                  <p>{item.impact}</p>
                  <span className={styles.messageImportance}>
                    重要性 {item.scores.importance}
                  </span>
                </button>
              );
            })}
          </div>
        </section>

        <article className={styles.readerColumn}>
          <div className={styles.readerHeader}>
            <div className={styles.readerMeta}>
              <strong>{selected.subject}</strong>
              {selected.subjectCode ? (
                <span>{selected.subjectCode}</span>
              ) : null}
              <span>{eventLabel(selected.eventState)}</span>
              <span>{deliveryLabel(selected.delivery)}</span>
              <span>{selected.time}</span>
            </div>
            <h1>{selected.title}</h1>
            <p className={styles.readerAssessment}>
              重要性 {selected.scores.importance} · 置信度{" "}
              {selected.scores.confidence} · 相关性 {selected.scores.relevance}{" "}
              · 信息增量 {selected.scores.novelty}
            </p>
          </div>
          <InboxToolbar
            item={selected}
            itemState={selectedState}
            actions={actions}
          />
          {state.unfollowedSubjects.includes(selected.subject) ? (
            <div className={styles.unfollowNotice}>
              <UserRoundX size={17} />
              <span>
                已取消关注“{selected.subject}”，后续不再用于个性化相关性。
              </span>
              <button
                type="button"
                onClick={() => actions.followAgain(selected.subject)}
              >
                撤销
              </button>
            </div>
          ) : null}
          <div className={styles.readerBody}>
            <section className={styles.readerNarrative}>
              <p>{selected.thesis}</p>
              <p>
                <strong>对研究判断的影响：</strong>
                {selected.impact} {selected.whyHere}
              </p>
              <p>
                <strong>后续观察：</strong>
                {selected.nextCheck}
              </p>
              <p>
                <strong>仍需留意：</strong>
                {selected.uncertainty}
              </p>
            </section>
            <div className={styles.readerAppendix}>
              <details>
                <summary>证据与来源（{selected.evidence.length}）</summary>
                <EvidenceList item={selected} />
                <SourceExplanation item={selected} />
              </details>
              <details>
                <summary>修订记录（{selected.revisions.length}）</summary>
                <p className={styles.revisionNote}>历史内容不会被覆盖。</p>
                <RevisionList item={selected} />
              </details>
            </div>
            <footer className={styles.readerFooter}>
              <span>{selected.aiLabel}</span>
              <span>{selected.externalCopy}</span>
            </footer>
          </div>
        </article>
      </main>
    </PrototypeChrome>
  );
}

function BriefingItem(props: {
  item: InboxItem;
  itemState: ItemViewState;
  open: boolean;
  state: PrototypeState;
  actions: InboxActions;
}) {
  const { item, itemState, open, state, actions } = props;

  return (
    <article
      className={styles.briefingItem}
      data-open={open || undefined}
      data-unread={itemState.status === "unread" || undefined}
    >
      <button
        type="button"
        className={styles.briefingSummary}
        onClick={() => actions.select(item.id)}
      >
        <div className={styles.briefingTime}>
          <strong>{item.time}</strong>
          <span>{item.session}</span>
        </div>
        <div className={styles.briefingMark} data-kind={item.delivery}>
          {item.eventState === "pending" ? (
            <CircleAlert size={16} />
          ) : item.eventState === "corrected" ? (
            <FileClock size={16} />
          ) : item.delivery === "urgent" ? (
            <BellRing size={16} />
          ) : (
            <Newspaper size={16} />
          )}
        </div>
        <div className={styles.briefingCopy}>
          <div>
            <strong>{item.subject}</strong>
            <StatusText
              tone={
                item.eventState === "pending"
                  ? "warning"
                  : item.delivery === "urgent"
                    ? "danger"
                    : item.eventState === "corrected"
                      ? "warning"
                      : "neutral"
              }
            >
              {item.eventState === "pending"
                ? "待核实"
                : item.eventState === "corrected"
                  ? "已更正"
                  : deliveryLabel(item.delivery)}
            </StatusText>
          </div>
          <h2>{item.title}</h2>
          <p>{item.impact}</p>
        </div>
        <div className={styles.briefingScore}>
          <span>重要性</span>
          <strong>{item.scores.importance}</strong>
          {open ? <ChevronDown size={17} /> : <ChevronRight size={17} />}
        </div>
      </button>
      {open ? (
        <div className={styles.briefingDetail}>
          <div className={styles.briefingNarrative}>
            <p>{item.thesis}</p>
            <div>
              <h3>下一验证项</h3>
              <p>{item.nextCheck}</p>
            </div>
            <div>
              <h3>不确定性</h3>
              <p>{item.uncertainty}</p>
            </div>
          </div>
          <aside className={styles.briefingAside}>
            <ScoreStrip item={item} compact />
            <div className={styles.briefingWhy}>
              <strong>与你的关系</strong>
              <p>{item.whyHere}</p>
            </div>
            <details>
              <summary>查看 {item.evidence.length} 项证据</summary>
              <EvidenceList item={item} dense />
              <SourceExplanation item={item} />
            </details>
          </aside>
          <div className={styles.briefingActions}>
            <InboxToolbar
              item={item}
              itemState={itemState}
              actions={actions}
              compact
            />
            {state.unfollowedSubjects.includes(item.subject) ? (
              <button
                type="button"
                onClick={() => actions.followAgain(item.subject)}
              >
                已取消关注“{item.subject}” · 撤销
              </button>
            ) : null}
          </div>
        </div>
      ) : null}
    </article>
  );
}

function VariantB(props: { state: PrototypeState; actions: InboxActions }) {
  const { state, actions } = props;
  const [session, setSession] = useState<Session | "全部">("全部");
  const activeItems = inboxItems.filter((item) => {
    const itemState = state.items[item.id];
    return (
      itemState?.status !== "archived" &&
      (session === "全部" || item.session === session)
    );
  });
  const groupedItems = (["盘前", "盘中", "盘后", "前瞻"] as Session[])
    .map((key) => ({
      key,
      items: activeItems.filter((item) => item.session === key),
    }))
    .filter((group) => group.items.length > 0);

  return (
    <PrototypeChrome current="briefing">
      <main className={styles.briefingPage}>
        <header className={styles.briefingHeader}>
          <div>
            <h1>8 月 2 日，周日</h1>
            <p>6 项研究变化 · 2 项需要今天处理 · 数据截止 10:42</p>
          </div>
          <div className={styles.briefingHeaderActions}>
            <button type="button" onClick={actions.markAllRead}>
              <CheckCheck size={16} /> 全部已读
            </button>
            <button type="button">
              <MoreHorizontal size={18} />
            </button>
          </div>
        </header>

        <div
          className={styles.sessionRail}
          role="tablist"
          aria-label="交易时段"
        >
          {(["全部", "盘前", "盘中", "盘后", "前瞻"] as const).map((key) => {
            const count =
              key === "全部"
                ? activeItems.length
                : activeItems.filter((item) => item.session === key).length;
            return (
              <button
                type="button"
                role="tab"
                aria-selected={session === key}
                key={key}
                onClick={() => setSession(key)}
              >
                <span>{key}</span>
                <strong>{count}</strong>
              </button>
            );
          })}
        </div>

        <section className={styles.dayNotice}>
          <Clock3 size={18} />
          <div>
            <strong>下一份定时简报：盘后 18:30</strong>
            <p>
              紧急提醒会在满足门控后即时写入这里；飞书只收到可关闭的提醒副本。
            </p>
          </div>
        </section>

        <div className={styles.briefingTimeline}>
          {groupedItems.map((group) => (
            <section className={styles.briefingGroup} key={group.key}>
              <div className={styles.groupLabel}>
                <span>{group.key}</span>
                <small>{group.items.length} 项</small>
              </div>
              <div className={styles.groupItems}>
                {group.items.map((item) => (
                  <BriefingItem
                    key={item.id}
                    item={item}
                    itemState={getItemViewState(state.items, item.id)}
                    open={state.selectedId === item.id}
                    state={state}
                    actions={actions}
                  />
                ))}
              </div>
            </section>
          ))}
        </div>
      </main>
    </PrototypeChrome>
  );
}

function LedgerCell(props: { label: string; value: string }) {
  return (
    <div className={styles.ledgerScoreCell}>
      <span>{props.label}</span>
      <strong>{props.value}</strong>
    </div>
  );
}

function VariantC(props: { state: PrototypeState; actions: InboxActions }) {
  const { state, actions } = props;
  const [tab, setTab] = useState<"evidence" | "revisions" | "delivery">(
    "evidence",
  );
  const selected =
    inboxItems.find((item) => item.id === state.selectedId) ?? inboxItems[0];
  if (!selected) return null;
  const selectedState = getItemViewState(state.items, selected.id);

  return (
    <PrototypeChrome current="evidence">
      <main className={styles.ledgerPage}>
        <header className={styles.ledgerHeader}>
          <div>
            <h1>研究记录</h1>
            <p>按事件、证据和修订查阅，不按通知渠道拆散。</p>
          </div>
          <div className={styles.ledgerHeaderTools}>
            <label>
              <Search size={15} />
              <input
                aria-label="筛选研究记录"
                placeholder="筛选主题或证据 ID"
              />
            </label>
            <button type="button">
              <ArrowDown size={15} /> 导出当前视图
            </button>
          </div>
        </header>

        <section className={styles.ledgerTable} aria-label="研究记录表">
          <div className={styles.ledgerTableHead}>
            <span>状态 / 时间</span>
            <span>研究事件</span>
            <span>分发依据</span>
            <span>阅读状态</span>
          </div>
          {inboxItems.map((item) => {
            const itemState = state.items[item.id];
            return (
              <button
                type="button"
                className={styles.ledgerRow}
                data-selected={state.selectedId === item.id || undefined}
                key={item.id}
                onClick={() => actions.select(item.id)}
              >
                <span className={styles.ledgerStateCell}>
                  <StatusText
                    tone={
                      item.eventState === "pending"
                        ? "warning"
                        : item.eventState === "corrected"
                          ? "warning"
                          : "success"
                    }
                  >
                    {eventLabel(item.eventState)}
                  </StatusText>
                  <time>{item.relativeTime}</time>
                </span>
                <span className={styles.ledgerEventCell}>
                  <strong>{item.title}</strong>
                  <small>
                    {item.subject} · {item.evidence.length} 项证据 ·{" "}
                    {item.revisions.length} 个修订
                  </small>
                </span>
                <span className={styles.ledgerScores}>
                  <LedgerCell label="重要" value={item.scores.importance} />
                  <LedgerCell label="置信" value={item.scores.confidence} />
                  <LedgerCell label="相关" value={item.scores.relevance} />
                  <LedgerCell label="增量" value={item.scores.novelty} />
                </span>
                <span className={styles.ledgerReadCell}>
                  {statusLabel(itemState?.status ?? "unread")}
                  <ChevronRight size={16} />
                </span>
              </button>
            );
          })}
        </section>

        <article className={styles.dossier}>
          <header className={styles.dossierHeader}>
            <div className={styles.dossierIdentity}>
              <span>{selected.id}</span>
              <StatusText
                tone={
                  selected.eventState === "confirmed" ? "success" : "warning"
                }
              >
                {eventLabel(selected.eventState)}
              </StatusText>
              <StatusText
                tone={selected.delivery === "urgent" ? "danger" : "neutral"}
              >
                {deliveryLabel(selected.delivery)}
              </StatusText>
            </div>
            <h2>{selected.title}</h2>
            <p>
              {selected.subject}
              {selected.subjectCode ? ` · ${selected.subjectCode}` : ""} ·
              最新修订 {selected.revisions[0]?.id}
            </p>
          </header>

          <div className={styles.dossierGrid}>
            <section className={styles.dossierMain}>
              <div className={styles.claimBlock}>
                <span>当前有效研究解释</span>
                <p>{selected.thesis}</p>
              </div>
              <div className={styles.impactMatrix}>
                <div>
                  <span>影响</span>
                  <p>{selected.impact}</p>
                </div>
                <div>
                  <span>下一验证项</span>
                  <p>{selected.nextCheck}</p>
                </div>
                <div>
                  <span>不确定性</span>
                  <p>{selected.uncertainty}</p>
                </div>
              </div>
            </section>
            <aside className={styles.dossierAside}>
              <ScoreStrip item={selected} />
              <div className={styles.dossierWhy}>
                <strong>相关性解释</strong>
                <p>{selected.whyHere}</p>
              </div>
              <InboxToolbar
                item={selected}
                itemState={selectedState}
                actions={actions}
                compact
              />
              {state.unfollowedSubjects.includes(selected.subject) ? (
                <button
                  type="button"
                  className={styles.restoreFollow}
                  onClick={() => actions.followAgain(selected.subject)}
                >
                  已取消关注“{selected.subject}” · 撤销
                </button>
              ) : null}
            </aside>
          </div>

          <div
            className={styles.dossierTabs}
            role="tablist"
            aria-label="研究记录详情"
          >
            {(
              [
                ["evidence", `证据 ${selected.evidence.length}`],
                ["revisions", `修订 ${selected.revisions.length}`],
                ["delivery", "生成与分发"],
              ] as const
            ).map(([key, label]) => (
              <button
                type="button"
                role="tab"
                aria-selected={tab === key}
                key={key}
                onClick={() => setTab(key)}
              >
                {label}
              </button>
            ))}
          </div>
          <div className={styles.dossierTabBody}>
            {tab === "evidence" ? (
              <>
                <EvidenceList item={selected} />
                <SourceExplanation item={selected} />
              </>
            ) : null}
            {tab === "revisions" ? <RevisionList item={selected} /> : null}
            {tab === "delivery" ? (
              <div className={styles.deliveryLog}>
                <div>
                  <span>生成标识</span>
                  <strong>{selected.aiLabel}</strong>
                </div>
                <div>
                  <span>当前站内记录</span>
                  <strong>
                    {deliveryLabel(selected.delivery)} · {selected.time}
                  </strong>
                </div>
                <div>
                  <span>外部副本</span>
                  <strong>{selected.externalCopy}</strong>
                </div>
                <div>
                  <span>分发原则</span>
                  <strong>
                    同一次门控只记录最高渠道，外部副本不替代站内记录。
                  </strong>
                </div>
              </div>
            ) : null}
          </div>
        </article>
      </main>
    </PrototypeChrome>
  );
}

function PrototypeSwitcher(props: { current: Variant }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const selectVariant = useCallback(
    (next: Variant) => {
      const params = new URLSearchParams(searchParams.toString());
      params.set("variant", next);
      router.replace(`${pathname}?${params.toString()}`, { scroll: false });
    },
    [pathname, router, searchParams],
  );

  const cycle = useCallback(
    (direction: -1 | 1) => {
      const currentIndex = variants.findIndex(
        (variant) => variant.key === props.current,
      );
      const nextIndex =
        (currentIndex + direction + variants.length) % variants.length;
      const next = variants[nextIndex];
      if (next) selectVariant(next.key);
    },
    [props.current, selectVariant],
  );

  useEffect(() => {
    function onKeyDown(event: globalThis.KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      if (
        target?.matches("input, textarea, select, [contenteditable='true']") ||
        (event.key !== "ArrowLeft" && event.key !== "ArrowRight")
      ) {
        return;
      }
      event.preventDefault();
      cycle(event.key === "ArrowLeft" ? -1 : 1);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [cycle]);

  if (process.env.NODE_ENV === "production") return null;
  const current =
    variants.find((variant) => variant.key === props.current) ?? variants[0];

  return (
    <nav className={styles.prototypeSwitcher} aria-label="原型方案切换器">
      <button type="button" aria-label="上一个方案" onClick={() => cycle(-1)}>
        <ArrowLeft size={17} />
      </button>
      <div>
        <span>方案 {current?.key}</span>
        <strong>{current?.name}</strong>
      </div>
      <button type="button" aria-label="下一个方案" onClick={() => cycle(1)}>
        <ArrowRight size={17} />
      </button>
    </nav>
  );
}

export function ResearchInboxPrototype() {
  const searchParams = useSearchParams();
  const rawVariant = searchParams.get("variant")?.toUpperCase();
  const variant: Variant =
    rawVariant === "B" || rawVariant === "C" ? rawVariant : "A";
  const [state, setState] = useState<PrototypeState>({
    items: initialItemState,
    selectedId: inboxItems[0]?.id ?? "",
    unfollowedSubjects: [],
    lastAction: "原型已载入",
  });

  const actions = useMemo<InboxActions>(
    () => ({
      select(id) {
        const item = inboxItems.find((candidate) => candidate.id === id);
        setState((current) => ({
          ...current,
          selectedId: id,
          items: {
            ...current.items,
            [id]: {
              ...(current.items[id] ?? { feedback: null }),
              status:
                current.items[id]?.status === "unread"
                  ? "read"
                  : (current.items[id]?.status ?? "read"),
            },
          },
          lastAction: `打开“${item?.title ?? id}”`,
        }));
      },
      setStatus(id, status) {
        const item = inboxItems.find((candidate) => candidate.id === id);
        setState((current) => ({
          ...current,
          items: {
            ...current.items,
            [id]: {
              ...(current.items[id] ?? { feedback: null }),
              status,
            },
          },
          lastAction: `将“${item?.subject ?? id}”设为${statusLabel(status)}`,
        }));
      },
      setFeedback(id, feedback) {
        const item = inboxItems.find((candidate) => candidate.id === id);
        setState((current) => ({
          ...current,
          items: {
            ...current.items,
            [id]: {
              ...(current.items[id] ?? { status: "read" }),
              feedback,
            },
          },
          lastAction: feedback
            ? `反馈“${item?.subject ?? id}”为${feedback === "useful" ? "有用" : "噪声"}`
            : `撤销“${item?.subject ?? id}”反馈`,
        }));
      },
      unfollow(subject) {
        setState((current) => ({
          ...current,
          unfollowedSubjects: current.unfollowedSubjects.includes(subject)
            ? current.unfollowedSubjects
            : [...current.unfollowedSubjects, subject],
          lastAction: `不再关注“${subject}”`,
        }));
      },
      followAgain(subject) {
        setState((current) => ({
          ...current,
          unfollowedSubjects: current.unfollowedSubjects.filter(
            (candidate) => candidate !== subject,
          ),
          lastAction: `恢复关注“${subject}”`,
        }));
      },
      markAllRead() {
        setState((current) => ({
          ...current,
          items: Object.fromEntries(
            Object.entries(current.items).map(([id, item]) => [
              id,
              item.status === "unread"
                ? { ...item, status: "read" as const }
                : item,
            ]),
          ),
          lastAction: "全部标为已读",
        }));
      },
    }),
    [],
  );

  return (
    <div className={styles.prototypeRoot} data-variant={variant}>
      {variant === "A" ? <VariantA state={state} actions={actions} /> : null}
      {variant === "B" ? <VariantB state={state} actions={actions} /> : null}
      {variant === "C" ? <VariantC state={state} actions={actions} /> : null}
      <StateInspector state={state} />
      <PrototypeSwitcher current={variant} />
    </div>
  );
}
