"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { MarkdownContent } from "~/app/_components/markdown-content";
import {
  cn,
  EmptyState,
  InlineNotice,
  StatusPill,
  WorkspaceShell,
} from "~/app/_components/ui";
import type { WorkspaceHistoryItem } from "~/app/_components/workspace-shell";
import { api, type RouterOutputs } from "~/trpc/react";

type Conversation = NonNullable<
  RouterOutputs["agentRuntime"]["getConversation"]
>;
type Message = Conversation["messages"][number];
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

function ChatMessage(props: { message: Message; liveText?: string }) {
  const { message, liveText } = props;
  const isUser = message.role === "USER";
  const content = messageText(message, liveText);

  return (
    <div className={cn("flex", isUser ? "justify-end" : "justify-start")}>
      <div
        className={cn(
          "max-w-[min(760px,92%)] rounded-[10px] border px-4 py-3",
          isUser
            ? "border-[var(--app-accent)] bg-[var(--app-accent)] text-white"
            : "border-[var(--app-border-soft)] bg-[var(--app-bg-inset)] text-[var(--app-text-strong)]",
        )}
      >
        <div className="mb-2 flex items-center gap-2">
          <span className="text-xs font-medium">
            {isUser ? "你" : "Pi Agent"}
          </span>
          {message.skillId ? (
            <span
              className={cn(
                "text-xs",
                isUser ? "text-white/80" : "text-[var(--app-text-subtle)]",
              )}
            >
              {message.skillId}
            </span>
          ) : null}
          {!isUser && message.status !== "SUCCEEDED" ? (
            <StatusPill
              tone={statusTone[message.status]}
              label={statusLabel[message.status]}
            />
          ) : null}
        </div>
        {content ? (
          isUser ? (
            <div className="whitespace-pre-wrap text-sm leading-6">
              {content}
            </div>
          ) : (
            <MarkdownContent content={content} />
          )
        ) : (
          <div className="text-sm text-[var(--app-text-subtle)]">
            正在准备回复
          </div>
        )}
        {message.errorMessage ? (
          <div className="mt-3 text-sm text-[var(--app-danger)]">
            {message.errorMessage}
          </div>
        ) : null}
      </div>
    </div>
  );
}

export function AgentRuntimeClientPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const selectedConversationId = searchParams.get("conversationId") ?? "";
  const utils = api.useUtils();
  const [skillId, setSkillId] = useState("");
  const [prompt, setPrompt] = useState("");
  const [liveMessages, setLiveMessages] = useState<Record<string, string>>({});
  const [activeRunId, setActiveRunId] = useState("");
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
    if (!skillId && firstSkill) {
      setSkillId(firstSkill);
    }
  }, [skillId, skillsQuery.data?.items]);

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

  const canSend = Boolean(skillId && prompt.trim() && !runningRunId);

  const handleSend = async () => {
    if (!canSend) {
      return;
    }
    await sendMutation.mutateAsync({
      conversationId: selectedConversationId || undefined,
      skillId,
      prompt,
      title: prompt.trim().slice(0, 80),
    });
  };

  return (
    <WorkspaceShell
      section="agentRuntime"
      title="Pi Agent"
      historyItems={historyItems}
      historyHref="/agent-runtime"
      historyLoading={conversationsQuery.isLoading}
      historyEmptyText="还没有 Pi Agent 对话"
      activeHistoryId={selectedConversationId}
      actions={
        <>
          <Link href="/agent-runtime" className="app-button">
            新对话
          </Link>
          <Link href="/workflows" className="app-button">
            运行记录
          </Link>
        </>
      }
      contentWidth="wide"
      titleSize="compact"
    >
      <div className="flex min-h-[calc(100vh-150px)] flex-col">
        {runningRunId ? (
          <div className="mb-3 flex justify-end">
            <button
              type="button"
              className="app-button app-button-danger"
              disabled={cancelMutation.isPending}
              onClick={() => cancelMutation.mutate({ runId: runningRunId })}
            >
              停止
            </button>
          </div>
        ) : null}

        <div className="flex-1 overflow-y-auto pb-5">
          {selectedConversation ? (
            <div className="grid gap-4">
              {selectedConversation.messages.map((message) => (
                <ChatMessage
                  key={message.id}
                  message={message}
                  liveText={liveMessages[message.id]}
                />
              ))}
              <div ref={messagesEndRef} />
            </div>
          ) : selectedConversationId && conversationQuery.isLoading ? (
            <div className="text-sm text-[var(--app-text-muted)]">加载中</div>
          ) : (
            <EmptyState title="开始一次 Pi Agent 对话" />
          )}
        </div>

        <div className="sticky bottom-0 border-t border-[var(--app-border-soft)] bg-[var(--app-bg)] py-4">
          <div className="mb-3 flex flex-wrap items-center gap-3">
            <select
              value={skillId}
              onChange={(event) => setSkillId(event.target.value)}
              className="max-w-[280px]"
            >
              {(skillsQuery.data?.items ?? []).map((skill) => (
                <option key={skill.id} value={skill.id}>
                  {skill.name}
                </option>
              ))}
            </select>
            {runningRunId ? <StatusPill tone="info" label="正在生成" /> : null}
          </div>
          <div className="flex gap-3">
            <textarea
              className="app-textarea min-h-[72px] flex-1 resize-none"
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
            <button
              type="button"
              className="app-button app-button-primary self-end"
              disabled={!canSend || sendMutation.isPending}
              onClick={handleSend}
            >
              {sendMutation.isPending ? "发送中" : "发送"}
            </button>
          </div>
          {sendMutation.error ? (
            <div className="mt-3">
              <InlineNotice
                tone="danger"
                description={sendMutation.error.message}
              />
            </div>
          ) : null}
          {skillsQuery.error ? (
            <div className="mt-3">
              <InlineNotice
                tone="danger"
                description={skillsQuery.error.message}
              />
            </div>
          ) : null}
        </div>
      </div>
    </WorkspaceShell>
  );
}
