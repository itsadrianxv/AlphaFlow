"use client";

import {
  ArrowLeft,
  ChevronDown,
  ChevronRight,
  Download,
  Play,
  X,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Fragment, useEffect, useRef, useState } from "react";
import { MarkdownContent } from "~/app/_components/markdown-content";
import {
  EmptyState,
  InlineNotice,
  StatusPill,
  WorkspaceShell,
} from "~/app/_components/ui";
import { api, type RouterOutputs } from "~/trpc/react";

type Detail = RouterOutputs["scheduledTask"]["getDetail"];
type EditDraft = RouterOutputs["scheduledTask"]["prepareStructuredEdit"];
type Execution =
  RouterOutputs["scheduledTask"]["listExecutions"]["items"][number];

const taskStatus = {
  ACTIVE: { label: "运行中", tone: "success" },
  PAUSED: { label: "已暂停", tone: "warning" },
  CANCELLED: { label: "已取消", tone: "neutral" },
  DRAFT: { label: "草稿", tone: "neutral" },
} as const;

const executionStatus = {
  PENDING: ["等待中", "neutral"],
  CLAIMED: ["准备中", "info"],
  SUBMITTED: ["已提交", "info"],
  RUNNING: ["执行中", "info"],
  SUCCEEDED: ["已完成", "success"],
  FAILED: ["失败", "danger"],
  RETRYING: ["重试中", "warning"],
  CANCELLED: ["已取消", "warning"],
} as const;

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function formatDate(value: Date | string | null | undefined) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(new Date(value));
}

function scheduleLabel(value: unknown) {
  const schedule = asRecord(value);
  const time = String(schedule.time ?? "--:--");
  if (schedule.type === "TRADING_DAY") return `每个交易日 ${time}`;
  if (schedule.type === "WEEKLY") {
    const names = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];
    const days = Array.isArray(schedule.weekdays)
      ? schedule.weekdays
          .map(Number)
          .map((day) => names[day])
          .filter(Boolean)
      : [];
    return `${days.join("、") || "每周"} ${time}`;
  }
  return `每天 ${time}`;
}

function durationLabel(execution: Execution) {
  if (!execution.startedAt) return "—";
  const end = execution.completedAt
    ? new Date(execution.completedAt).getTime()
    : Date.now();
  const seconds = Math.max(
    0,
    Math.round((end - new Date(execution.startedAt).getTime()) / 1000),
  );
  return seconds < 60
    ? `${seconds} 秒`
    : `${Math.floor(seconds / 60)} 分 ${seconds % 60} 秒`;
}

function displayValue(value: unknown) {
  if (typeof value === "string") return value;
  if (typeof value === "boolean") return value ? "是" : "否";
  return JSON.stringify(value, null, 2);
}

function parameterSummary(value: unknown) {
  const entries = Object.entries(asRecord(value));
  if (!entries.length) return "无额外参数";
  return entries
    .map(([key, item]) => {
      if (["string", "number", "boolean"].includes(typeof item)) {
        return `${key}=${String(item)}`;
      }
      return `${key}=已配置`;
    })
    .join(" · ");
}

function Definition(props: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-sm text-[var(--app-text-subtle)]">{props.label}</dt>
      <dd className="mt-1 text-sm leading-6 text-[var(--app-text-strong)]">
        {props.children}
      </dd>
    </div>
  );
}

function SectionTitle(props: {
  id: string;
  title: string;
  actions?: React.ReactNode;
}) {
  return (
    <div
      className="mb-5 flex scroll-mt-20 flex-wrap items-center justify-between gap-3"
      id={props.id}
    >
      <h2 className="text-lg font-semibold text-[var(--app-text-strong)]">
        {props.title}
      </h2>
      {props.actions}
    </div>
  );
}

function TrialRunDialog(props: {
  open: boolean;
  detail: Detail;
  onClose: () => void;
  onCompleted: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const completedExecutionRef = useRef("");
  const [deliver, setDeliver] = useState(false);
  const [executionId, setExecutionId] = useState("");
  const delivery = asRecord(props.detail.version.deliverySpec);
  const canDeliver =
    delivery.type === "FEISHU" && Boolean(props.detail.deliveryTarget);
  const run = api.scheduledTask.trialRun.useMutation({
    onSuccess: (result) => setExecutionId(result.executionId),
  });
  const execution = api.scheduledTask.getExecution.useQuery(
    { id: executionId },
    {
      enabled: Boolean(executionId),
      refetchInterval: (query) => {
        const status = query.state.data?.status;
        return status && ["SUCCEEDED", "FAILED", "CANCELLED"].includes(status)
          ? false
          : 2000;
      },
    },
  );
  const terminal =
    execution.data &&
    ["SUCCEEDED", "FAILED", "CANCELLED"].includes(execution.data.status);

  useEffect(() => {
    if (props.open && !ref.current?.open) ref.current?.showModal();
    if (!props.open && ref.current?.open) ref.current.close();
  }, [props.open]);

  useEffect(() => {
    if (terminal && completedExecutionRef.current !== executionId) {
      completedExecutionRef.current = executionId;
      props.onCompleted();
    }
  }, [executionId, props.onCompleted, terminal]);

  const close = () => {
    ref.current?.close();
    props.onClose();
  };

  return (
    <dialog
      ref={ref}
      className="w-[min(560px,calc(100vw-32px))] rounded-[8px] border border-[var(--app-border-soft)] bg-[var(--app-panel)] p-0 text-[var(--app-text)] shadow-[var(--app-shadow-lg)] backdrop:bg-[var(--app-overlay)]"
      onClose={props.onClose}
      onCancel={(event) => {
        event.preventDefault();
        close();
      }}
    >
      <div className="flex items-center justify-between border-b border-[var(--app-border-soft)] px-5 py-4">
        <h2 className="text-base font-semibold text-[var(--app-text-strong)]">
          试执行
        </h2>
        <button
          type="button"
          className="app-icon-button"
          aria-label="关闭"
          onClick={close}
        >
          <X aria-hidden size={18} />
        </button>
      </div>
      <div className="px-5 py-5">
        {!executionId ? (
          <>
            <dl className="grid gap-4 sm:grid-cols-2">
              <Definition label="任务版本">
                版本 {props.detail.currentVersion}
              </Definition>
              <Definition label="投递目标">
                {props.detail.deliveryTarget?.name ?? "仅保存"}
              </Definition>
            </dl>
            <fieldset className="mt-6">
              <legend className="text-sm font-medium text-[var(--app-text-strong)]">
                执行方式
              </legend>
              <div className="mt-2 grid grid-cols-2 border border-[var(--app-border-soft)]">
                <button
                  type="button"
                  aria-pressed={!deliver}
                  className={`px-3 py-2.5 text-sm transition-colors ${!deliver ? "bg-[var(--app-panel-strong)] text-[var(--app-text-strong)]" : "text-[var(--app-text-muted)]"}`}
                  onClick={() => setDeliver(false)}
                >
                  仅生成预览
                </button>
                <button
                  type="button"
                  aria-pressed={deliver}
                  disabled={!canDeliver}
                  className={`border-l border-[var(--app-border-soft)] px-3 py-2.5 text-sm transition-colors ${deliver ? "bg-[var(--app-panel-strong)] text-[var(--app-text-strong)]" : "text-[var(--app-text-muted)]"}`}
                  onClick={() => setDeliver(true)}
                >
                  生成并投递
                </button>
              </div>
            </fieldset>
            {!canDeliver ? (
              <p className="mt-3 text-sm text-[var(--app-text-subtle)]">
                当前任务没有可用的飞书目标。如需真实投递，请先修改投递设置。
              </p>
            ) : null}
            {run.error ? (
              <div className="mt-4">
                <InlineNotice tone="danger" description={run.error.message} />
              </div>
            ) : null}
          </>
        ) : execution.isLoading || !execution.data ? (
          <EmptyState title="正在启动试执行" />
        ) : (
          <div>
            <div className="flex items-center justify-between gap-3">
              <StatusPill
                label={executionStatus[execution.data.status][0]}
                tone={executionStatus[execution.data.status][1]}
              />
              <span className="text-sm text-[var(--app-text-subtle)]">
                手动触发 · 版本 {execution.data.taskVersion.version}
              </span>
            </div>
            {execution.data.result ? (
              <div className="mt-5 border-t border-[var(--app-border-soft)] pt-5">
                <MarkdownContent
                  content={String(
                    asRecord(execution.data.result).body ??
                      asRecord(execution.data.result).summary ??
                      "",
                  )}
                />
              </div>
            ) : null}
            {execution.data.error ? (
              <div className="mt-5">
                <InlineNotice
                  tone="danger"
                  description={String(
                    asRecord(execution.data.error).message ?? "试执行失败",
                  )}
                />
              </div>
            ) : null}
            {!terminal ? (
              <p className="mt-5 text-sm text-[var(--app-text-muted)]">
                任务仍在后台执行，可以关闭弹窗后到执行记录查看。
              </p>
            ) : null}
          </div>
        )}
      </div>
      <div className="flex justify-end gap-2 border-t border-[var(--app-border-soft)] px-5 py-4">
        <button type="button" className="app-button" onClick={close}>
          关闭
        </button>
        {!executionId ? (
          <button
            type="button"
            className="app-button app-button-primary"
            disabled={run.isPending}
            onClick={() =>
              run.mutate({
                taskId: props.detail.id,
                deliver,
                idempotencyKey: `manual:${props.detail.id}:${crypto.randomUUID()}`,
              })
            }
          >
            <Play aria-hidden size={16} />
            开始执行
          </button>
        ) : null}
      </div>
    </dialog>
  );
}

export function ScheduledTaskDetailClient(props: { taskId: string }) {
  const router = useRouter();
  const utils = api.useUtils();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<EditDraft | null>(null);
  const [expandedExecutionId, setExpandedExecutionId] = useState("");
  const [trialOpen, setTrialOpen] = useState(false);
  const detail = api.scheduledTask.getDetail.useQuery({ id: props.taskId });
  const executions = api.scheduledTask.listExecutions.useInfiniteQuery(
    { taskId: props.taskId, limit: 20 },
    { getNextPageParam: (page) => page.nextCursor },
  );
  const executionDetail = api.scheduledTask.getExecution.useQuery(
    { id: expandedExecutionId },
    { enabled: Boolean(expandedExecutionId) },
  );
  const prepare = api.scheduledTask.prepareStructuredEdit.useMutation({
    onSuccess: setDraft,
  });
  const confirm = api.scheduledTask.confirmEditDraft.useMutation({
    onSuccess: async () => {
      setDraft(null);
      setEditing(false);
      await Promise.all([
        utils.scheduledTask.getDetail.invalidate({ id: props.taskId }),
        utils.scheduledTask.list.invalidate(),
      ]);
    },
  });
  const startAgentEdit = api.scheduledTask.startAgentEdit.useMutation({
    onSuccess: (result) =>
      router.push(
        `/agent-runtime?conversationId=${encodeURIComponent(result.conversationId)}`,
      ),
  });
  const rows = executions.data?.pages.flatMap((page) => page.items) ?? [];

  if (detail.isLoading) {
    return (
      <WorkspaceShell
        section="scheduledTasks"
        title="定时任务详情"
        showHistory={false}
      >
        <EmptyState title="正在加载任务" />
      </WorkspaceShell>
    );
  }
  if (detail.error || !detail.data) {
    return (
      <WorkspaceShell
        section="scheduledTasks"
        title="定时任务详情"
        showHistory={false}
      >
        <InlineNotice
          tone="danger"
          description={detail.error?.message ?? "定时任务不存在"}
        />
      </WorkspaceShell>
    );
  }

  const task = detail.data;
  const version = task.version;
  const schedule = asRecord(version.scheduleSpec);
  const output = asRecord(version.outputSpec);
  const delivery = asRecord(version.deliverySpec);
  const plan = asRecord(version.executionPlan);
  const sources = Array.isArray(version.dataSources)
    ? version.dataSources.map(asRecord)
    : [];
  const allowedCapabilities = Array.isArray(plan.allowedCapabilities)
    ? plan.allowedCapabilities.map(String)
    : [];
  const editable = task.status === "ACTIVE" || task.status === "PAUSED";
  const meta = taskStatus[task.status];

  return (
    <WorkspaceShell
      section="scheduledTasks"
      title={task.name}
      description={`当前版本 ${task.currentVersion} · 更新于 ${formatDate(task.updatedAt)}`}
      titleSize="compact"
      showHistory={false}
      actions={
        <div className="flex flex-wrap items-center gap-2">
          <StatusPill label={meta.label} tone={meta.tone} />
          {editable ? (
            <button
              type="button"
              className="app-button app-button-primary"
              onClick={() => setTrialOpen(true)}
            >
              <Play aria-hidden size={16} />
              试执行
            </button>
          ) : null}
        </div>
      }
    >
      <Link
        href="/scheduled-tasks"
        className="inline-flex w-fit items-center gap-2 text-sm text-[var(--app-text-muted)] hover:text-[var(--app-text-strong)]"
      >
        <ArrowLeft aria-hidden size={16} />
        返回任务列表
      </Link>

      <nav
        className="sticky top-0 z-10 flex overflow-x-auto border-y border-[var(--app-border-soft)] bg-[var(--app-panel)]"
        aria-label="任务详情导航"
      >
        {[
          ["content", "任务内容"],
          ["schedule", "执行计划"],
          ["delivery", "投递设置"],
          ["executions", "执行记录"],
          ["edit", "编辑任务"],
        ].map(([href, label]) => (
          <a
            key={href}
            href={`#${href}`}
            className="shrink-0 px-4 py-3 text-sm text-[var(--app-text-muted)] transition-colors hover:text-[var(--app-text-strong)]"
          >
            {label}
          </a>
        ))}
      </nav>

      <section className="py-2">
        <SectionTitle id="content" title="任务内容" />
        <p className="max-w-4xl whitespace-pre-wrap text-sm leading-7 text-[var(--app-text-strong)]">
          {version.userPrompt}
        </p>
        <div className="mt-5 overflow-x-auto border-y border-[var(--app-border-soft)]">
          <table className="app-table min-w-[680px]">
            <thead>
              <tr>
                <th>数据提供方</th>
                <th>能力</th>
                <th>参数摘要</th>
              </tr>
            </thead>
            <tbody>
              {sources.map((source, index) => (
                <tr key={`${String(source.capability)}-${index}`}>
                  <td>{String(source.provider ?? "—")}</td>
                  <td>{String(source.capability ?? "—")}</td>
                  <td className="max-w-[380px] truncate">
                    {parameterSummary(source.parameters)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="mt-4 text-sm text-[var(--app-text-muted)]">
          执行能力：{allowedCapabilities.join("、") || "由 Agent 按计划调用"}
        </div>
      </section>

      <section className="border-t border-[var(--app-border-soft)] py-6">
        <SectionTitle id="schedule" title="执行计划" />
        <dl className="grid gap-x-8 gap-y-5 sm:grid-cols-2 lg:grid-cols-3">
          <Definition label="周期">{scheduleLabel(schedule)}</Definition>
          <Definition label="时区">
            {String(schedule.timezone ?? task.timezone)}
          </Definition>
          <Definition label="下次执行">{formatDate(task.nextRunAt)}</Definition>
          <Definition label="交易日历">
            {schedule.type === "TRADING_DAY"
              ? String(schedule.marketCalendar ?? "SSE")
              : "不适用"}
          </Definition>
          <Definition label="生效时间">
            {formatDate(
              typeof schedule.startAt === "string" ? schedule.startAt : null,
            )}
          </Definition>
          <Definition label="结束时间">
            {formatDate(
              typeof schedule.endAt === "string" ? schedule.endAt : null,
            )}
          </Definition>
        </dl>
      </section>

      <section className="border-t border-[var(--app-border-soft)] py-6">
        <SectionTitle id="delivery" title="投递设置" />
        <dl className="grid gap-x-8 gap-y-5 sm:grid-cols-2 lg:grid-cols-4">
          <Definition label="投递方式">
            {delivery.type === "FEISHU" ? "飞书" : "仅保存"}
          </Definition>
          <Definition label="投递目标">
            {task.deliveryTarget?.name ?? "—"}
          </Definition>
          <Definition label="输出格式">
            {String(output.format ?? "MARKDOWN")}
          </Definition>
          <Definition label="内容详略">
            {{ BRIEF: "简洁", STANDARD: "标准", DETAILED: "详细" }[
              String(output.detailLevel ?? "STANDARD")
            ] ?? "标准"}
          </Definition>
          <Definition label="包含证据">
            {output.includeEvidence === false ? "否" : "是"}
          </Definition>
          <Definition label="空结果投递">
            {output.sendOnEmpty === false ? "跳过" : "投递"}
          </Definition>
        </dl>
      </section>

      <section className="border-t border-[var(--app-border-soft)] py-6">
        <SectionTitle id="executions" title="执行记录" />
        {executions.isLoading ? (
          <EmptyState title="正在加载执行记录" />
        ) : rows.length === 0 ? (
          <EmptyState title="还没有执行记录" />
        ) : (
          <div className="overflow-x-auto border-y border-[var(--app-border-soft)]">
            <table className="app-table min-w-[780px]">
              <thead>
                <tr>
                  <th>触发时间</th>
                  <th>方式</th>
                  <th>版本</th>
                  <th>状态</th>
                  <th>耗时</th>
                  <th>投递</th>
                  <th>
                    <span className="sr-only">展开</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((execution) => {
                  const status = executionStatus[execution.status];
                  const expanded = expandedExecutionId === execution.id;
                  const deliveryStatus = execution.deliveryRequested
                    ? (execution.deliveries[0]?.status ?? "等待结果")
                    : "未请求";
                  return (
                    <Fragment key={execution.id}>
                      <tr>
                        <td>{formatDate(execution.createdAt)}</td>
                        <td>
                          {execution.trigger === "MANUAL" ? "手动" : "计划"}
                        </td>
                        <td>v{execution.taskVersion.version}</td>
                        <td>
                          <StatusPill label={status[0]} tone={status[1]} />
                        </td>
                        <td>{durationLabel(execution)}</td>
                        <td>{deliveryStatus}</td>
                        <td>
                          <button
                            type="button"
                            className="app-icon-button"
                            aria-label={
                              expanded ? "收起执行结果" : "展开执行结果"
                            }
                            aria-expanded={expanded}
                            onClick={() =>
                              setExpandedExecutionId(
                                expanded ? "" : execution.id,
                              )
                            }
                          >
                            {expanded ? (
                              <ChevronDown aria-hidden size={16} />
                            ) : (
                              <ChevronRight aria-hidden size={16} />
                            )}
                          </button>
                        </td>
                      </tr>
                      {expanded ? (
                        <tr>
                          <td
                            colSpan={7}
                            className="bg-[var(--app-bg-inset)] px-5 py-5"
                          >
                            {executionDetail.isLoading ? (
                              <EmptyState title="正在加载执行结果" />
                            ) : executionDetail.data?.result ? (
                              asRecord(executionDetail.data.result).type ===
                              "SCORING_REPORT" ? (
                                <div>
                                  <div className="flex flex-wrap items-center justify-between gap-3">
                                    <p className="text-sm text-[var(--app-text)]">
                                      数据截止{" "}
                                      {String(
                                        asRecord(executionDetail.data.result)
                                          .asOfDate ?? "—",
                                      )}
                                      ；已评估{" "}
                                      {String(
                                        asRecord(executionDetail.data.result)
                                          .evaluatedCount ?? 0,
                                      )}{" "}
                                      只，入选{" "}
                                      {String(
                                        asRecord(executionDetail.data.result)
                                          .selectedCount ?? 0,
                                      )}{" "}
                                      只；投递状态 {deliveryStatus}。
                                    </p>
                                    <a
                                      className="app-button"
                                      href={`/api/scheduled-tasks/executions/${execution.id}/export`}
                                    >
                                      <Download aria-hidden size={16} />
                                      下载 Excel
                                    </a>
                                  </div>
                                  <div className="mt-4 overflow-x-auto">
                                    <table className="app-table min-w-[620px]">
                                      <thead>
                                        <tr>
                                          <th>股票</th>
                                          <th>总分</th>
                                          <th>规则明细</th>
                                        </tr>
                                      </thead>
                                      <tbody>
                                        {executionDetail.data.scoreResults.map(
                                          (row) => (
                                            <tr key={row.id}>
                                              <td>
                                                {row.stockName}（{row.stockCode}
                                                ）
                                              </td>
                                              <td>
                                                {row.score} / {row.maxScore}
                                              </td>
                                              <td>
                                                {Object.entries(
                                                  asRecord(row.ruleResults),
                                                )
                                                  .map(
                                                    ([ruleId, value]) =>
                                                      `${ruleId}: ${String(asRecord(value).status ?? "NOT_EVALUATED")} / ${String(asRecord(value).awardedPoints ?? 0)} 分`,
                                                  )
                                                  .join("；") || "—"}
                                              </td>
                                            </tr>
                                          ),
                                        )}
                                      </tbody>
                                    </table>
                                  </div>
                                </div>
                              ) : (
                                <MarkdownContent
                                  content={String(
                                    asRecord(executionDetail.data.result)
                                      .body ??
                                      asRecord(executionDetail.data.result)
                                        .summary ??
                                      "",
                                  )}
                                />
                              )
                            ) : executionDetail.data?.error ? (
                              <InlineNotice
                                tone="danger"
                                description={String(
                                  asRecord(executionDetail.data.error)
                                    .message ?? "执行失败",
                                )}
                              />
                            ) : (
                              <p className="text-sm text-[var(--app-text-muted)]">
                                执行尚未生成结果。
                              </p>
                            )}
                            {executionDetail.data?.evidence.length ? (
                              <div className="mt-5 border-t border-[var(--app-border-soft)] pt-4">
                                <h3 className="text-sm font-medium text-[var(--app-text-strong)]">
                                  证据
                                </h3>
                                <ul className="mt-2 grid gap-2 text-sm text-[var(--app-text-muted)]">
                                  {executionDetail.data.evidence.map((item) => (
                                    <li key={item.id}>
                                      {item.url ? (
                                        <a
                                          href={item.url}
                                          target="_blank"
                                          rel="noreferrer"
                                          className="underline hover:text-[var(--app-text-strong)]"
                                        >
                                          {item.title ?? item.sourceId}
                                        </a>
                                      ) : (
                                        (item.title ?? item.sourceId)
                                      )}
                                    </li>
                                  ))}
                                </ul>
                              </div>
                            ) : null}
                          </td>
                        </tr>
                      ) : null}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {executions.hasNextPage ? (
          <div className="mt-4 flex justify-center">
            <button
              type="button"
              className="app-button"
              disabled={executions.isFetchingNextPage}
              onClick={() => executions.fetchNextPage()}
            >
              加载更多
            </button>
          </div>
        ) : null}
      </section>

      <section className="border-t border-[var(--app-border-soft)] py-6">
        <SectionTitle id="edit" title="编辑任务" />
        {!editable ? (
          <InlineNotice
            tone="info"
            description="已取消任务只能查看历史配置和执行记录。"
          />
        ) : !editing && !draft ? (
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className="app-button app-button-primary"
              onClick={() => setEditing(true)}
            >
              结构化编辑
            </button>
            <button
              type="button"
              className="app-button"
              disabled={startAgentEdit.isPending}
              onClick={() => startAgentEdit.mutate({ taskId: task.id })}
            >
              和 Agent 讨论修改
            </button>
          </div>
        ) : draft ? (
          <div className="max-w-4xl">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h3 className="text-base font-semibold text-[var(--app-text-strong)]">
                变更摘要
              </h3>
              <StatusPill
                tone="warning"
                label={`版本 ${draft.baseVersion} → ${draft.baseVersion + 1}`}
              />
            </div>
            <div className="mt-4 divide-y divide-[var(--app-border-soft)] border-y border-[var(--app-border-soft)]">
              {(Array.isArray(draft.changes)
                ? draft.changes.map(asRecord)
                : []
              ).map((change) => (
                <div
                  key={String(change.field)}
                  className="grid gap-3 py-4 sm:grid-cols-[120px_1fr_32px_1fr]"
                >
                  <div className="text-sm font-medium text-[var(--app-text-strong)]">
                    {String(change.label)}
                  </div>
                  <pre className="whitespace-pre-wrap break-words text-xs text-[var(--app-text-muted)]">
                    {displayValue(change.before)}
                  </pre>
                  <span className="text-[var(--app-text-subtle)]">→</span>
                  <pre className="whitespace-pre-wrap break-words text-xs text-[var(--app-text-strong)]">
                    {displayValue(change.after)}
                  </pre>
                </div>
              ))}
            </div>
            <p className="mt-4 text-sm text-[var(--app-text-muted)]">
              新的下次执行时间：{formatDate(draft.nextRunAt)}
            </p>
            {confirm.error ? (
              <div className="mt-4">
                <InlineNotice
                  tone="danger"
                  description={confirm.error.message}
                />
              </div>
            ) : null}
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                className="app-button"
                onClick={() => setDraft(null)}
              >
                返回编辑
              </button>
              <button
                type="button"
                className="app-button app-button-primary"
                disabled={confirm.isPending}
                onClick={() =>
                  confirm.mutate({
                    draftId: draft.id,
                    expectedRevision: draft.revision,
                  })
                }
              >
                确认修改并创建新版本
              </button>
            </div>
          </div>
        ) : (
          <StructuredEditForm
            detail={task}
            busy={prepare.isPending}
            error={prepare.error?.message}
            onCancel={() => setEditing(false)}
            onSubmit={(value) =>
              prepare.mutate({
                taskId: task.id,
                value,
                idempotencyKey: `structured:${task.id}:${crypto.randomUUID()}`,
              })
            }
          />
        )}
        {startAgentEdit.error ? (
          <div className="mt-4">
            <InlineNotice
              tone="danger"
              description={startAgentEdit.error.message}
            />
          </div>
        ) : null}
      </section>

      <TrialRunDialog
        open={trialOpen}
        detail={task}
        onClose={() => setTrialOpen(false)}
        onCompleted={() => {
          void executions.refetch();
        }}
      />
    </WorkspaceShell>
  );
}

function StructuredEditForm(props: {
  detail: Detail;
  busy: boolean;
  error?: string;
  onCancel: () => void;
  onSubmit: (value: {
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
    output: {
      format: "MARKDOWN" | "JSON";
      includeEvidence: boolean;
      detailLevel: "BRIEF" | "STANDARD" | "DETAILED";
      sendOnEmpty: boolean;
    };
    delivery: { type: "SAVE_ONLY" } | { type: "FEISHU"; targetRef: string };
  }) => void;
}) {
  const schedule = asRecord(props.detail.version.scheduleSpec);
  const output = asRecord(props.detail.version.outputSpec);
  const delivery = asRecord(props.detail.version.deliverySpec);
  const [name, setName] = useState(props.detail.name);
  const [type, setType] = useState<"DAILY" | "WEEKLY" | "TRADING_DAY">(
    (schedule.type as "DAILY" | "WEEKLY" | "TRADING_DAY") ?? "DAILY",
  );
  const [time, setTime] = useState(String(schedule.time ?? "09:00"));
  const [timezone, setTimezone] = useState(
    String(schedule.timezone ?? "Asia/Shanghai"),
  );
  const [weekdays, setWeekdays] = useState<number[]>(
    Array.isArray(schedule.weekdays) ? schedule.weekdays.map(Number) : [1],
  );
  const [format, setFormat] = useState<"MARKDOWN" | "JSON">(
    (output.format as "MARKDOWN" | "JSON") ?? "MARKDOWN",
  );
  const [detailLevel, setDetailLevel] = useState<
    "BRIEF" | "STANDARD" | "DETAILED"
  >((output.detailLevel as "BRIEF" | "STANDARD" | "DETAILED") ?? "STANDARD");
  const [includeEvidence, setIncludeEvidence] = useState(
    output.includeEvidence !== false,
  );
  const [sendOnEmpty, setSendOnEmpty] = useState(output.sendOnEmpty !== false);
  const [deliveryType, setDeliveryType] = useState<"SAVE_ONLY" | "FEISHU">(
    delivery.type === "FEISHU" ? "FEISHU" : "SAVE_ONLY",
  );
  const [targetRef, setTargetRef] = useState(
    String(
      delivery.targetRef ??
        props.detail.availableDeliveryTargets[0]?.targetRef ??
        "",
    ),
  );
  const fieldClass = "app-input mt-1 w-full";

  return (
    <form
      className="max-w-4xl"
      onSubmit={(event) => {
        event.preventDefault();
        props.onSubmit({
          name,
          schedule: {
            type,
            time,
            timezone,
            ...(type === "WEEKLY" ? { weekdays } : {}),
            ...(type === "TRADING_DAY"
              ? { marketCalendar: String(schedule.marketCalendar ?? "SSE") }
              : {}),
            ...(typeof schedule.startAt === "string"
              ? { startAt: schedule.startAt }
              : {}),
            ...(typeof schedule.endAt === "string"
              ? { endAt: schedule.endAt }
              : {}),
          },
          output: { format, includeEvidence, detailLevel, sendOnEmpty },
          delivery:
            deliveryType === "FEISHU"
              ? { type: "FEISHU", targetRef }
              : { type: "SAVE_ONLY" },
        });
      }}
    >
      <div className="grid gap-5 sm:grid-cols-2">
        <label className="sm:col-span-2 text-sm text-[var(--app-text-strong)]">
          任务名称
          <input
            className={fieldClass}
            value={name}
            maxLength={200}
            required
            onChange={(event) => setName(event.target.value)}
          />
        </label>
        <label className="text-sm text-[var(--app-text-strong)]">
          执行周期
          <select
            className={fieldClass}
            value={type}
            onChange={(event) => setType(event.target.value as typeof type)}
          >
            <option value="DAILY">每天</option>
            <option value="WEEKLY">每周</option>
            <option value="TRADING_DAY">每个交易日</option>
          </select>
        </label>
        <label className="text-sm text-[var(--app-text-strong)]">
          执行时间
          <input
            className={fieldClass}
            type="time"
            value={time}
            required
            onChange={(event) => setTime(event.target.value)}
          />
        </label>
        <label className="text-sm text-[var(--app-text-strong)]">
          时区
          <input
            className={fieldClass}
            value={timezone}
            required
            onChange={(event) => setTimezone(event.target.value)}
          />
        </label>
        {type === "WEEKLY" ? (
          <fieldset className="sm:col-span-2">
            <legend className="text-sm text-[var(--app-text-strong)]">
              执行日
            </legend>
            <div className="mt-2 flex flex-wrap gap-4">
              {[1, 2, 3, 4, 5, 6, 0].map((day) => (
                <label key={day} className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={weekdays.includes(day)}
                    onChange={(event) =>
                      setWeekdays((current) =>
                        event.target.checked
                          ? [...current, day]
                          : current.filter((item) => item !== day),
                      )
                    }
                  />
                  {
                    ["周日", "周一", "周二", "周三", "周四", "周五", "周六"][
                      day
                    ]
                  }
                </label>
              ))}
            </div>
          </fieldset>
        ) : null}
        <label className="text-sm text-[var(--app-text-strong)]">
          输出格式
          <select
            className={fieldClass}
            value={format}
            onChange={(event) => setFormat(event.target.value as typeof format)}
          >
            <option value="MARKDOWN">Markdown</option>
            <option value="JSON">JSON</option>
          </select>
        </label>
        <label className="text-sm text-[var(--app-text-strong)]">
          内容详略
          <select
            className={fieldClass}
            value={detailLevel}
            onChange={(event) =>
              setDetailLevel(event.target.value as typeof detailLevel)
            }
          >
            <option value="BRIEF">简洁</option>
            <option value="STANDARD">标准</option>
            <option value="DETAILED">详细</option>
          </select>
        </label>
        <label className="flex items-center gap-2 text-sm text-[var(--app-text-strong)]">
          <input
            type="checkbox"
            checked={includeEvidence}
            onChange={(event) => setIncludeEvidence(event.target.checked)}
          />
          在输出中包含证据
        </label>
        <label className="flex items-center gap-2 text-sm text-[var(--app-text-strong)]">
          <input
            type="checkbox"
            checked={sendOnEmpty}
            onChange={(event) => setSendOnEmpty(event.target.checked)}
          />
          空结果仍然投递
        </label>
        <label className="text-sm text-[var(--app-text-strong)]">
          投递方式
          <select
            className={fieldClass}
            value={deliveryType}
            onChange={(event) =>
              setDeliveryType(event.target.value as typeof deliveryType)
            }
          >
            <option value="SAVE_ONLY">仅保存</option>
            <option
              value="FEISHU"
              disabled={!props.detail.availableDeliveryTargets.length}
            >
              飞书
            </option>
          </select>
        </label>
        {deliveryType === "FEISHU" ? (
          <label className="text-sm text-[var(--app-text-strong)]">
            飞书目标
            <select
              className={fieldClass}
              value={targetRef}
              required
              onChange={(event) => setTargetRef(event.target.value)}
            >
              {props.detail.availableDeliveryTargets.map((target) => (
                <option key={target.targetRef} value={target.targetRef}>
                  {target.name}
                </option>
              ))}
            </select>
          </label>
        ) : null}
      </div>
      {props.error ? (
        <div className="mt-5">
          <InlineNotice tone="danger" description={props.error} />
        </div>
      ) : null}
      <div className="mt-6 flex justify-end gap-2">
        <button type="button" className="app-button" onClick={props.onCancel}>
          取消
        </button>
        <button
          type="submit"
          className="app-button app-button-primary"
          disabled={props.busy || (type === "WEEKLY" && weekdays.length === 0)}
        >
          预览修改
        </button>
      </div>
    </form>
  );
}
