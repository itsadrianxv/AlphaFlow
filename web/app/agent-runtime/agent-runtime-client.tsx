"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { HighlightToNote } from "~/app/_components/highlight-to-note";
import { MarkdownContent } from "~/app/_components/markdown-content";
import { InlineNotice, StatusPill, WorkspaceShell } from "~/app/_components/ui";
import type { WorkspaceHistoryItem } from "~/app/_components/workspace-shell";
import type { ResearchTargetRef } from "~/contracts/research-target";
import { api, type RouterOutputs } from "~/trpc/react";

type Conversation = NonNullable<
  RouterOutputs["agentRuntime"]["getConversation"]
>;
type Message = Conversation["messages"][number];
type AgentRuntimeSkill =
  RouterOutputs["agentRuntime"]["listSkills"]["items"][number];
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
  SUCCEEDED: "success",
  FAILED: "danger",
  CANCELLED: "warning",
} as const;

const statusLabel = {
  PENDING: "等待中",
  STREAMING: "生成中",
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

function buildHistoryItems(
  conversations: RouterOutputs["agentRuntime"]["listConversations"]["items"],
): WorkspaceHistoryItem[] {
  return conversations.map((conversation) => ({
    id: conversation.id,
    title: conversation.title,
    href: `/agent-runtime?conversationId=${conversation.id}`,
    activeMatchHref: `/agent-runtime?conversationId=${conversation.id}`,
  }));
}

function messageText(message: Message, liveText?: string) {
  return liveText !== undefined ? liveText : message.content;
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

function ChatMessage(props: {
  message: Message;
  liveText?: string;
  lastTargetRef?: ResearchTargetRef | null;
  onLastTargetRefChange?: (targetRef: ResearchTargetRef | null) => void;
}) {
  const { message, liveText } = props;
  const isUser = message.role === "USER";
  const content = messageText(message, liveText);

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
          </HighlightToNote>
        ) : (
          <div className="text-sm text-[var(--app-text-subtle)]">
            正在准备回复
          </div>
        )}
        {message.status !== "SUCCEEDED" ? (
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

export function AgentRuntimeClientPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const selectedConversationId = searchParams.get("conversationId") ?? "";
  const utils = api.useUtils();
  const [selectedSkillIds, setSelectedSkillIds] = useState<string[]>([]);
  const [prompt, setPrompt] = useState("");
  const [liveMessages, setLiveMessages] = useState<Record<string, string>>({});
  const [activeRunId, setActiveRunId] = useState("");
  const [skillMenuOpen, setSkillMenuOpen] = useState(false);
  const [skillSelectionError, setSkillSelectionError] = useState("");
  const [activeSkillCategory, setActiveSkillCategory] =
    useState<string>("市场与题材");
  const [lastTargetRef, setLastTargetRef] = useState<ResearchTargetRef | null>(
    null,
  );
  const skillMenuRef = useRef<HTMLDivElement | null>(null);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const migrationRequestedRef = useRef(false);

  const skillsQuery = api.agentRuntime.listSkills.useQuery();
  const conversationsQuery = api.agentRuntime.listConversations.useQuery({
    limit: 30,
  });
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

  const migrateMutation = api.agentRuntime.ensureLegacyRunsMigrated.useMutation(
    {
      onSuccess: async () => {
        await utils.agentRuntime.listConversations.invalidate({ limit: 30 });
      },
    },
  );

  useEffect(() => {
    if (migrationRequestedRef.current) {
      return;
    }
    migrationRequestedRef.current = true;
    migrateMutation.mutate();
  }, [migrateMutation.mutate]);

  useEffect(() => {
    const firstSkill = skillsQuery.data?.items[0]?.id;
    if (selectedSkillIds.length === 0 && firstSkill) {
      setSelectedSkillIds([firstSkill]);
    }
  }, [selectedSkillIds.length, skillsQuery.data?.items]);

  const selectedConversation = conversationQuery.data;
  const runningRunId = latestRunningRunId(selectedConversation);

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
  ]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ block: "end" });
  });

  const historyItems = useMemo(
    () => buildHistoryItems(conversationsQuery.data?.items ?? []),
    [conversationsQuery.data?.items],
  );
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
    },
  });

  const activeGenerationRunId = runningRunId ?? activeRunId;
  const canSend = Boolean(
    selectedSkillIds.length > 0 && prompt.trim() && !activeGenerationRunId,
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

  const handleSend = async () => {
    if (!canSend) {
      return;
    }
    const primarySkillId = selectedSkillIds[0];
    if (!primarySkillId) {
      return;
    }
    await sendMutation.mutateAsync({
      conversationId: selectedConversationId || undefined,
      skillId: primarySkillId,
      skillIds: selectedSkillIds,
      prompt,
      title: prompt.trim().slice(0, 80),
    });
  };

  const renderComposer = (variant: "centered" | "fixed") => (
    <div
      className={
        variant === "fixed"
          ? "pi-agent-composer fixed right-0 bottom-0 left-0 z-30 border-t border-[var(--app-border-soft)] bg-[var(--app-bg)] py-4"
          : "w-full py-4"
      }
    >
      <div className="mx-auto w-full max-w-[820px] px-1 sm:px-4">
        <div className="mb-3 flex justify-end">
          {activeGenerationRunId ? (
            <StatusPill tone="info" label="正在生成" />
          ) : null}
        </div>
        <div className="relative rounded-[22px] border border-[var(--app-border-soft)] bg-[var(--app-panel-strong)] transition-[border-color,box-shadow,background-color] focus-within:border-[var(--app-accent-strong)] focus-within:bg-[var(--app-bg-elevated)] focus-within:shadow-[0_0_0_3px_rgba(59,158,255,0.16)]">
          <textarea
            className="min-h-[104px] w-full resize-none rounded-[22px] border-0 bg-transparent pt-4 pr-16 pb-16 pl-4 text-[var(--app-text)] outline-none placeholder:text-[var(--app-text-soft)]"
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
            placeholder="输入下一条消息"
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
            <button
              type="button"
              aria-haspopup="menu"
              aria-expanded={skillMenuOpen}
              title="选择 skill"
              className="inline-flex h-10 shrink-0 items-center rounded-full border border-[var(--app-border-soft)] bg-[rgba(255,255,255,0.04)] px-3 text-xs font-medium text-[var(--app-text-subtle)] transition-colors hover:border-[rgba(255,255,255,0.28)] hover:bg-[rgba(255,255,255,0.08)]"
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
                            ? "bg-white text-black"
                            : "text-[var(--app-text-muted)] hover:bg-[rgba(255,255,255,0.08)] hover:text-[var(--app-text-strong)]",
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
                              ? "text-black/68"
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
                          ? "bg-white text-black"
                          : "text-[var(--app-text-subtle)] hover:bg-[rgba(255,255,255,0.08)] hover:text-[var(--app-text-strong)]",
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
          </div>
          {activeGenerationRunId ? (
            <button
              type="button"
              aria-label="停止生成"
              title="停止生成"
              className="absolute right-3 bottom-3 inline-flex h-10 w-10 items-center justify-center rounded-full border border-[rgba(255,255,255,0.18)] bg-[var(--app-danger)] text-white transition-colors hover:bg-[#e6002e] disabled:cursor-not-allowed disabled:opacity-60"
              disabled={cancelMutation.isPending}
              onClick={() =>
                cancelMutation.mutate({ runId: activeGenerationRunId })
              }
            >
              <StopIcon className="h-5 w-5" />
            </button>
          ) : (
            <button
              type="button"
              aria-label="发送消息"
              title="发送"
              className="absolute right-3 bottom-3 inline-flex h-10 w-10 items-center justify-center rounded-full border border-white bg-white text-black transition-colors hover:bg-[rgba(255,255,255,0.86)] disabled:cursor-not-allowed disabled:border-[var(--app-border-soft)] disabled:bg-[var(--app-bg-raised)] disabled:text-[var(--app-text-soft)]"
              disabled={!canSend || sendMutation.isPending}
              onClick={handleSend}
            >
              <SendIcon className="h-5 w-5" />
            </button>
          )}
        </div>
      </div>
      {sendMutation.error ? (
        <div className="mx-auto mt-3 w-full max-w-[820px] px-1 sm:px-4">
          <InlineNotice
            tone="danger"
            description={sendMutation.error.message}
          />
        </div>
      ) : null}
      {skillsQuery.error ? (
        <div className="mx-auto mt-3 w-full max-w-[820px] px-1 sm:px-4">
          <InlineNotice tone="danger" description={skillsQuery.error.message} />
        </div>
      ) : null}
    </div>
  );
  const showCenteredComposer =
    !selectedConversationId && !activeGenerationRunId;

  return (
    <WorkspaceShell
      section="agentRuntime"
      historyItems={historyItems}
      historyHref="/agent-runtime"
      historyLoading={conversationsQuery.isLoading}
      historyEmptyText="还没有 Pi Agent 对话"
      activeHistoryId={selectedConversationId}
      showWatchlistsAction={false}
      contentWidth="wide"
      titleSize="compact"
    >
      <div
        className={[
          "flex min-h-[calc(100vh-150px)] flex-col",
          showCenteredComposer ? "justify-center" : undefined,
        ]
          .filter(Boolean)
          .join(" ")}
      >
        <div
          className={["flex-1", showCenteredComposer ? "hidden" : "pb-[260px]"]
            .filter(Boolean)
            .join(" ")}
        >
          {selectedConversation ? (
            <div className="mx-auto grid w-full max-w-[820px] gap-6 px-1 sm:px-4">
              {selectedConversation.messages.map((message) => (
                <ChatMessage
                  key={message.id}
                  message={message}
                  liveText={liveMessages[message.id]}
                  lastTargetRef={lastTargetRef}
                  onLastTargetRefChange={setLastTargetRef}
                />
              ))}
              <div ref={messagesEndRef} />
            </div>
          ) : selectedConversationId && conversationQuery.isLoading ? (
            <div className="mx-auto w-full max-w-[820px] px-1 text-sm text-[var(--app-text-muted)] sm:px-4">
              加载中
            </div>
          ) : null}
        </div>

        {renderComposer(showCenteredComposer ? "centered" : "fixed")}
      </div>
    </WorkspaceShell>
  );
}
