"use client";

import { Copy, MessageSquare, Plus, Save, Trash2, Undo2 } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { InlineNotice, WorkspaceShell } from "~/app/_components/ui";
import { isScoringDraftReadyForAutosave } from "~/app/scheduled-tasks/builder/scoring-task-autosave";
import { SCHEDULED_TASK_WORKBENCH_SECTIONS } from "~/server/domain/scheduled-task/workbench-release-gate";
import { api } from "~/trpc/react";

type Timeframe = "daily" | "weekly" | "monthly";
type Operator =
  | "gt"
  | "gte"
  | "lt"
  | "lte"
  | "eq"
  | "ne"
  | "between"
  | "cross_above"
  | "cross_below";
type AtomicCondition = {
  timeframe: Timeframe;
  metric: string;
  operator: Operator;
  value: string | number | [number, number];
};
type Condition =
  | AtomicCondition
  | { all: Condition[] }
  | { any: Condition[] }
  | { not: Condition };
type Rule = { id: string; name: string; points: number; condition: Condition };

type Draft = {
  name: string;
  schedule: {
    type: "DAILY" | "WEEKLY" | "TRADING_DAY";
    time: string;
    timezone: string;
    weekdays?: number[];
    marketCalendar?: string;
    startAt?: string;
    endAt?: string;
  };
  universe:
    | { type: "all_a_shares" }
    | { type: "stocks"; stockInputs: string[] };
  data: { adjustment: "qfq" | "hfq" | "none" };
  indicatorParams: {
    macd: { fast: number; slow: number; signal: number };
    kdj: { period: number; kSmoothing: number; dSmoothing: number };
  };
  rules: Rule[];
  selection: { minScore: number; limit: number };
  output: {
    type: "SCORING_REPORT";
    feishuSummaryLimit: number;
    sendOnEmpty: boolean;
  };
  delivery:
    | { type: "SAVE_ONLY" }
    | {
        type: "FEISHU";
        targetRef?: string;
        webhookUrl?: string;
        maskedWebhook?: string;
      };
};

const metricOptions = [
  ["close", "收盘价"],
  ["open", "开盘价"],
  ["high", "最高价"],
  ["low", "最低价"],
  ["volume", "成交量"],
  ["candle.direction", "K 线方向"],
  ["macd.dif", "MACD DIF"],
  ["macd.dea", "MACD DEA"],
  ["macd.histogram", "MACD 柱"],
  ["kdj.k", "KDJ K"],
  ["kdj.d", "KDJ D"],
  ["kdj.j", "KDJ J"],
] as const;
const operatorOptions = [
  ["gt", "大于"],
  ["gte", "大于等于"],
  ["lt", "小于"],
  ["lte", "小于等于"],
  ["eq", "等于"],
  ["ne", "不等于"],
  ["between", "介于"],
  ["cross_above", "向上穿越"],
  ["cross_below", "向下穿越"],
] as const;
const schedulePresets = {
  TRADING_DAY_CLOSE: {
    type: "TRADING_DAY" as const,
    time: "18:00",
    marketCalendar: "SSE",
  },
  DAILY_MORNING: {
    type: "DAILY" as const,
    time: "08:30",
    marketCalendar: undefined,
  },
  WEEKLY: {
    type: "WEEKLY" as const,
    time: "18:00",
    weekdays: [5],
    marketCalendar: undefined,
  },
};

function atomicCondition(): AtomicCondition {
  return { timeframe: "daily", metric: "close", operator: "gt", value: 0 };
}

function ruleId() {
  return `rule_${crypto.randomUUID().replaceAll("-", "").slice(0, 12)}`;
}

const initialDraft: Draft = {
  name: "",
  schedule: {
    type: "TRADING_DAY",
    time: "18:00",
    timezone: "Asia/Shanghai",
    marketCalendar: "SSE",
  },
  universe: { type: "all_a_shares" },
  data: { adjustment: "qfq" },
  indicatorParams: {
    macd: { fast: 12, slow: 26, signal: 9 },
    kdj: { period: 9, kSmoothing: 3, dSmoothing: 3 },
  },
  rules: [{ id: "rule_1", name: "", points: 10, condition: atomicCondition() }],
  selection: { minScore: 0, limit: 100 },
  output: { type: "SCORING_REPORT", feishuSummaryLimit: 20, sendOnEmpty: true },
  delivery: { type: "SAVE_ONLY" },
};

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function leafStatuses(value: unknown): string[] {
  const node = asRecord(value);
  if (node.kind === "LEAF")
    return [
      `${String(node.timeframe)}.${String(node.metric)}: ${String(node.status)}`,
    ];
  return Array.isArray(node.children)
    ? node.children.flatMap(leafStatuses)
    : [];
}

function inputClass() {
  return "h-10 w-full border border-[var(--app-border)] bg-[var(--app-surface)] px-3 !py-0 text-sm leading-5 text-[var(--app-text-strong)] outline-none focus:border-[var(--app-accent-strong)]";
}

function AgentSendIcon(props: { className?: string }) {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="none"
      aria-hidden="true"
      className={props.className}
    >
      <path
        d="M10 15V5m0 0 4 4m-4-4L6 9"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function NumberField(props: {
  label: string;
  value: number;
  min?: number;
  onChange: (value: number) => void;
}) {
  return (
    <label className="grid gap-1 text-sm text-[var(--app-text-muted)]">
      <span>{props.label}</span>
      <input
        className={inputClass()}
        type="number"
        min={props.min}
        value={props.value}
        onChange={(event) => props.onChange(Number(event.target.value))}
      />
    </label>
  );
}

function ConditionEditor(props: {
  value: Condition;
  path: string;
  onChange: (value: Condition) => void;
  onRemove?: () => void;
}) {
  const value = props.value;
  const kind =
    "all" in value
      ? "all"
      : "any" in value
        ? "any"
        : "not" in value
          ? "not"
          : "atomic";
  const changeKind = (next: string) => {
    if (next === "all") props.onChange({ all: [atomicCondition()] });
    else if (next === "any") props.onChange({ any: [atomicCondition()] });
    else if (next === "not") props.onChange({ not: atomicCondition() });
    else props.onChange(atomicCondition());
  };
  return (
    <div className="border-l-2 border-[var(--app-border)] pl-3">
      <div className="flex items-center gap-2">
        <select
          aria-label={`${props.path} 条件类型`}
          className={`${inputClass()} max-w-36`}
          value={kind}
          onChange={(event) => changeKind(event.target.value)}
        >
          <option value="atomic">单项比较</option>
          <option value="all">全部满足</option>
          <option value="any">任一满足</option>
          <option value="not">条件取反</option>
        </select>
        {props.onRemove ? (
          <button
            type="button"
            className="app-button app-button-icon"
            title="移除条件"
            onClick={props.onRemove}
          >
            <Trash2 size={15} />
          </button>
        ) : null}
      </div>
      {kind === "atomic" ? (
        (() => {
          const atomic = value as AtomicCondition;
          const direction = atomic.metric === "candle.direction";
          const between = atomic.operator === "between";
          return (
            <div className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
              <select
                aria-label="行情周期"
                className={inputClass()}
                value={atomic.timeframe}
                onChange={(event) =>
                  props.onChange({
                    ...atomic,
                    timeframe: event.target.value as Timeframe,
                  })
                }
              >
                <option value="daily">日线</option>
                <option value="weekly">周线</option>
                <option value="monthly">月线</option>
              </select>
              <select
                aria-label="指标"
                className={inputClass()}
                value={atomic.metric}
                onChange={(event) =>
                  props.onChange({
                    ...atomic,
                    metric: event.target.value,
                    operator:
                      event.target.value === "candle.direction"
                        ? "eq"
                        : atomic.operator,
                    value:
                      event.target.value === "candle.direction" ? "bullish" : 0,
                  })
                }
              >
                {metricOptions.map(([key, label]) => (
                  <option key={key} value={key}>
                    {label}
                  </option>
                ))}
              </select>
              <select
                aria-label="操作符"
                className={inputClass()}
                value={atomic.operator}
                onChange={(event) => {
                  const operator = event.target.value as Operator;
                  props.onChange({
                    ...atomic,
                    operator,
                    value: operator === "between" ? [0, 100] : atomic.value,
                  });
                }}
              >
                {operatorOptions
                  .filter(([key]) => !direction || key === "eq" || key === "ne")
                  .map(([key, label]) => (
                    <option key={key} value={key}>
                      {label}
                    </option>
                  ))}
              </select>
              {direction ? (
                <select
                  aria-label="比较值"
                  className={inputClass()}
                  value={String(atomic.value)}
                  onChange={(event) =>
                    props.onChange({ ...atomic, value: event.target.value })
                  }
                >
                  <option value="bullish">阳线</option>
                  <option value="bearish">阴线</option>
                  <option value="doji">十字线</option>
                </select>
              ) : between ? (
                <div className="grid grid-cols-2 gap-2">
                  <input
                    aria-label="下限"
                    className={inputClass()}
                    type="number"
                    value={Array.isArray(atomic.value) ? atomic.value[0] : 0}
                    onChange={(event) =>
                      props.onChange({
                        ...atomic,
                        value: [
                          Number(event.target.value),
                          Array.isArray(atomic.value) ? atomic.value[1] : 0,
                        ],
                      })
                    }
                  />
                  <input
                    aria-label="上限"
                    className={inputClass()}
                    type="number"
                    value={Array.isArray(atomic.value) ? atomic.value[1] : 0}
                    onChange={(event) =>
                      props.onChange({
                        ...atomic,
                        value: [
                          Array.isArray(atomic.value) ? atomic.value[0] : 0,
                          Number(event.target.value),
                        ],
                      })
                    }
                  />
                </div>
              ) : (
                <input
                  aria-label="比较值"
                  className={inputClass()}
                  type="number"
                  value={typeof atomic.value === "number" ? atomic.value : 0}
                  onChange={(event) =>
                    props.onChange({
                      ...atomic,
                      value: Number(event.target.value),
                    })
                  }
                />
              )}
            </div>
          );
        })()
      ) : kind === "not" ? (
        <div className="mt-3">
          <ConditionEditor
            value={(value as { not: Condition }).not}
            path={`${props.path}.not`}
            onChange={(condition) => props.onChange({ not: condition })}
          />
        </div>
      ) : (
        (() => {
          const key = kind as "all" | "any";
          const children =
            (value as { all?: Condition[]; any?: Condition[] })[key] ?? [];
          return (
            <div className="mt-3 grid gap-3">
              {children.map((condition, index) => (
                <ConditionEditor
                  key={`${props.path}-${index}`}
                  value={condition}
                  path={`${props.path}.${key}.${index}`}
                  onChange={(next) =>
                    props.onChange({
                      [key]: children.map((item, childIndex) =>
                        childIndex === index ? next : item,
                      ),
                    } as Condition)
                  }
                  onRemove={
                    children.length > 1
                      ? () =>
                          props.onChange({
                            [key]: children.filter(
                              (_, childIndex) => childIndex !== index,
                            ),
                          } as Condition)
                      : undefined
                  }
                />
              ))}
              <button
                type="button"
                className="app-button w-fit"
                onClick={() =>
                  props.onChange({
                    [key]: [...children, atomicCondition()],
                  } as Condition)
                }
              >
                <Plus size={15} />
                添加条件
              </button>
            </div>
          );
        })()
      )}
    </div>
  );
}

function draftFromConfig(payload: {
  name: string;
  config: unknown;
  deliveryCredential?: {
    credentialRef: string;
    maskedWebhook: string;
  } | null;
}): Draft {
  const config = asRecord(payload.config);
  const plan = asRecord(config.executionPlan);
  const schedule = asRecord(config.scheduleSpec) as Draft["schedule"];
  const output = asRecord(config.outputSpec) as Draft["output"];
  const deliverySpec = asRecord(config.deliverySpec);
  const delivery: Draft["delivery"] =
    deliverySpec.type === "FEISHU"
      ? {
          type: "FEISHU",
          targetRef:
            payload.deliveryCredential?.credentialRef ??
            String(deliverySpec.targetRef ?? ""),
          maskedWebhook: payload.deliveryCredential?.maskedWebhook,
        }
      : { type: "SAVE_ONLY" };
  const universe = asRecord(plan.universe);
  const indicators = Array.isArray(plan.indicators)
    ? plan.indicators.map(asRecord)
    : [];
  const macd = indicators.find((item) => item.type === "macd");
  const kdj = indicators.find((item) => item.type === "kdj");
  const stockCodes = Array.isArray(universe.stockCodes)
    ? universe.stockCodes.map(String)
    : [];
  return {
    ...initialDraft,
    name: payload.name,
    schedule,
    universe:
      universe.type === "stocks"
        ? { type: "stocks", stockInputs: stockCodes }
        : { type: "all_a_shares" },
    data: asRecord(plan.data) as Draft["data"],
    indicatorParams: {
      macd: { ...initialDraft.indicatorParams.macd, ...asRecord(macd?.params) },
      kdj: { ...initialDraft.indicatorParams.kdj, ...asRecord(kdj?.params) },
    } as Draft["indicatorParams"],
    rules: Array.isArray(plan.rules)
      ? (plan.rules as Rule[])
      : initialDraft.rules,
    selection: {
      ...initialDraft.selection,
      ...asRecord(plan.selection),
    } as Draft["selection"],
    output,
    delivery,
  };
}

export function ScoringTaskBuilder() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const initialTaskId = searchParams.get("taskId") ?? undefined;
  const [taskId, setTaskId] = useState(initialTaskId);
  const [version, setVersion] = useState<number | undefined>();
  const [draft, setDraft] = useState<Draft>(initialDraft);
  const [dirty, setDirty] = useState(false);
  const [issues, setIssues] = useState<
    Array<{ path: string; message: string }>
  >([]);
  const [lastSavedAt, setLastSavedAt] = useState<Date | null>(null);
  const [stockSearchKeyword, setStockSearchKeyword] = useState("");
  const [previewSampleInput, setPreviewSampleInput] = useState("");
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [mobilePane, setMobilePane] = useState<"builder" | "agent">("builder");
  const [agentPrompt, setAgentPrompt] = useState("");
  const [agentConversationId, setAgentConversationId] = useState<string | null>(
    null,
  );
  const [agentConflict, setAgentConflict] = useState(false);
  const [agentMarkers, setAgentMarkers] = useState<
    Array<{ type: string; ruleId?: string; field?: string }>
  >([]);
  const [removedRule, setRemovedRule] = useState<{
    rule: Rule;
    index: number;
  } | null>(null);
  const revisionRef = useRef(0);
  const hydratedRef = useRef(false);
  const retryTimerRef = useRef<number | null>(null);
  const draftQuery = api.scheduledTask.getScoringDraft.useQuery(
    { taskId: initialTaskId ?? "" },
    { enabled: Boolean(initialTaskId) },
  );
  const saveMutation = api.scheduledTask.saveScoringDraft.useMutation();
  const previewMutation = api.scheduledTask.startScoringPreview.useMutation();
  const activateMutation = api.scheduledTask.activateDraft.useMutation();
  const startAgentMutation = api.scheduledTask.startAgentEdit.useMutation({
    onSuccess: (result) => setAgentConversationId(result.conversationId),
  });
  const sendAgentMutation = api.agentRuntime.sendMessage.useMutation();
  const discardAgentMutation = api.scheduledTask.discardEditDraft.useMutation();
  const agentConversation = api.agentRuntime.getConversation.useQuery(
    { conversationId: agentConversationId ?? "" },
    {
      enabled: Boolean(agentConversationId),
      refetchInterval: 1500,
    },
  );
  const agentDraftQuery = api.scheduledTask.getEditDraft.useQuery(
    { conversationId: agentConversationId ?? undefined },
    {
      enabled: Boolean(agentConversationId),
      refetchInterval: 1500,
    },
  );
  const previewQuery = api.scheduledTask.getScoringPreview.useQuery(
    { previewId: previewId ?? "" },
    {
      enabled: Boolean(previewId),
      refetchInterval: (query) =>
        ["SUCCEEDED", "FAILED", "CANCELLED"].includes(
          String(query.state.data?.status),
        )
          ? false
          : 1500,
    },
  );
  const stockSearch = api.screening.searchStocks.useQuery(
    { keyword: stockSearchKeyword, limit: 8 },
    { enabled: stockSearchKeyword.trim().length > 0 },
  );

  useEffect(() => {
    if (!draftQuery.data || hydratedRef.current) return;
    hydratedRef.current = true;
    setDraft(draftFromConfig(draftQuery.data));
    setTaskId(draftQuery.data.taskId);
    setVersion(draftQuery.data.version);
  }, [draftQuery.data]);

  useEffect(
    () => () => {
      if (retryTimerRef.current !== null)
        window.clearTimeout(retryTimerRef.current);
    },
    [],
  );

  const change = (updater: (current: Draft) => Draft) => {
    revisionRef.current += 1;
    setDraft(updater);
    setDirty(true);
  };

  const persist = async (options: { automatic?: boolean } = {}) => {
    const automatic = options.automatic === true;
    if (automatic && !isScoringDraftReadyForAutosave(draft)) return null;
    if (saveMutation.isPending) return null;
    const savingRevision = revisionRef.current;
    const result = await saveMutation.mutateAsync({
      taskId,
      expectedVersion: version,
      idempotencyKey: `builder-${crypto.randomUUID()}`,
      value: draft,
    });
    if (!result.saved) {
      if (!automatic) setIssues(result.issues);
      return null;
    }
    setIssues([]);
    setTaskId(result.taskId);
    setVersion(result.version);
    const savedDelivery = result.delivery;
    if (savedDelivery?.type === "FEISHU")
      setDraft((current) => ({
        ...current,
        delivery: {
          type: "FEISHU",
          targetRef: savedDelivery.credentialRef,
          maskedWebhook: savedDelivery.maskedWebhook,
        },
      }));
    setLastSavedAt(new Date());
    if (revisionRef.current === savingRevision) setDirty(false);
    else {
      if (retryTimerRef.current !== null)
        window.clearTimeout(retryTimerRef.current);
      retryTimerRef.current = window.setTimeout(
        () => void persistRef.current({ automatic: true }),
        800,
      );
    }
    if (!taskId)
      router.replace(`/scheduled-tasks/builder?taskId=${result.taskId}`);
    return result;
  };
  const persistRef = useRef(persist);
  persistRef.current = persist;
  useEffect(() => {
    if (!dirty || !isScoringDraftReadyForAutosave(draft)) return;
    const timer = window.setTimeout(
      () => void persistRef.current({ automatic: true }),
      800,
    );
    return () => window.clearTimeout(timer);
  }, [draft, dirty]);

  const runPreview = async () => {
    const saved = dirty || !taskId || !version ? await persist() : null;
    const activeTaskId = saved?.taskId ?? taskId;
    const activeVersion = saved?.version ?? version;
    if (!activeTaskId || !activeVersion) return;
    const sampleStockCodes = previewSampleInput
      .split(/[\s,，]+/)
      .map((item) => item.trim())
      .filter(Boolean);
    const result = await previewMutation.mutateAsync({
      taskId: activeTaskId,
      expectedVersion: activeVersion,
      sampleStockCodes:
        draft.universe.type === "all_a_shares" ? sampleStockCodes : undefined,
      idempotencyKey: `preview-${crypto.randomUUID()}`,
    });
    setPreviewId(result.previewId);
  };

  const activate = async () => {
    if (!taskId || !version || !previewId) return;
    await activateMutation.mutateAsync({
      taskId,
      expectedVersion: version,
      previewId,
    });
    router.push(`/scheduled-tasks/${taskId}`);
  };

  const sendAgentPrompt = async () => {
    const prompt = agentPrompt.trim();
    if (!prompt || !taskId) return;
    if (!agentConversationId) {
      await startAgentMutation.mutateAsync({ taskId, prompt });
    } else {
      await sendAgentMutation.mutateAsync({
        conversationId: agentConversationId,
        prompt,
      });
    }
    setAgentPrompt("");
  };

  const applyAgentDraft = (overwrite = false) => {
    const proposal = agentDraftQuery.data;
    if (!proposal || !version) return;
    if (proposal.baseVersion !== version && !overwrite) {
      setAgentConflict(true);
      return;
    }
    const proposed = draftFromConfig({
      name: proposal.name,
      config: {
        executionPlan: proposal.executionPlan,
        scheduleSpec: proposal.scheduleSpec,
        outputSpec: proposal.outputSpec,
        deliverySpec: proposal.deliverySpec,
      },
      deliveryCredential:
        draft.delivery.type === "FEISHU" && draft.delivery.targetRef
          ? {
              credentialRef: draft.delivery.targetRef,
              maskedWebhook: draft.delivery.maskedWebhook ?? "",
            }
          : null,
    });
    revisionRef.current += 1;
    setDraft({ ...proposed, delivery: draft.delivery });
    setDirty(true);
    setAgentConflict(false);
    setAgentMarkers(
      Array.isArray(proposal.changes)
        ? proposal.changes.map((item) => asRecord(item) as never)
        : [],
    );
  };

  const discardAgentDraft = async () => {
    const proposal = agentDraftQuery.data;
    if (!proposal) return;
    await discardAgentMutation.mutateAsync({ draftId: proposal.id });
    setAgentConflict(false);
    await agentDraftQuery.refetch();
  };

  const removeRule = (index: number) =>
    change((current) => {
      if (current.rules.length === 1) return current;
      setRemovedRule({ rule: current.rules[index] as Rule, index });
      return {
        ...current,
        rules: current.rules.filter((_, ruleIndex) => ruleIndex !== index),
      };
    });
  const undoRemove = () => {
    if (!removedRule) return;
    change((current) => ({
      ...current,
      rules: [
        ...current.rules.slice(0, removedRule.index),
        removedRule.rule,
        ...current.rules.slice(removedRule.index),
      ],
    }));
    setRemovedRule(null);
  };

  const status = saveMutation.isPending
    ? "正在保存"
    : dirty
      ? "有未保存修改"
      : lastSavedAt
        ? `已保存 ${lastSavedAt.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })}`
        : taskId
          ? "草稿已载入"
          : "新草稿";
  return (
    <WorkspaceShell
      section="scheduledTasks"
      title="评分规则构建器"
      description=""
      titleSize="compact"
      showHistory={false}
      actions={
        <div className="flex items-center gap-2">
          <output className="text-sm text-[var(--app-text-subtle)]">
            {status}
          </output>
          <button
            type="button"
            className="app-button app-button-primary"
            disabled={saveMutation.isPending}
            onClick={() => void persist()}
          >
            <Save size={16} />
            保存
          </button>
        </div>
      }
    >
      {draftQuery.error ? (
        <InlineNotice tone="danger" description={draftQuery.error.message} />
      ) : null}
      {saveMutation.error ? (
        <InlineNotice tone="danger" description={saveMutation.error.message} />
      ) : null}
      {issues.length ? (
        <InlineNotice
          tone="danger"
          description={issues
            .map((item) => `${item.path}: ${item.message}`)
            .join("；")}
        />
      ) : null}

      <div className="grid grid-cols-2 border-b border-[var(--app-border-soft)] lg:hidden">
        <button
          type="button"
          className={`h-10 text-sm font-medium ${mobilePane === "builder" ? "border-b-2 border-[var(--app-accent-strong)] text-[var(--app-text-strong)]" : "text-[var(--app-text-muted)]"}`}
          onClick={() => setMobilePane("builder")}
        >
          构建器
        </button>
        <button
          type="button"
          className={`h-10 text-sm font-medium ${mobilePane === "agent" ? "border-b-2 border-[var(--app-accent-strong)] text-[var(--app-text-strong)]" : "text-[var(--app-text-muted)]"}`}
          onClick={() => setMobilePane("agent")}
        >
          Agent
        </button>
      </div>

      <div className="lg:grid lg:grid-cols-[minmax(0,1fr)_360px] lg:items-start">
        <aside
          aria-label="Agent 辅助"
          className={`${mobilePane === "agent" ? "flex" : "hidden"} flex-col border-b border-[var(--app-border-soft)] bg-[var(--app-panel)] lg:sticky lg:top-0 lg:order-2 lg:flex lg:h-screen lg:overflow-hidden lg:border-b-0 lg:border-l`}
        >
          <div className="flex shrink-0 items-center gap-2 border-b border-[var(--app-border-soft)] px-4 py-3 text-sm font-semibold text-[var(--app-text-strong)]">
            <MessageSquare size={16} />
            Agent 辅助
          </div>
          <div className="app-scroll min-h-0 flex-1 overflow-y-auto px-4 py-4">
            {agentConversation.data?.messages.length ? (
              <div className="grid gap-6">
                {agentConversation.data.messages.map((message) => (
                  <div
                    key={message.id}
                    className={
                      message.role === "USER"
                        ? "flex justify-end"
                        : "flex justify-start"
                    }
                  >
                    <div
                      className={
                        message.role === "USER"
                          ? "max-w-[78%] rounded-[18px] bg-[var(--app-panel-strong)] px-4 py-3 text-[var(--app-text-strong)]"
                          : "min-w-0 max-w-full text-[var(--app-text-strong)]"
                      }
                    >
                      <div className="whitespace-pre-wrap text-sm leading-6">
                        {message.content ||
                          (message.role === "ASSISTANT"
                            ? "正在准备回复"
                            : message.status)}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ) : null}
            {agentDraftQuery.data ? (
              <div className="mt-6 flex flex-wrap items-center justify-between gap-3 border-t border-[var(--app-border-soft)] pt-3">
                <div className="text-sm text-[var(--app-text-muted)]">
                  Agent 已生成版本 {agentDraftQuery.data.baseVersion}{" "}
                  的结构化变更，可继续逐条编辑后再保存整套草稿。
                </div>
                <div className="flex gap-2">
                  <button
                    type="button"
                    className="app-button"
                    onClick={() => void discardAgentDraft()}
                  >
                    丢弃 Agent 变更
                  </button>
                  <button
                    type="button"
                    className="app-button app-button-primary"
                    onClick={() => applyAgentDraft()}
                  >
                    整套应用
                  </button>
                </div>
              </div>
            ) : null}
            {agentConflict ? (
              <div className="mt-3 flex flex-wrap items-center justify-between gap-3 border-l-2 border-[var(--app-warning)] pl-3 text-sm text-[var(--app-text-muted)]">
                <span>Agent 生成后当前草稿已变化，系统不会自动合并。</span>
                <div className="flex gap-2">
                  <button
                    type="button"
                    className="app-button"
                    onClick={() => void discardAgentDraft()}
                  >
                    丢弃 Agent 变更
                  </button>
                  <button
                    type="button"
                    className="app-button app-button-primary"
                    onClick={() => applyAgentDraft(true)}
                  >
                    覆盖草稿
                  </button>
                </div>
              </div>
            ) : null}
            {agentConversationId ? (
              <Link
                className="mt-3 inline-block text-xs text-[var(--app-accent-strong)]"
                href={`/agent-runtime?conversationId=${encodeURIComponent(agentConversationId)}`}
              >
                回看完整 Agent 会话与审计
              </Link>
            ) : null}
          </div>
          <div className="shrink-0 border-t border-[var(--app-border-soft)] bg-[var(--app-panel)] p-3">
            <div className="relative rounded-[22px] border border-[var(--app-border-soft)] bg-[var(--app-panel-strong)] transition-[border-color,box-shadow,background-color] focus-within:border-[var(--app-accent-strong)] focus-within:bg-[var(--app-bg-elevated)] focus-within:shadow-[0_0_0_3px_var(--app-focus-ring)]">
              <textarea
                className="h-[93px] min-h-0 w-full resize-none overflow-y-auto rounded-[22px] border-0 bg-transparent pt-3 pr-16 pb-12 pl-4 text-sm text-[var(--app-text)] outline-none placeholder:text-[var(--app-text-soft)]"
                value={agentPrompt}
                onChange={(event) => setAgentPrompt(event.target.value)}
                placeholder="描述需要新增、修改或移除的规则"
                onKeyDown={(event) => {
                  if (
                    event.key === "Enter" &&
                    (event.metaKey || event.ctrlKey)
                  ) {
                    event.preventDefault();
                    void sendAgentPrompt();
                  }
                }}
              />
              <button
                type="button"
                aria-label="发送消息"
                title="发送"
                className="absolute right-3 bottom-3 inline-flex h-10 w-10 items-center justify-center rounded-full border border-[var(--app-primary-border)] bg-[var(--app-primary-surface)] text-[var(--app-on-primary)] transition-colors hover:bg-[var(--app-primary-surface-hover)] disabled:cursor-not-allowed disabled:border-[var(--app-border-soft)] disabled:bg-[var(--app-bg-raised)] disabled:text-[var(--app-text-soft)]"
                disabled={
                  !taskId ||
                  !agentPrompt.trim() ||
                  startAgentMutation.isPending ||
                  sendAgentMutation.isPending
                }
                onClick={() => void sendAgentPrompt()}
              >
                <AgentSendIcon className="h-5 w-5" />
              </button>
            </div>
            {!taskId ? (
              <p className="mt-2 px-1 text-xs text-[var(--app-text-subtle)]">
                先保存草稿后即可使用 Agent 辅助。
              </p>
            ) : null}
          </div>
        </aside>

        <main
          className={`${mobilePane === "builder" ? "block" : "hidden"} min-w-0 lg:order-1 lg:block`}
        >
          <nav
            aria-label="任务构建分区"
            className="sticky top-0 z-10 flex overflow-x-auto border-b border-[var(--app-border-soft)] bg-[var(--app-panel)] px-4 sm:px-6"
          >
            {SCHEDULED_TASK_WORKBENCH_SECTIONS.map((section) => (
              <a
                key={section.id}
                href={`#${section.id}`}
                className="shrink-0 px-3 py-2.5 text-sm text-[var(--app-text-muted)] hover:text-[var(--app-text-strong)]"
              >
                {section.label}
              </a>
            ))}
          </nav>

          <div
            id="task"
            className="scroll-mt-12 border-y border-[var(--app-border-soft)] bg-[var(--app-panel)] px-4 py-5 sm:px-6"
          >
            <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_220px]">
              <label className="grid gap-1 text-sm text-[var(--app-text-muted)]">
                <span>任务名称</span>
                <input
                  className={inputClass()}
                  value={draft.name}
                  onChange={(event) =>
                    change((current) => ({
                      ...current,
                      name: event.target.value,
                    }))
                  }
                  placeholder="例如：每日多周期趋势评分"
                />
              </label>
              <label className="grid gap-1 text-sm text-[var(--app-text-muted)]">
                <span>复权口径</span>
                <select
                  className={inputClass()}
                  value={draft.data.adjustment}
                  onChange={(event) =>
                    change((current) => ({
                      ...current,
                      data: {
                        adjustment: event.target
                          .value as Draft["data"]["adjustment"],
                      },
                    }))
                  }
                >
                  <option value="qfq">前复权</option>
                  <option value="hfq">后复权</option>
                  <option value="none">不复权</option>
                </select>
              </label>
            </div>
          </div>

          <section
            id="universe"
            className="scroll-mt-12 border-b border-[var(--app-border-soft)] px-4 py-5 sm:px-6"
          >
            <h2 className="text-base font-semibold text-[var(--app-text-strong)]">
              股票范围
            </h2>
            <div className="mt-3 flex gap-5 text-sm">
              <label>
                <input
                  type="radio"
                  checked={draft.universe.type === "all_a_shares"}
                  onChange={() =>
                    change((current) => ({
                      ...current,
                      universe: { type: "all_a_shares" },
                    }))
                  }
                />{" "}
                全部 A 股
              </label>
              <label>
                <input
                  type="radio"
                  checked={draft.universe.type === "stocks"}
                  onChange={() =>
                    change((current) => ({
                      ...current,
                      universe: { type: "stocks", stockInputs: [] },
                    }))
                  }
                />{" "}
                指定股票
              </label>
            </div>
            {draft.universe.type === "stocks" ? (
              <div className="mt-3 grid gap-3 lg:grid-cols-2">
                <div className="grid content-start gap-1 text-sm text-[var(--app-text-muted)]">
                  <label htmlFor="stock-search">按名称或代码搜索</label>
                  <input
                    id="stock-search"
                    className={inputClass()}
                    value={stockSearchKeyword}
                    onChange={(event) =>
                      setStockSearchKeyword(event.target.value)
                    }
                    placeholder="例如：贵州茅台"
                  />
                  {stockSearch.data?.length ? (
                    <div className="divide-y divide-[var(--app-border-soft)] border border-[var(--app-border-soft)] bg-[var(--app-panel)]">
                      {stockSearch.data.map((stock) => (
                        <button
                          key={stock.stockCode}
                          type="button"
                          className="flex w-full items-center justify-between px-3 py-2 text-left hover:bg-[var(--app-surface-quiet)]"
                          onClick={() => {
                            change((current) => {
                              const inputs =
                                current.universe.type === "stocks"
                                  ? current.universe.stockInputs
                                  : [];
                              return {
                                ...current,
                                universe: {
                                  type: "stocks",
                                  stockInputs: [
                                    ...inputs,
                                    `${stock.stockName} ${stock.stockCode}`,
                                  ],
                                },
                              };
                            });
                            setStockSearchKeyword("");
                          }}
                        >
                          <span>{stock.stockName}</span>
                          <span className="font-mono text-xs">
                            {stock.stockCode}
                          </span>
                        </button>
                      ))}
                    </div>
                  ) : null}
                </div>
                <label className="grid gap-1 text-sm text-[var(--app-text-muted)]">
                  <span>已选股票，也可每行粘贴一个代码</span>
                  <textarea
                    className="min-h-28 w-full border border-[var(--app-border)] bg-[var(--app-surface)] p-2.5 text-sm outline-none focus:border-[var(--app-accent-strong)]"
                    value={draft.universe.stockInputs.join("\n")}
                    onChange={(event) =>
                      change((current) => ({
                        ...current,
                        universe: {
                          type: "stocks",
                          stockInputs: event.target.value
                            .split(/\r?\n/)
                            .filter((item) => item.trim()),
                        },
                      }))
                    }
                    placeholder={"600519.SH\n000001"}
                  />
                </label>
              </div>
            ) : null}
          </section>

          <section
            id="rules"
            className="scroll-mt-12 border-b border-[var(--app-border-soft)] px-4 py-5 sm:px-6"
          >
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-base font-semibold text-[var(--app-text-strong)]">
                评分规则
              </h2>
              <div className="flex gap-2">
                {removedRule ? (
                  <button
                    type="button"
                    className="app-button"
                    onClick={undoRemove}
                  >
                    <Undo2 size={15} />
                    撤销移除
                  </button>
                ) : null}
                <button
                  type="button"
                  className="app-button"
                  onClick={() =>
                    change((current) => ({
                      ...current,
                      rules: [
                        ...current.rules,
                        {
                          id: ruleId(),
                          name: "",
                          points: 10,
                          condition: atomicCondition(),
                        },
                      ],
                    }))
                  }
                >
                  <Plus size={15} />
                  新增规则
                </button>
              </div>
            </div>
            <div className="mt-4 divide-y divide-[var(--app-border-soft)] border-y border-[var(--app-border-soft)]">
              {draft.rules.map((rule, index) => (
                <article key={rule.id} className="py-4">
                  {agentMarkers.find((marker) => marker.ruleId === rule.id) ? (
                    <span className="mb-2 inline-block text-xs font-medium text-[var(--app-accent-strong)]">
                      {agentMarkers.find((marker) => marker.ruleId === rule.id)
                        ?.type === "ADDED"
                        ? "Agent 新增"
                        : "Agent 修改"}
                    </span>
                  ) : null}
                  <div className="grid items-end gap-3 md:grid-cols-[minmax(180px,1fr)_120px_auto]">
                    <label className="grid gap-1 text-sm text-[var(--app-text-muted)]">
                      <span>规则名称</span>
                      <input
                        className={inputClass()}
                        value={rule.name}
                        onChange={(event) =>
                          change((current) => ({
                            ...current,
                            rules: current.rules.map((item, ruleIndex) =>
                              ruleIndex === index
                                ? { ...item, name: event.target.value }
                                : item,
                            ),
                          }))
                        }
                      />
                    </label>
                    <NumberField
                      label="分值"
                      min={0}
                      value={rule.points}
                      onChange={(points) =>
                        change((current) => ({
                          ...current,
                          rules: current.rules.map((item, ruleIndex) =>
                            ruleIndex === index ? { ...item, points } : item,
                          ),
                        }))
                      }
                    />
                    <div className="flex gap-1">
                      <button
                        type="button"
                        className="app-button app-button-icon"
                        title="复制规则"
                        onClick={() =>
                          change((current) => ({
                            ...current,
                            rules: [
                              ...current.rules.slice(0, index + 1),
                              {
                                ...structuredClone(rule),
                                id: ruleId(),
                                name: `${rule.name} 副本`,
                              },
                              ...current.rules.slice(index + 1),
                            ],
                          }))
                        }
                      >
                        <Copy size={15} />
                      </button>
                      <button
                        type="button"
                        className="app-button app-button-icon"
                        title="移除规则"
                        disabled={draft.rules.length === 1}
                        onClick={() => removeRule(index)}
                      >
                        <Trash2 size={15} />
                      </button>
                    </div>
                  </div>
                  <div className="mt-4">
                    <ConditionEditor
                      value={rule.condition}
                      path={`rules.${index}.condition`}
                      onChange={(condition) =>
                        change((current) => ({
                          ...current,
                          rules: current.rules.map((item, ruleIndex) =>
                            ruleIndex === index ? { ...item, condition } : item,
                          ),
                        }))
                      }
                    />
                  </div>
                </article>
              ))}
            </div>
          </section>

          <section className="border-b border-[var(--app-border-soft)] px-4 py-5 sm:px-6">
            <h2 className="text-base font-semibold text-[var(--app-text-strong)]">
              指标参数
            </h2>
            <div className="mt-3 grid gap-5 lg:grid-cols-2">
              <fieldset className="grid grid-cols-3 gap-3">
                <legend className="mb-2 text-sm font-medium">MACD</legend>
                {(["fast", "slow", "signal"] as const).map((key) => (
                  <NumberField
                    key={key}
                    label={key}
                    min={2}
                    value={draft.indicatorParams.macd[key]}
                    onChange={(value) =>
                      change((current) => ({
                        ...current,
                        indicatorParams: {
                          ...current.indicatorParams,
                          macd: {
                            ...current.indicatorParams.macd,
                            [key]: value,
                          },
                        },
                      }))
                    }
                  />
                ))}
              </fieldset>
              <fieldset className="grid grid-cols-3 gap-3">
                <legend className="mb-2 text-sm font-medium">KDJ</legend>
                {(["period", "kSmoothing", "dSmoothing"] as const).map(
                  (key) => (
                    <NumberField
                      key={key}
                      label={key}
                      min={1}
                      value={draft.indicatorParams.kdj[key]}
                      onChange={(value) =>
                        change((current) => ({
                          ...current,
                          indicatorParams: {
                            ...current.indicatorParams,
                            kdj: {
                              ...current.indicatorParams.kdj,
                              [key]: value,
                            },
                          },
                        }))
                      }
                    />
                  ),
                )}
              </fieldset>
            </div>
          </section>

          <section
            id="schedule"
            className="scroll-mt-12 border-b border-[var(--app-border-soft)] px-4 py-5 sm:px-6"
          >
            <h2 className="text-base font-semibold text-[var(--app-text-strong)]">
              调度
            </h2>
            <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <label className="grid gap-1 text-sm text-[var(--app-text-muted)]">
                <span>预设</span>
                <select
                  className={inputClass()}
                  onChange={(event) => {
                    const preset =
                      schedulePresets[
                        event.target.value as keyof typeof schedulePresets
                      ];
                    if (preset)
                      change((current) => ({
                        ...current,
                        schedule: {
                          ...current.schedule,
                          ...preset,
                          weekdays:
                            "weekdays" in preset ? preset.weekdays : undefined,
                        },
                      }));
                  }}
                  defaultValue="TRADING_DAY_CLOSE"
                >
                  <option value="TRADING_DAY_CLOSE">交易日收盘后</option>
                  <option value="DAILY_MORNING">每天盘前</option>
                  <option value="WEEKLY">每周五</option>
                </select>
              </label>
              <label className="grid gap-1 text-sm text-[var(--app-text-muted)]">
                <span>时间</span>
                <input
                  className={inputClass()}
                  type="time"
                  value={draft.schedule.time}
                  onChange={(event) =>
                    change((current) => ({
                      ...current,
                      schedule: {
                        ...current.schedule,
                        time: event.target.value,
                      },
                    }))
                  }
                />
              </label>
              <label className="grid gap-1 text-sm text-[var(--app-text-muted)]">
                <span>时区</span>
                <select
                  className={inputClass()}
                  value={draft.schedule.timezone}
                  onChange={(event) =>
                    change((current) => ({
                      ...current,
                      schedule: {
                        ...current.schedule,
                        timezone: event.target.value,
                      },
                    }))
                  }
                >
                  <option value="Asia/Shanghai">Asia/Shanghai</option>
                </select>
              </label>
              <label className="grid gap-1 text-sm text-[var(--app-text-muted)]">
                <span>市场日历</span>
                <select
                  className={inputClass()}
                  value={draft.schedule.marketCalendar ?? "SSE"}
                  onChange={(event) =>
                    change((current) => ({
                      ...current,
                      schedule: {
                        ...current.schedule,
                        marketCalendar: event.target.value,
                      },
                    }))
                  }
                >
                  <option value="SSE">上交所</option>
                  <option value="SZSE">深交所</option>
                </select>
              </label>
              <label className="grid gap-1 text-sm text-[var(--app-text-muted)]">
                <span>开始时间（可选）</span>
                <input
                  className={inputClass()}
                  type="datetime-local"
                  value={draft.schedule.startAt?.slice(0, 16) ?? ""}
                  onChange={(event) =>
                    change((current) => ({
                      ...current,
                      schedule: {
                        ...current.schedule,
                        startAt: event.target.value
                          ? new Date(event.target.value).toISOString()
                          : undefined,
                      },
                    }))
                  }
                />
              </label>
              <label className="grid gap-1 text-sm text-[var(--app-text-muted)]">
                <span>结束时间（可选）</span>
                <input
                  className={inputClass()}
                  type="datetime-local"
                  value={draft.schedule.endAt?.slice(0, 16) ?? ""}
                  onChange={(event) =>
                    change((current) => ({
                      ...current,
                      schedule: {
                        ...current.schedule,
                        endAt: event.target.value
                          ? new Date(event.target.value).toISOString()
                          : undefined,
                      },
                    }))
                  }
                />
              </label>
            </div>
          </section>

          <section
            id="preview"
            className="scroll-mt-12 border-t border-[var(--app-border-soft)] px-4 py-5 sm:px-6"
          >
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-base font-semibold text-[var(--app-text-strong)]">
                  评分预览
                </h2>
                <p className="mt-1 text-sm text-[var(--app-text-muted)]">
                  预览在后台运行，可继续编辑；实质修改并保存后旧预览自动失效。
                </p>
              </div>
              <div className="flex gap-2">
                <button
                  type="button"
                  className="app-button"
                  disabled={
                    previewMutation.isPending ||
                    (draft.universe.type === "all_a_shares" &&
                      previewSampleInput.trim().length === 0)
                  }
                  onClick={() => void runPreview()}
                >
                  运行预览
                </button>
                <button
                  type="button"
                  className="app-button app-button-primary"
                  disabled={
                    !previewQuery.data?.canActivate ||
                    !previewQuery.data.valid ||
                    activateMutation.isPending
                  }
                  onClick={() => void activate()}
                >
                  启用任务
                </button>
              </div>
            </div>
            {draft.universe.type === "all_a_shares" ? (
              <label className="mt-4 grid max-w-xl gap-1 text-sm text-[var(--app-text-muted)]">
                <span>全部 A 股预览样本（1 至 20 只）</span>
                <textarea
                  className="min-h-20 border border-[var(--app-border)] bg-[var(--app-surface)] p-2.5 text-sm outline-none focus:border-[var(--app-accent-strong)]"
                  value={previewSampleInput}
                  placeholder="600519 000001"
                  onChange={(event) =>
                    setPreviewSampleInput(event.target.value)
                  }
                />
              </label>
            ) : null}
            {previewMutation.error ||
            previewQuery.error ||
            activateMutation.error ? (
              <div className="mt-4">
                <InlineNotice
                  tone="danger"
                  description={
                    previewMutation.error?.message ??
                    previewQuery.error?.message ??
                    activateMutation.error?.message ??
                    "评分预览失败"
                  }
                />
              </div>
            ) : null}
            {previewQuery.data ? (
              <div className="mt-4 border-y border-[var(--app-border-soft)] py-4">
                <div className="flex flex-wrap gap-x-5 gap-y-1 text-sm text-[var(--app-text-muted)]">
                  <span>状态：{previewQuery.data.status}</span>
                  <span>版本：{previewQuery.data.taskVersion}</span>
                  <span>
                    数据截止：{previewQuery.data.dataCutoff ?? "等待执行"}
                  </span>
                  {!previewQuery.data.valid ? (
                    <span className="text-amber-700">
                      草稿已变化，此预览已失效
                    </span>
                  ) : null}
                </div>
                {previewQuery.data.warnings.length ? (
                  <ul className="mt-3 list-disc pl-5 text-sm text-amber-700">
                    {previewQuery.data.warnings.map((warning, index) => (
                      <li key={`${String(warning)}-${index}`}>
                        {String(warning)}
                      </li>
                    ))}
                  </ul>
                ) : null}
                {previewQuery.data.results.length ? (
                  <div className="mt-4 overflow-x-auto">
                    <table className="w-full min-w-[720px] text-left text-sm">
                      <thead className="text-[var(--app-text-muted)]">
                        <tr>
                          <th className="py-2 pr-4">样本股票</th>
                          <th className="py-2 pr-4">总分</th>
                          <th className="py-2 pr-4">规则得分</th>
                          <th className="py-2">叶子条件状态</th>
                        </tr>
                      </thead>
                      <tbody>
                        {previewQuery.data.results.map((result) => {
                          const ruleResults = asRecord(result.ruleResults);
                          return (
                            <tr
                              key={result.stockCode}
                              className="border-t border-[var(--app-border-soft)]"
                            >
                              <td className="py-2 pr-4">
                                {result.stockName}（{result.stockCode}）
                              </td>
                              <td className="py-2 pr-4">
                                {result.score} / {result.maxScore}
                              </td>
                              <td className="py-2 pr-4">
                                {Object.entries(ruleResults)
                                  .map(([ruleId, value]) => {
                                    const detail = asRecord(value);
                                    return `${ruleId}: ${String(detail.awardedPoints ?? 0)}`;
                                  })
                                  .join("；") || "-"}
                              </td>
                              <td className="py-2">
                                {Object.entries(ruleResults)
                                  .flatMap(([ruleId, value]) =>
                                    leafStatuses(
                                      asRecord(value).conditionTree,
                                    ).map((status) => `${ruleId} / ${status}`),
                                  )
                                  .join("；") || "-"}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                ) : null}
              </div>
            ) : null}
          </section>

          <section id="selection" className="scroll-mt-12 px-4 py-5 sm:px-6">
            <h2 className="text-base font-semibold text-[var(--app-text-strong)]">
              筛选与投递
            </h2>
            <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <NumberField
                label="最低分"
                min={0}
                value={draft.selection.minScore}
                onChange={(minScore) =>
                  change((current) => ({
                    ...current,
                    selection: { ...current.selection, minScore },
                  }))
                }
              />
              <NumberField
                label="最多结果"
                min={1}
                value={draft.selection.limit}
                onChange={(limit) =>
                  change((current) => ({
                    ...current,
                    selection: { ...current.selection, limit },
                  }))
                }
              />
              <label
                id="delivery"
                className="scroll-mt-12 grid gap-1 text-sm text-[var(--app-text-muted)]"
              >
                <span>投递方式</span>
                <select
                  className={inputClass()}
                  value={draft.delivery.type}
                  onChange={(event) =>
                    change((current) => ({
                      ...current,
                      delivery:
                        event.target.value === "FEISHU"
                          ? { type: "FEISHU", webhookUrl: "" }
                          : { type: "SAVE_ONLY" },
                    }))
                  }
                >
                  <option value="SAVE_ONLY">仅保存站内结果</option>
                  <option value="FEISHU">飞书摘要</option>
                </select>
              </label>
              {draft.delivery.type === "FEISHU" ? (
                <label className="grid gap-1 text-sm text-[var(--app-text-muted)]">
                  <span>飞书 Webhook</span>
                  <input
                    className={inputClass()}
                    type="url"
                    autoComplete="off"
                    placeholder={
                      draft.delivery.maskedWebhook ??
                      "https://open.feishu.cn/open-apis/bot/v2/hook/..."
                    }
                    value={draft.delivery.webhookUrl ?? ""}
                    onChange={(event) =>
                      change((current) => ({
                        ...current,
                        delivery: {
                          ...current.delivery,
                          type: "FEISHU",
                          webhookUrl: event.target.value,
                        },
                      }))
                    }
                  />
                </label>
              ) : null}
            </div>
            <div className="mt-5 border-t border-[var(--app-border-soft)] pt-4">
              <h3 className="text-sm font-semibold text-[var(--app-text-strong)]">
                启用摘要
              </h3>
              <dl className="mt-2 grid gap-x-5 gap-y-2 text-sm sm:grid-cols-2 xl:grid-cols-3">
                <div>
                  <dt className="text-[var(--app-text-subtle)]">任务</dt>
                  <dd className="text-[var(--app-text-strong)]">
                    {draft.name || "未命名任务"}
                  </dd>
                </div>
                <div>
                  <dt className="text-[var(--app-text-subtle)]">调度</dt>
                  <dd className="text-[var(--app-text-strong)]">
                    {draft.schedule.time} · {draft.schedule.timezone}
                  </dd>
                </div>
                <div>
                  <dt className="text-[var(--app-text-subtle)]">范围</dt>
                  <dd className="text-[var(--app-text-strong)]">
                    {draft.universe.type === "all_a_shares"
                      ? "全部 A 股"
                      : `${draft.universe.stockInputs.length} 只股票`}
                  </dd>
                </div>
                <div>
                  <dt className="text-[var(--app-text-subtle)]">评分</dt>
                  <dd className="text-[var(--app-text-strong)]">
                    {draft.rules.length} 条规则，最低 {draft.selection.minScore}{" "}
                    分
                  </dd>
                </div>
                <div>
                  <dt className="text-[var(--app-text-subtle)]">投递</dt>
                  <dd className="text-[var(--app-text-strong)]">
                    {draft.delivery.type === "FEISHU"
                      ? "站内结果与飞书摘要"
                      : "仅保存站内结果"}
                  </dd>
                </div>
                <div>
                  <dt className="text-[var(--app-text-subtle)]">保存状态</dt>
                  <dd className="text-[var(--app-text-strong)]">{status}</dd>
                </div>
              </dl>
            </div>
          </section>
          <div className="flex justify-between border-t border-[var(--app-border-soft)] px-4 py-4 sm:px-6">
            <Link className="app-button" href="/scheduled-tasks">
              返回任务列表
            </Link>
            <button
              type="button"
              className="app-button app-button-primary"
              disabled={saveMutation.isPending}
              onClick={() => void persist()}
            >
              <Save size={16} />
              保存草稿
            </button>
          </div>
        </main>
      </div>
    </WorkspaceShell>
  );
}
