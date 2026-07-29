"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { EvidenceContextCitations } from "~/app/_components/evidence-context-citations";
import { HighlightToNote } from "~/app/_components/highlight-to-note";
import { MarkdownContent } from "~/app/_components/markdown-content";
import {
  InlineNotice,
  StatusPill,
  type WorkspaceHistoryItem,
  WorkspaceShell,
} from "~/app/_components/ui";
import { resolveAgentMessageText } from "~/app/agent-runtime/message-display";
import {
  consumePiAgentSelectionDraft,
  PI_AGENT_SELECTION_DRAFT_QUERY,
} from "~/app/agent-runtime/selection-draft";
import type { ResearchTargetRef } from "~/contracts/research-target";
import type { EvidenceCitation } from "~/server/domain/evidence-context/types";
import { api, type RouterOutputs } from "~/trpc/react";

type Conversation = NonNullable<
  RouterOutputs["agentRuntime"]["getConversation"]
>;
type Message = Conversation["messages"][number];
type ConversationListItem =
  RouterOutputs["agentRuntime"]["listConversations"]["items"][number];
type AgentRuntimeSkill =
  RouterOutputs["agentRuntime"]["listSkills"]["items"][number];
type SetupDraft = NonNullable<RouterOutputs["scheduledTask"]["getSetupDraft"]>;
type EditDraft = NonNullable<RouterOutputs["scheduledTask"]["getEditDraft"]>;
type WorkflowStreamEvent = {
  runId: string;
  sequence: number;
  type: string;
  nodeKey?: string;
  progressPercent: number;
  timestamp: string;
  payload: Record<string, unknown>;
};

const statusTone = {
  PENDING: "neutral",
  STREAMING: "info",
  WAITING_FOR_INPUT: "warning",
  SUCCEEDED: "success",
  FAILED: "danger",
  CANCELLED: "warning",
} as const;

const statusLabel = {
  PENDING: "等待中",
  STREAMING: "生成中",
  WAITING_FOR_INPUT: "等待你的回答",
  SUCCEEDED: "完成",
  FAILED: "失败",
  CANCELLED: "已取消",
} as const;

const skillCategoryOrder = [
  "市场与题材",
  "个股研究",
  "财报、公告与事件解读",
  "选股与机会发现",
  "估值与定价",
  "交易计划与仓位风控",
  "盘中监控与复盘",
] as const;

function parseEvidenceTokens(content: string): {
  text: string;
  citations: EvidenceCitation[];
} {
  const citations: EvidenceCitation[] = [];
  const text = content.replace(
    /\[\[evidence:([^\]]+)\]\]/g,
    (_match, itemId: string) => {
      const evidenceItemId = itemId.trim();
      if (evidenceItemId) {
        citations.push({ evidenceItemId, relation: "support" });
      }
      return "";
    },
  );
  return { text, citations };
}

function latestRunningRunId(conversation?: Conversation) {
  return conversation?.messages
    .filter(
      (message) =>
        message.role === "ASSISTANT" &&
        (message.status === "PENDING" || message.status === "STREAMING") &&
        message.workflowRunId,
    )
    .at(-1)?.workflowRunId;
}

function getWaitingRequest(message: Message) {
  if (message.status !== "WAITING_FOR_INPUT") {
    return null;
  }

  const metadata = asRecord(message.metadata);
  const inputRequest = asRecord(metadata.inputRequest);
  const question =
    typeof inputRequest.question === "string"
      ? inputRequest.question
      : typeof metadata.question === "string"
        ? metadata.question
        : message.content;
  const options = Array.isArray(inputRequest.options)
    ? inputRequest.options
        .filter((option): option is { label: string; value: string } =>
          Boolean(
            option &&
              typeof option === "object" &&
              typeof (option as { label?: unknown }).label === "string" &&
              typeof (option as { value?: unknown }).value === "string",
          ),
        )
        .slice(0, 6)
    : [];

  return { question, options };
}

function buildConversationHistoryItems(
  conversations: ConversationListItem[],
): WorkspaceHistoryItem[] {
  return conversations.map((conversation) => ({
    id: conversation.id,
    title: conversation.title?.trim() || "未命名对话",
    href: `/agent-runtime?conversationId=${encodeURIComponent(
      conversation.id,
    )}`,
  }));
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function ScheduledTaskPreview(props: {
  draft: SetupDraft;
  busy: boolean;
  error?: string;
  onConfirm: () => void;
}) {
  const utils = api.useUtils();
  const deterministic =
    asRecord(props.draft.executionPlan).type === "deterministic_scoring";
  const [planText, setPlanText] = useState(() =>
    JSON.stringify(props.draft.executionPlan, null, 2),
  );
  const [planIssue, setPlanIssue] = useState<string>();
  const updatePlan = api.scheduledTask.updateSetupDraftPlan.useMutation({
    onSuccess: async (value) => {
      setPlanText(JSON.stringify(value.normalizedPlan, null, 2));
      setPlanIssue(undefined);
      await utils.scheduledTask.getSetupDraft.invalidate();
    },
    onError: (error) => setPlanIssue(error.message),
  });
  const schedule = asRecord(props.draft.schedule);
  const feasibility = asRecord(props.draft.feasibility);
  const blockers = Array.isArray(feasibility.blockingIssues)
    ? feasibility.blockingIssues.map(String)
    : [];
  const warnings = Array.isArray(feasibility.warnings)
    ? feasibility.warnings.map(String)
    : [];
  const sources = Array.isArray(props.draft.dataSources)
    ? props.draft.dataSources.map(asRecord)
    : [];
  const delivery = asRecord(props.draft.delivery);
  const output = asRecord(props.draft.output);
  const confirmable =
    ["SUPPORTED", "SUPPORTED_WITH_LIMITS"].includes(
      String(feasibility.status),
    ) && blockers.length === 0;
  return (
    <section className="border-t border-[var(--app-border-soft)] pt-5">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-base font-semibold text-[var(--app-text-strong)]">
          {props.draft.name}
        </h2>
        <StatusPill
          tone={confirmable ? "success" : "warning"}
          label={String(feasibility.status ?? "待验证")}
        />
      </div>
      <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
        <div>
          <dt className="text-[var(--app-text-muted)]">执行时间</dt>
          <dd className="mt-1 text-[var(--app-text)]">
            {String(schedule.type ?? "")} {String(schedule.time ?? "")}
          </dd>
        </div>
        <div>
          <dt className="text-[var(--app-text-muted)]">时区</dt>
          <dd className="mt-1 text-[var(--app-text)]">
            {String(schedule.timezone ?? "")}
          </dd>
        </div>
        <div>
          <dt className="text-[var(--app-text-muted)]">数据来源</dt>
          <dd className="mt-1 text-[var(--app-text)]">
            {sources
              .map(
                (source) =>
                  `${String(source.provider ?? "")}: ${String(source.capability ?? "")}`,
              )
              .join("、")}
          </dd>
        </div>
        <div>
          <dt className="text-[var(--app-text-muted)]">输出</dt>
          <dd className="mt-1 text-[var(--app-text)]">
            {String(output.format ?? "结构化结果")}
          </dd>
        </div>
        <div>
          <dt className="text-[var(--app-text-muted)]">发送位置</dt>
          <dd className="mt-1 text-[var(--app-text)]">
            {delivery.type === "FEISHU"
              ? `飞书 ${String(delivery.targetRef ?? "")}`
              : "仅保存"}
          </dd>
        </div>
        <div>
          <dt className="text-[var(--app-text-muted)]">下次执行</dt>
          <dd className="mt-1 text-[var(--app-text)]">
            {props.draft.nextRunAt
              ? new Date(props.draft.nextRunAt).toLocaleString("zh-CN")
              : "待确定"}
          </dd>
        </div>
      </dl>
      {[...warnings, ...blockers].length ? (
        <div className="mt-4 space-y-1 text-sm text-[var(--app-text-muted)]">
          {[...warnings, ...blockers].map((item) => (
            <p key={item}>{item}</p>
          ))}
        </div>
      ) : null}
      {deterministic ? (
        <div className="mt-5">
          <label
            htmlFor={`deterministic-plan-${props.draft.taskId}`}
            className="text-sm font-medium text-[var(--app-text-strong)]"
          >
            评分规则 JSON
          </label>
          <textarea
            id={`deterministic-plan-${props.draft.taskId}`}
            className="mt-2 min-h-72 w-full resize-y border border-[var(--app-border-soft)] bg-[var(--app-bg-inset)] p-3 font-mono text-xs text-[var(--app-text)] outline-none focus:border-[var(--app-primary-border)]"
            spellCheck={false}
            value={planText}
            onChange={(event) => setPlanText(event.target.value)}
          />
          {planIssue ? (
            <div className="mt-2">
              <InlineNotice tone="danger" description={planIssue} />
            </div>
          ) : null}
          <div className="mt-2 flex justify-end">
            <button
              type="button"
              className="app-button"
              disabled={updatePlan.isPending}
              onClick={() => {
                try {
                  setPlanIssue(undefined);
                  updatePlan.mutate({
                    taskId: props.draft.taskId,
                    expectedVersion: props.draft.version,
                    plan: JSON.parse(planText) as unknown,
                  });
                } catch (error) {
                  setPlanIssue(
                    error instanceof Error ? error.message : "JSON 格式无效",
                  );
                }
              }}
            >
              校验并更新
            </button>
          </div>
        </div>
      ) : null}
      {props.error ? (
        <div className="mt-4">
          <InlineNotice tone="danger" description={props.error} />
        </div>
      ) : null}
      <div className="mt-5 flex justify-end">
        <button
          type="button"
          className="app-button app-button-primary"
          disabled={!confirmable || props.busy}
          onClick={props.onConfirm}
        >
          确认创建
        </button>
      </div>
    </section>
  );
}

function ScheduledTaskEditPreview(props: {
  draft: EditDraft;
  busy: boolean;
  error?: string;
  onConfirm: () => void;
}) {
  const changes = Array.isArray(props.draft.changes)
    ? props.draft.changes.map(asRecord)
    : [];
  return (
    <section className="border-t border-[var(--app-border-soft)] pt-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-base font-semibold text-[var(--app-text-strong)]">
          任务修改预览
        </h2>
        <StatusPill
          tone="warning"
          label={`版本 ${props.draft.baseVersion} → ${props.draft.baseVersion + 1}`}
        />
      </div>
      <div className="mt-4 divide-y divide-[var(--app-border-soft)] border-y border-[var(--app-border-soft)]">
        {changes.map((change) => (
          <div
            key={String(change.field)}
            className="grid gap-2 py-3 text-sm sm:grid-cols-[120px_1fr]"
          >
            <div className="font-medium text-[var(--app-text-strong)]">
              {String(change.label ?? change.field)}
            </div>
            <div className="min-w-0 text-[var(--app-text-muted)]">
              已生成候选修改，确认后才会影响后续执行。
            </div>
          </div>
        ))}
      </div>
      <div className="mt-4 text-sm text-[var(--app-text-muted)]">
        新的下次执行时间：
        {props.draft.nextRunAt
          ? new Date(props.draft.nextRunAt).toLocaleString("zh-CN")
          : "待确定"}
      </div>
      {props.error ? (
        <div className="mt-4">
          <InlineNotice tone="danger" description={props.error} />
        </div>
      ) : null}
      <div className="mt-5 flex justify-end">
        <button
          type="button"
          className="app-button app-button-primary"
          disabled={props.busy}
          onClick={props.onConfirm}
        >
          确认修改并创建新版本
        </button>
      </div>
    </section>
  );
}

function ChatMessage(props: {
  message: Message;
  liveText?: string;
  lastTargetRef?: ResearchTargetRef | null;
  onLastTargetRefChange?: (targetRef: ResearchTargetRef | null) => void;
  onAskOption?: (value: string) => void;
  piAgentHref: string;
}) {
  const { message, liveText } = props;
  const isUser = message.role === "USER";
  const parsed = parseEvidenceTokens(
    resolveAgentMessageText({
      persistedText: message.content,
      status: message.status,
      liveText,
    }),
  );
  const content = parsed.text;

  if (isUser) {
    return (
      <div className="flex justify-end">
        <div className="max-w-[min(620px,78%)] rounded-[18px] bg-[var(--app-panel-strong)] px-4 py-3 text-[var(--app-text-strong)]">
          <div className="whitespace-pre-wrap text-sm leading-6">{content}</div>
          {message.errorMessage ? (
            <div className="mt-3 text-sm text-[var(--app-danger)]">
              {message.errorMessage}
            </div>
          ) : null}
        </div>
      </div>
    );
  }

  return (
    <div className="flex justify-start">
      <div className="min-w-0 max-w-full text-[var(--app-text-strong)]">
        {content ? (
          <HighlightToNote
            lastTargetRef={props.lastTargetRef}
            floatingToolbar
            onLastTargetRefChange={props.onLastTargetRefChange}
            piAgentHref={props.piAgentHref}
            source={{
              kind: "pi_agent_message",
              messageId: message.id,
              workflowRunId: message.workflowRunId,
            }}
          >
            <MarkdownContent
              content={content}
              className="max-w-none [&>*+*]:mt-4"
            />
            <div className="mt-2">
              <EvidenceContextCitations citations={parsed.citations} />
            </div>
          </HighlightToNote>
        ) : (
          <div className="text-sm text-[var(--app-text-subtle)]">
            正在准备回复
          </div>
        )}
        {message.status !== "SUCCEEDED" && message.status !== "STREAMING" ? (
          <div className="mt-3">
            <StatusPill
              tone={statusTone[message.status]}
              label={statusLabel[message.status]}
            />
          </div>
        ) : null}
        {message.errorMessage ? (
          <div className="mt-3 text-sm text-[var(--app-danger)]">
            {message.errorMessage}
          </div>
        ) : null}
        {getWaitingRequest(message)?.options.length ? (
          <div className="mt-4 flex flex-wrap gap-2">
            {getWaitingRequest(message)?.options.map((option) => (
              <button
                key={`${message.id}:${option.value}`}
                type="button"
                className="rounded-[8px] border border-[var(--app-border-soft)] px-3 py-2 text-sm text-[var(--app-text-strong)] transition-colors hover:border-[var(--app-primary-border)] hover:bg-[var(--app-hover-surface)]"
                onClick={() => props.onAskOption?.(option.value)}
              >
                {option.label}
              </button>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function SendIcon(props: { className?: string }) {
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

function StopIcon(props: { className?: string }) {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="none"
      aria-hidden="true"
      className={props.className}
    >
      <rect x="6" y="6" width="8" height="8" rx="1.5" fill="currentColor" />
    </svg>
  );
}

export function PiAgentComposer(props: { showConversation?: boolean } = {}) {
  const { showConversation = true } = props;
  const router = useRouter();
  const searchParams = useSearchParams();
  const selectedConversationId = showConversation
    ? (searchParams.get("conversationId") ?? "")
    : "";
  const utils = api.useUtils();
  const [selectedSkillIds, setSelectedSkillIds] = useState<string[]>([]);
  const [prompt, setPrompt] = useState("");
  const [liveMessages, setLiveMessages] = useState<Record<string, string>>({});
  const [activeRunId, setActiveRunId] = useState("");
  const [cancellingRunId, setCancellingRunId] = useState("");
  const [skillMenuOpen, setSkillMenuOpen] = useState(false);
  const [skillSelectionError, setSkillSelectionError] = useState("");
  const [routingHint, setRoutingHint] = useState<
    "SCHEDULED_TASK_SETUP" | undefined
  >();
  const [activeSkillCategory, setActiveSkillCategory] =
    useState<string>("市场与题材");
  const [lastTargetRef, setLastTargetRef] = useState<ResearchTargetRef | null>(
    null,
  );
  const skillMenuRef = useRef<HTMLDivElement | null>(null);
  const promptTextareaRef = useRef<HTMLTextAreaElement | null>(null);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);

  const skillsQuery = api.agentRuntime.listSkills.useQuery();
  const conversationQuery = api.agentRuntime.getConversation.useQuery(
    { conversationId: selectedConversationId },
    {
      enabled: Boolean(selectedConversationId),
      refetchInterval: (query) => {
        const running = latestRunningRunId(query.state.data);
        return running ? 3000 : false;
      },
    },
  );

  useEffect(() => {
    if (searchParams.get("draft") !== PI_AGENT_SELECTION_DRAFT_QUERY) {
      return;
    }

    const draft = consumePiAgentSelectionDraft();
    if (draft) {
      setPrompt((current) =>
        current.trim() ? `${current.trimEnd()}\n\n${draft.text}` : draft.text,
      );
      if (draft.source?.type === "scheduled-task")
        setRoutingHint("SCHEDULED_TASK_SETUP");
      window.setTimeout(() => promptTextareaRef.current?.focus(), 0);
    }

    const nextSearchParams = new URLSearchParams(searchParams.toString());
    nextSearchParams.delete("draft");
    const nextQuery = nextSearchParams.toString();
    router.replace(
      nextQuery ? `/agent-runtime?${nextQuery}` : "/agent-runtime",
    );
  }, [router, searchParams]);

  useEffect(() => {
    const firstSkill = skillsQuery.data?.items[0]?.id;
    if (selectedSkillIds.length === 0 && firstSkill) {
      setSelectedSkillIds([firstSkill]);
    }
  }, [selectedSkillIds.length, skillsQuery.data?.items]);

  const selectedConversation = conversationQuery.data;
  const runningRunId = latestRunningRunId(selectedConversation);

  useEffect(() => {
    const activeMessageIds = new Set(
      selectedConversation?.messages
        .filter(
          (message) =>
            message.role === "ASSISTANT" &&
            (message.status === "PENDING" || message.status === "STREAMING"),
        )
        .map((message) => message.id) ?? [],
    );

    setLiveMessages((current) => {
      let changed = false;
      const next: Record<string, string> = {};

      for (const [messageId, text] of Object.entries(current)) {
        if (activeMessageIds.has(messageId)) {
          next[messageId] = text;
        } else {
          changed = true;
        }
      }

      return changed ? next : current;
    });
  }, [selectedConversation?.messages]);

  const setupDraftQuery = api.scheduledTask.getSetupDraft.useQuery(
    { conversationId: selectedConversationId },
    {
      enabled: Boolean(selectedConversationId),
      refetchInterval: runningRunId ? 3000 : false,
    },
  );
  const setupDraft = setupDraftQuery.data;
  const editDraftQuery = api.scheduledTask.getEditDraft.useQuery(
    { conversationId: selectedConversationId },
    {
      enabled:
        Boolean(selectedConversationId) &&
        selectedConversation?.routingMode === "SCHEDULED_TASK_EDIT",
      refetchInterval: runningRunId ? 3000 : false,
    },
  );
  const editDraft = editDraftQuery.data;
  const activateDraft = api.scheduledTask.activateDraft.useMutation({
    onSuccess: async () => {
      await Promise.all([
        utils.scheduledTask.getSetupDraft.invalidate({
          conversationId: selectedConversationId,
        }),
        utils.scheduledTask.list.invalidate(),
        utils.agentRuntime.getConversation.invalidate({
          conversationId: selectedConversationId,
        }),
      ]);
    },
  });
  const confirmEditDraft = api.scheduledTask.confirmEditDraft.useMutation({
    onSuccess: async (result) => {
      await Promise.all([
        utils.scheduledTask.getEditDraft.invalidate({
          conversationId: selectedConversationId,
        }),
        utils.scheduledTask.getDetail.invalidate({ id: result.taskId }),
        utils.scheduledTask.list.invalidate(),
        utils.agentRuntime.getConversation.invalidate({
          conversationId: selectedConversationId,
        }),
      ]);
      router.push(`/scheduled-tasks/${result.taskId}`);
    },
  });

  useEffect(() => {
    setActiveRunId(runningRunId ?? "");
  }, [runningRunId]);

  useEffect(() => {
    if (!activeRunId) {
      return;
    }

    const eventSource = new EventSource(
      `/api/workflows/runs/${activeRunId}/events`,
    );
    eventSource.onmessage = (event) => {
      try {
        const parsed = JSON.parse(event.data) as WorkflowStreamEvent;
        const payload = parsed.payload ?? {};
        const piPayload =
          payload.payload && typeof payload.payload === "object"
            ? (payload.payload as Record<string, unknown>)
            : {};
        const piEventType =
          typeof payload.piEventType === "string" ? payload.piEventType : "";
        const assistantMessageId =
          typeof piPayload.assistantMessageId === "string"
            ? piPayload.assistantMessageId
            : "";

        if (
          piEventType === "agent.message.delta" &&
          assistantMessageId &&
          typeof piPayload.delta === "string"
        ) {
          setLiveMessages((current) => ({
            ...current,
            [assistantMessageId]: `${current[assistantMessageId] ?? ""}${
              piPayload.delta as string
            }`,
          }));
        }

        if (
          parsed.type === "RUN_SUCCEEDED" ||
          parsed.type === "RUN_FAILED" ||
          parsed.type === "RUN_CANCELLED"
        ) {
          void utils.agentRuntime.getConversation.invalidate({
            conversationId: selectedConversationId,
          });
          void utils.agentRuntime.listConversations.invalidate({ limit: 30 });
          void utils.scheduledTask.getSetupDraft.invalidate({
            conversationId: selectedConversationId,
          });
          void utils.scheduledTask.getEditDraft.invalidate({
            conversationId: selectedConversationId,
          });
        }

        if (parsed.type === "RUN_PAUSED") {
          void utils.agentRuntime.getConversation.invalidate({
            conversationId: selectedConversationId,
          });
          void utils.agentRuntime.listConversations.invalidate({ limit: 30 });
          setActiveRunId("");
          eventSource.close();
        }
      } catch {
        // Ignore malformed event payloads.
      }
    };

    return () => {
      eventSource.close();
    };
  }, [
    activeRunId,
    selectedConversationId,
    utils.agentRuntime.getConversation,
    utils.agentRuntime.listConversations,
    utils.scheduledTask.getEditDraft,
    utils.scheduledTask.getSetupDraft,
  ]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ block: "end" });
  });

  const selectedSkills = useMemo(
    () =>
      selectedSkillIds
        .map((skillId) =>
          skillsQuery.data?.items.find((skill) => skill.id === skillId),
        )
        .filter((skill): skill is AgentRuntimeSkill => Boolean(skill)),
    [selectedSkillIds, skillsQuery.data?.items],
  );
  const groupedSkills = useMemo(() => {
    const skillMap = new Map<string, AgentRuntimeSkill[]>();

    for (const skill of skillsQuery.data?.items ?? []) {
      const category = skill.category || "个股研究";
      const group = skillMap.get(category) ?? [];
      group.push(skill);
      skillMap.set(category, group);
    }

    const orderedGroups = skillCategoryOrder
      .map((category) => ({
        category,
        items: skillMap.get(category) ?? [],
      }))
      .filter((group) => group.items.length > 0);
    const orderedCategorySet = new Set<string>(skillCategoryOrder);
    const extraGroups = [...skillMap.entries()]
      .filter(([category]) => !orderedCategorySet.has(category))
      .map(([category, items]) => ({ category, items }));

    return [...orderedGroups, ...extraGroups];
  }, [skillsQuery.data?.items]);
  const activeSkillGroup = useMemo(() => {
    return (
      groupedSkills.find((group) => group.category === activeSkillCategory) ??
      groupedSkills[0]
    );
  }, [activeSkillCategory, groupedSkills]);

  useEffect(() => {
    if (
      groupedSkills.length > 0 &&
      !groupedSkills.some((group) => group.category === activeSkillCategory)
    ) {
      setActiveSkillCategory(groupedSkills[0]?.category ?? "市场与题材");
    }
  }, [activeSkillCategory, groupedSkills]);

  useEffect(() => {
    if (!skillMenuOpen) {
      return;
    }

    function handlePointerDown(event: PointerEvent) {
      if (
        event.target instanceof Node &&
        skillMenuRef.current?.contains(event.target)
      ) {
        return;
      }
      setSkillMenuOpen(false);
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setSkillMenuOpen(false);
      }
    }

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [skillMenuOpen]);

  const sendMutation = api.agentRuntime.sendMessage.useMutation({
    onSuccess: async (result) => {
      setPrompt("");
      setRoutingHint(undefined);
      setLiveMessages((current) => ({
        ...current,
        [result.assistantMessageId]: "",
      }));
      await Promise.all([
        utils.agentRuntime.listConversations.invalidate({ limit: 30 }),
        utils.agentRuntime.getConversation.invalidate({
          conversationId: result.conversationId,
        }),
      ]);
      router.push(`/agent-runtime?conversationId=${result.conversationId}`);
      setActiveRunId(result.runId);
    },
  });

  const cancelMutation = api.agentRuntime.cancelRun.useMutation({
    onSuccess: async () => {
      if (selectedConversationId) {
        await utils.agentRuntime.getConversation.invalidate({
          conversationId: selectedConversationId,
        });
      }
      setActiveRunId("");
      setCancellingRunId("");
    },
    onError: () => setCancellingRunId(""),
  });

  const activeGenerationRunId = runningRunId ?? activeRunId;
  const setupMode =
    routingHint === "SCHEDULED_TASK_SETUP" ||
    selectedConversation?.routingMode === "SCHEDULED_TASK_SETUP";
  const editMode = selectedConversation?.routingMode === "SCHEDULED_TASK_EDIT";
  const reservedTaskMode = setupMode || editMode;
  const canSend = Boolean(
    (reservedTaskMode || selectedSkillIds.length > 0) &&
      prompt.trim() &&
      !activeGenerationRunId &&
      !cancellingRunId,
  );

  const toggleSkill = (skillId: string) => {
    setSkillSelectionError("");
    setSelectedSkillIds((current) => {
      if (current.includes(skillId)) {
        return current.filter((item) => item !== skillId);
      }

      if (current.length >= 3) {
        setSkillSelectionError("最多选择 3 个 skill");
        return current;
      }

      return [...current, skillId];
    });
  };

  const removeSkill = (skillId: string) => {
    setSkillSelectionError("");
    setSelectedSkillIds((current) =>
      current.filter((item) => item !== skillId),
    );
  };

  const handleSend = async (nextPrompt = prompt) => {
    const normalizedPrompt = nextPrompt.trim();
    if (!normalizedPrompt || activeGenerationRunId || cancellingRunId) {
      return;
    }
    const primarySkillId = selectedSkillIds[0];
    if (!reservedTaskMode && !primarySkillId) {
      return;
    }
    await sendMutation.mutateAsync({
      conversationId: selectedConversationId || undefined,
      skillId: reservedTaskMode ? undefined : primarySkillId,
      skillIds: reservedTaskMode ? undefined : selectedSkillIds,
      prompt: normalizedPrompt,
      title: normalizedPrompt.slice(0, 80),
      routingHint,
    });
  };

  const renderComposer = () => (
    <div className="pi-agent-composer fixed pointer-events-none right-0 bottom-0 left-0 z-30 bg-transparent py-3">
      <div className="pointer-events-auto mx-auto w-full max-w-[820px] bg-transparent px-1 sm:px-4">
        {cancellingRunId ? (
          <div className="mb-2 flex justify-end">
            <StatusPill tone="warning" label="正在停止" />
          </div>
        ) : activeGenerationRunId ? (
          <div className="mb-2 flex justify-end">
            <StatusPill tone="info" label="正在生成" />
          </div>
        ) : null}
        <div className="relative rounded-[22px] border border-[var(--app-border-soft)] bg-[var(--app-panel-strong)] transition-[border-color,box-shadow,background-color] focus-within:border-[var(--app-accent-strong)] focus-within:bg-[var(--app-bg-elevated)] focus-within:shadow-[0_0_0_3px_var(--app-focus-ring)]">
          <textarea
            ref={promptTextareaRef}
            className="h-[93px] min-h-0 w-full resize-none overflow-y-auto rounded-[22px] border-0 bg-transparent pt-3 pr-16 pb-12 pl-4 text-[var(--app-text)] outline-none placeholder:text-[var(--app-text-soft)]"
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
            disabled={Boolean(cancellingRunId)}
            placeholder="询问任何投研问题"
            onKeyDown={(event) => {
              if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
                event.preventDefault();
                void handleSend();
              }
            }}
          />
          <div
            ref={skillMenuRef}
            className="absolute bottom-3 left-3 flex max-w-[calc(100%-76px)] items-center gap-2"
          >
            {setupMode ? (
              <span className="inline-flex h-10 items-center rounded-[8px] border border-[var(--app-border-soft)] bg-[var(--app-bg-raised)] px-3 text-xs font-medium text-[var(--app-text-strong)]">
                定时任务设定
              </span>
            ) : (
              <>
                <button
                  type="button"
                  aria-haspopup="menu"
                  aria-expanded={skillMenuOpen}
                  title="选择 skill"
                  className="inline-flex h-10 shrink-0 items-center rounded-full border border-[var(--app-border-soft)] bg-[var(--app-hover-surface)] px-3 text-xs font-medium text-[var(--app-text-subtle)] transition-colors hover:border-[var(--app-hover-border)] hover:bg-[var(--app-hover-surface)]"
                  onClick={() => setSkillMenuOpen((current) => !current)}
                >
                  选择 Skill
                </button>
                <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                  {selectedSkills.map((skill) => (
                    <button
                      key={skill.id}
                      type="button"
                      title={`移除 ${skill.name}`}
                      className="inline-flex h-8 max-w-[180px] items-center rounded-[8px] border border-[var(--app-border-soft)] bg-[var(--app-bg-raised)] px-2.5 text-xs font-medium text-[var(--app-text-strong)] transition-colors hover:border-[var(--app-border-strong)]"
                      onClick={() => removeSkill(skill.id)}
                    >
                      <span className="truncate">{skill.name}</span>
                    </button>
                  ))}
                </div>
                <div
                  role="menu"
                  className={[
                    "absolute bottom-12 left-0 z-40 w-[min(560px,calc(100vw-40px))] origin-bottom-left rounded-[14px] border border-[var(--app-border)] bg-[var(--app-bg-floating)] p-1 shadow-[var(--app-shadow-lg)] transition duration-160",
                    skillMenuOpen
                      ? "scale-100 opacity-100"
                      : "pointer-events-none scale-95 opacity-0",
                  ].join(" ")}
                >
                  <div className="max-h-[300px] overflow-y-auto p-1">
                    <div className="grid gap-0.5">
                      {(activeSkillGroup?.items ?? []).map((skill) => {
                        const active = selectedSkillIds.includes(skill.id);

                        return (
                          <button
                            key={skill.id}
                            type="button"
                            role="menuitemcheckbox"
                            aria-checked={active}
                            className={[
                              "grid w-full gap-1 rounded-[10px] px-3 py-2.5 text-left text-sm transition-colors",
                              active
                                ? "bg-[var(--app-primary-surface)] text-[var(--app-on-primary)]"
                                : "text-[var(--app-text-muted)] hover:bg-[var(--app-hover-surface)] hover:text-[var(--app-text-strong)]",
                            ].join(" ")}
                            onClick={() => toggleSkill(skill.id)}
                          >
                            <span className="flex min-w-0 items-center justify-between gap-3">
                              <span className="min-w-0 truncate font-medium">
                                {skill.name}
                              </span>
                              {active ? (
                                <span className="shrink-0 text-xs font-medium">
                                  已选
                                </span>
                              ) : null}
                            </span>
                            <span
                              className={[
                                "line-clamp-2 text-xs leading-5",
                                active
                                  ? "text-[var(--app-text-strong)]/68"
                                  : "text-[var(--app-text-subtle)]",
                              ].join(" ")}
                            >
                              {skill.description}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-1 border-t border-[var(--app-border-soft)] p-1 sm:grid-cols-4">
                    {skillCategoryOrder.map((category) => {
                      const group = groupedSkills.find(
                        (item) => item.category === category,
                      );
                      const active = activeSkillGroup?.category === category;

                      return (
                        <button
                          key={category}
                          type="button"
                          role="tab"
                          aria-selected={active}
                          className={[
                            "h-8 rounded-[8px] px-2 text-left text-xs font-medium transition-colors",
                            active
                              ? "bg-[var(--app-primary-surface)] text-[var(--app-on-primary)]"
                              : "text-[var(--app-text-subtle)] hover:bg-[var(--app-hover-surface)] hover:text-[var(--app-text-strong)]",
                          ].join(" ")}
                          onClick={() => setActiveSkillCategory(category)}
                        >
                          <span className="block truncate">
                            {category}
                            {group ? ` ${group.items.length}` : ""}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                  {skillSelectionError ? (
                    <div className="border-t border-[var(--app-border-soft)] px-3 py-2 text-xs text-[var(--app-danger)]">
                      {skillSelectionError}
                    </div>
                  ) : null}
                </div>
              </>
            )}
          </div>
          {activeGenerationRunId ? (
            <button
              type="button"
              aria-label="停止生成"
              title="停止生成"
              className="absolute right-3 bottom-3 inline-flex h-10 w-10 items-center justify-center rounded-full border border-[var(--app-danger-border)] bg-[var(--app-danger)] text-white transition-colors hover:bg-[var(--app-danger-text-strong)] disabled:cursor-not-allowed disabled:opacity-60"
              disabled={cancelMutation.isPending}
              onClick={() => {
                if (!activeGenerationRunId || cancellingRunId) return;
                setCancellingRunId(activeGenerationRunId);
                void cancelMutation
                  .mutateAsync({ runId: activeGenerationRunId })
                  .catch(() => undefined);
              }}
            >
              <StopIcon className="h-5 w-5" />
            </button>
          ) : (
            <button
              type="button"
              aria-label="发送消息"
              title="发送"
              className="absolute right-3 bottom-3 inline-flex h-10 w-10 items-center justify-center rounded-full border border-[var(--app-primary-border)] bg-[var(--app-primary-surface)] text-[var(--app-on-primary)] transition-colors hover:bg-[var(--app-primary-surface-hover)] disabled:cursor-not-allowed disabled:border-[var(--app-border-soft)] disabled:bg-[var(--app-bg-raised)] disabled:text-[var(--app-text-soft)]"
              disabled={!canSend || sendMutation.isPending}
              onClick={() => void handleSend()}
            >
              <SendIcon className="h-5 w-5" />
            </button>
          )}
        </div>
      </div>
      {sendMutation.error ? (
        <div className="pointer-events-auto mx-auto mt-3 w-full max-w-[820px] px-1 sm:px-4">
          <InlineNotice
            tone="danger"
            description={sendMutation.error.message}
          />
        </div>
      ) : null}
      {skillsQuery.error ? (
        <div className="pointer-events-auto mx-auto mt-3 w-full max-w-[820px] px-1 sm:px-4">
          <InlineNotice tone="danger" description={skillsQuery.error.message} />
        </div>
      ) : null}
    </div>
  );
  return (
    <>
      {showConversation && selectedConversation ? (
        <section className="pi-agent-conversation fixed top-16 right-0 bottom-[141px] left-0 z-20 bg-transparent lg:top-0">
          <div className="app-scroll mx-auto h-full w-full max-w-[820px] overflow-y-auto px-4 py-6 sm:px-6">
            <div className="grid gap-6">
              {selectedConversation.messages.map((message) => (
                <ChatMessage
                  key={message.id}
                  message={message}
                  liveText={liveMessages[message.id]}
                  lastTargetRef={lastTargetRef}
                  onLastTargetRefChange={setLastTargetRef}
                  onAskOption={(value) => {
                    setPrompt(value);
                    void handleSend(value);
                  }}
                  piAgentHref={`/agent-runtime?conversationId=${encodeURIComponent(
                    selectedConversationId,
                  )}&draft=selection`}
                />
              ))}
              {setupDraft ? (
                <ScheduledTaskPreview
                  draft={setupDraft}
                  busy={activateDraft.isPending}
                  error={activateDraft.error?.message}
                  onConfirm={() =>
                    activateDraft.mutate({
                      taskId: setupDraft.taskId,
                      expectedVersion: setupDraft.version,
                    })
                  }
                />
              ) : null}
              {editDraft ? (
                <ScheduledTaskEditPreview
                  draft={editDraft}
                  busy={confirmEditDraft.isPending}
                  error={confirmEditDraft.error?.message}
                  onConfirm={() =>
                    confirmEditDraft.mutate({
                      draftId: editDraft.id,
                      expectedRevision: editDraft.revision,
                    })
                  }
                />
              ) : null}
              <div ref={messagesEndRef} />
            </div>
          </div>
        </section>
      ) : showConversation &&
        selectedConversationId &&
        conversationQuery.isLoading ? (
        <div className="pi-agent-conversation fixed top-16 right-0 bottom-[141px] left-0 z-20 bg-transparent px-4 py-6 text-center text-sm text-[var(--app-text-muted)] lg:top-0">
          加载中
        </div>
      ) : null}
      {renderComposer()}
    </>
  );
}

export function AgentRuntimeClientPage() {
  const searchParams = useSearchParams();
  const selectedConversationId = searchParams.get("conversationId") ?? "";
  const conversationsQuery = api.agentRuntime.listConversations.useQuery({
    limit: 30,
  });
  const historyItems = useMemo(
    () => buildConversationHistoryItems(conversationsQuery.data?.items ?? []),
    [conversationsQuery.data?.items],
  );

  return (
    <WorkspaceShell
      section="agentRuntime"
      contentWidth="wide"
      historyHeading="对话历史"
      historyItems={historyItems}
      activeHistoryId={selectedConversationId || undefined}
      historyLoading={conversationsQuery.isLoading}
      historyEmptyText="暂无对话历史"
    >
      <PiAgentComposer />
    </WorkspaceShell>
  );
}
