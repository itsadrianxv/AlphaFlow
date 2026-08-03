"use client";

import { Copy, Plus, Save, Trash2, Undo2 } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { InlineNotice, WorkspaceShell } from "~/app/_components/ui";
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
  delivery: { type: "SAVE_ONLY" } | { type: "FEISHU"; targetRef: string };
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

function inputClass() {
  return "h-9 w-full border border-[var(--app-border)] bg-[var(--app-surface)] px-2.5 text-sm text-[var(--app-text-strong)] outline-none focus:border-[var(--app-accent-strong)]";
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

function draftFromConfig(payload: { name: string; config: unknown }): Draft {
  const config = asRecord(payload.config);
  const plan = asRecord(config.executionPlan);
  const schedule = asRecord(config.scheduleSpec) as Draft["schedule"];
  const output = asRecord(config.outputSpec) as Draft["output"];
  const delivery = asRecord(config.deliverySpec) as Draft["delivery"];
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

  const persist = async () => {
    if (saveMutation.isPending) return;
    const savingRevision = revisionRef.current;
    const result = await saveMutation.mutateAsync({
      taskId,
      expectedVersion: version,
      idempotencyKey: `builder-${crypto.randomUUID()}`,
      value: draft,
    });
    if (!result.saved) {
      setIssues(result.issues);
      return;
    }
    setIssues([]);
    setTaskId(result.taskId);
    setVersion(result.version);
    setLastSavedAt(new Date());
    if (revisionRef.current === savingRevision) setDirty(false);
    else {
      if (retryTimerRef.current !== null)
        window.clearTimeout(retryTimerRef.current);
      retryTimerRef.current = window.setTimeout(
        () => void persistRef.current(),
        800,
      );
    }
    if (!taskId)
      router.replace(`/scheduled-tasks/builder?taskId=${result.taskId}`);
  };
  const persistRef = useRef(persist);
  persistRef.current = persist;
  // biome-ignore lint/correctness/useExhaustiveDependencies: 每次草稿变更都应重新开始防抖计时。
  useEffect(() => {
    if (!dirty) return;
    const timer = window.setTimeout(() => void persistRef.current(), 800);
    return () => window.clearTimeout(timer);
  }, [draft, dirty]);

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

      <div className="border-y border-[var(--app-border-soft)] bg-[var(--app-panel)] px-4 py-5 sm:px-6">
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_220px]">
          <label className="grid gap-1 text-sm text-[var(--app-text-muted)]">
            <span>任务名称</span>
            <input
              className={inputClass()}
              value={draft.name}
              onChange={(event) =>
                change((current) => ({ ...current, name: event.target.value }))
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

      <section className="border-b border-[var(--app-border-soft)] px-4 py-5 sm:px-6">
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
                onChange={(event) => setStockSearchKeyword(event.target.value)}
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

      <section className="border-b border-[var(--app-border-soft)] px-4 py-5 sm:px-6">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-base font-semibold text-[var(--app-text-strong)]">
            评分规则
          </h2>
          <div className="flex gap-2">
            {removedRule ? (
              <button type="button" className="app-button" onClick={undoRemove}>
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
                      macd: { ...current.indicatorParams.macd, [key]: value },
                    },
                  }))
                }
              />
            ))}
          </fieldset>
          <fieldset className="grid grid-cols-3 gap-3">
            <legend className="mb-2 text-sm font-medium">KDJ</legend>
            {(["period", "kSmoothing", "dSmoothing"] as const).map((key) => (
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
                      kdj: { ...current.indicatorParams.kdj, [key]: value },
                    },
                  }))
                }
              />
            ))}
          </fieldset>
        </div>
      </section>

      <section className="border-b border-[var(--app-border-soft)] px-4 py-5 sm:px-6">
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
                  schedule: { ...current.schedule, time: event.target.value },
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

      <section className="px-4 py-5 sm:px-6">
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
          <label className="grid gap-1 text-sm text-[var(--app-text-muted)]">
            <span>投递方式</span>
            <select
              className={inputClass()}
              value={draft.delivery.type}
              onChange={(event) =>
                change((current) => ({
                  ...current,
                  delivery:
                    event.target.value === "FEISHU"
                      ? { type: "FEISHU", targetRef: "" }
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
              <span>飞书目标</span>
              <input
                className={inputClass()}
                value={draft.delivery.targetRef}
                onChange={(event) =>
                  change((current) => ({
                    ...current,
                    delivery: { type: "FEISHU", targetRef: event.target.value },
                  }))
                }
              />
            </label>
          ) : null}
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
    </WorkspaceShell>
  );
}
