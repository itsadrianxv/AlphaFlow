"use client";

import {
  Archive,
  Bookmark,
  Check,
  ChevronRight,
  Inbox,
  RotateCcw,
  ThumbsDown,
  ThumbsUp,
} from "lucide-react";
import { useRef, useState } from "react";
import { WorkspaceShell } from "~/app/_components/workspace-shell";
import styles from "~/app/research-inbox/research-inbox.module.css";
import type { ResearchInboxFilter } from "~/server/domain/research-inbox/types";
import { api, type RouterOutputs } from "~/trpc/react";

type InboxEntry = RouterOutputs["researchInbox"]["list"]["items"][number];

const filters: Array<{
  key: ResearchInboxFilter;
  label: string;
}> = [
  { key: "PENDING", label: "待处理" },
  { key: "UNREAD", label: "未读" },
  { key: "LATER", label: "稍后" },
  { key: "ARCHIVED", label: "归档" },
];

function commandId(prefix: string) {
  return `${prefix}:${crypto.randomUUID()}`;
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(value));
}

function channelLabel(channel: InboxEntry["highestChannel"]) {
  if (channel === "URGENT_ALERT") return "紧急提醒";
  if (channel === "BRIEFING") return "定时简报";
  return "仅站内";
}

function eventStatusLabel(status: string) {
  const labels: Record<string, string> = {
    CONFIRMED: "已确认",
    CORRECTED: "已更正",
    RETRACTED: "已撤回",
    PENDING_VERIFICATION: "待核实",
  };
  return labels[status] ?? status;
}

function IconAction(props: {
  label: string;
  active?: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      className={styles.iconAction}
      data-active={props.active || undefined}
      aria-label={props.label}
      title={props.label}
      disabled={props.disabled}
      onClick={props.onClick}
    >
      {props.children}
    </button>
  );
}

function EntryList(props: {
  items: InboxEntry[];
  selectedId: string | null;
  loading: boolean;
  error: boolean;
  onSelect: (id: string) => void;
}) {
  if (props.loading) {
    return <div className={styles.listMessage}>正在读取研究记录…</div>;
  }
  if (props.error) {
    return (
      <div className={styles.listMessage}>研究记录读取失败，请稍后重试。</div>
    );
  }
  if (props.items.length === 0) {
    return <div className={styles.listMessage}>当前分类没有研究记录。</div>;
  }
  return (
    <div className={styles.entryList}>
      {props.items.map((entry) => (
        <button
          key={entry.id}
          type="button"
          className={styles.entryRow}
          data-selected={entry.id === props.selectedId || undefined}
          onClick={() => props.onSelect(entry.id)}
        >
          <span className={styles.entryTitleRow}>
            {entry.state === "UNREAD" ? (
              <span
                className={styles.unreadMark}
                role="img"
                aria-label="未读"
              />
            ) : null}
            <span className={styles.entryTitle}>{entry.title}</span>
            <ChevronRight size={15} aria-hidden="true" />
          </span>
          <span className={styles.entrySummary}>{entry.summary}</span>
          <span className={styles.entryImportance}>
            重要性 {entry.body.assessments.importance.level}
          </span>
        </button>
      ))}
    </div>
  );
}

function ResearchArticle(props: {
  entry: InboxEntry;
  busy: boolean;
  onState: (state: InboxEntry["state"]) => void;
  onFeedback: (value: "USEFUL" | "NOISE") => void;
}) {
  const { entry } = props;
  const body = entry.body;
  const assessmentItems = [
    ["重要性", body.assessments.importance],
    ["置信度", body.assessments.confidence],
    ["相关性", body.assessments.relevance],
    ["信息增量", body.assessments.informationNovelty],
  ] as const;

  return (
    <article className={styles.article}>
      <header className={styles.articleHeader}>
        <div className={styles.articleMeta}>
          <span>{body.subject.label}</span>
          <span>{eventStatusLabel(body.eventStatus)}</span>
          <span>{channelLabel(entry.highestChannel)}</span>
          <time dateTime={entry.createdAt}>{formatDate(entry.createdAt)}</time>
        </div>
        <h1>{entry.title}</h1>
        <div className={styles.assessmentLine}>
          {assessmentItems.map(([label, assessment]) => (
            <span key={label} title={assessment.reason}>
              {label} {assessment.level}
            </span>
          ))}
        </div>
      </header>

      <div className={styles.actionBar}>
        <IconAction
          label={entry.state === "READ" ? "恢复未读" : "标为已读"}
          active={entry.state === "READ"}
          disabled={props.busy}
          onClick={() =>
            props.onState(entry.state === "READ" ? "UNREAD" : "READ")
          }
        >
          {entry.state === "READ" ? (
            <RotateCcw size={17} />
          ) : (
            <Check size={17} />
          )}
        </IconAction>
        <IconAction
          label={entry.state === "LATER" ? "移出稍后" : "稍后"}
          active={entry.state === "LATER"}
          disabled={props.busy}
          onClick={() =>
            props.onState(entry.state === "LATER" ? "UNREAD" : "LATER")
          }
        >
          <Bookmark size={17} />
        </IconAction>
        <IconAction
          label={entry.state === "ARCHIVED" ? "移出归档" : "归档"}
          active={entry.state === "ARCHIVED"}
          disabled={props.busy}
          onClick={() =>
            props.onState(entry.state === "ARCHIVED" ? "UNREAD" : "ARCHIVED")
          }
        >
          <Archive size={17} />
        </IconAction>
        <span className={styles.actionDivider} />
        <IconAction
          label="有用"
          active={entry.feedback === "USEFUL"}
          disabled={props.busy}
          onClick={() => props.onFeedback("USEFUL")}
        >
          <ThumbsUp size={17} />
        </IconAction>
        <IconAction
          label="噪声"
          active={entry.feedback === "NOISE"}
          disabled={props.busy}
          onClick={() => props.onFeedback("NOISE")}
        >
          <ThumbsDown size={17} />
        </IconAction>
      </div>

      <div className={styles.articleBody}>
        <section>
          <h2>发生了什么</h2>
          {body.facts.map((fact) => (
            <p key={fact}>{fact}</p>
          ))}
        </section>
        <section>
          <h2>对判断的影响</h2>
          <p>{body.impact}</p>
        </section>
        <section>
          <h2>原因</h2>
          {body.reasons.map((reason) => (
            <p key={reason}>{reason}</p>
          ))}
        </section>
        <section>
          <h2>后续观察</h2>
          {body.nextChecks.length > 0 ? (
            <ul>
              {body.nextChecks.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          ) : (
            <p>暂无新的核实条件。</p>
          )}
        </section>
        <section>
          <h2>风险</h2>
          {body.risks.length > 0 ? (
            <ul>
              {body.risks.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          ) : (
            <p>当前没有额外风险项。</p>
          )}
        </section>

        <details className={styles.disclosure}>
          <summary>证据与来源资格 · {body.evidence.length}</summary>
          <div className={styles.disclosureContent}>
            {body.evidence.map((evidence) => (
              <div key={evidence.id} className={styles.traceItem}>
                <div>
                  {evidence.href ? (
                    <a href={evidence.href}>{evidence.source}</a>
                  ) : (
                    evidence.source
                  )}
                  <code>{evidence.id}</code>
                </div>
                <p>{evidence.excerpt}</p>
                <p className={styles.qualification}>{evidence.qualification}</p>
              </div>
            ))}
          </div>
        </details>

        <details className={styles.disclosure}>
          <summary>修订记录 · {body.revisions.length}</summary>
          <div className={styles.disclosureContent}>
            {body.revisions.map((revision) => (
              <div key={revision.id} className={styles.traceItem}>
                <div>
                  {revision.label}
                  <time dateTime={revision.createdAt}>
                    {formatDate(revision.createdAt)}
                  </time>
                </div>
                <p>{revision.summary}</p>
                <code>{revision.id}</code>
              </div>
            ))}
          </div>
        </details>

        <details className={styles.disclosure}>
          <summary>生成与关联记录</summary>
          <div className={styles.systemTrace}>
            <p>{body.aiDisclosure}</p>
            <p>{body.externalCopyStatus}</p>
            {Object.entries(entry.references).map(([label, value]) =>
              value ? (
                <div key={label}>
                  <span>{label}</span>
                  <code>{value}</code>
                </div>
              ) : null,
            )}
          </div>
        </details>
      </div>
    </article>
  );
}

export function ResearchInboxClient() {
  const [filter, setFilter] = useState<ResearchInboxFilter>("PENDING");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const openedIds = useRef(new Set<string>());
  const utils = api.useUtils();
  const pending = api.researchInbox.list.useQuery({ filter: "PENDING" });
  const unread = api.researchInbox.list.useQuery({ filter: "UNREAD" });
  const later = api.researchInbox.list.useQuery({ filter: "LATER" });
  const archived = api.researchInbox.list.useQuery({ filter: "ARCHIVED" });
  const queryByFilter = {
    PENDING: pending,
    UNREAD: unread,
    LATER: later,
    ARCHIVED: archived,
  };
  const activeQuery = queryByFilter[filter];
  const items = activeQuery.data?.items ?? [];
  const selectedListEntry =
    items.find((entry) => entry.id === selectedId) ?? null;
  const detailQuery = api.researchInbox.get.useQuery(
    { entryId: selectedId ?? "" },
    { enabled: Boolean(selectedId) },
  );
  const selected = detailQuery.data ?? selectedListEntry;
  const refresh = () =>
    Promise.all([
      utils.researchInbox.list.invalidate(),
      utils.researchInbox.get.invalidate(),
    ]);
  const openMutation = api.researchInbox.open.useMutation({
    onSuccess: refresh,
    onError: (_error, input) => openedIds.current.delete(input.entryId),
  });
  const stateMutation = api.researchInbox.changeState.useMutation({
    onSuccess: refresh,
  });
  const feedbackMutation = api.researchInbox.setFeedback.useMutation({
    onSuccess: refresh,
  });

  const counts: Record<ResearchInboxFilter, number | undefined> = {
    PENDING: pending.data?.items.length,
    UNREAD: unread.data?.items.length,
    LATER: later.data?.items.length,
    ARCHIVED: archived.data?.items.length,
  };
  const busy =
    openMutation.isPending ||
    stateMutation.isPending ||
    feedbackMutation.isPending;

  return (
    <WorkspaceShell
      section="researchInbox"
      contentMode="editor"
      showHistory={false}
      initialDesktopCollapsed
    >
      <div className={styles.workspace}>
        <aside className={styles.filterRail}>
          <div className={styles.inboxIdentity}>
            <Inbox size={18} />
            <span>研究收件箱</span>
          </div>
          <nav aria-label="研究收件箱分类">
            {filters.map((item) => (
              <button
                key={item.key}
                type="button"
                data-active={filter === item.key || undefined}
                onClick={() => {
                  setFilter(item.key);
                  setSelectedId(null);
                }}
              >
                <span>
                  <strong>{item.label}</strong>
                </span>
                <span className={styles.count}>{counts[item.key] ?? "–"}</span>
              </button>
            ))}
          </nav>
        </aside>

        <section className={styles.listPanel}>
          <header>
            <h2>{filters.find((item) => item.key === filter)?.label}</h2>
            <span>{items.length} 条</span>
          </header>
          <EntryList
            items={items}
            selectedId={selected?.id ?? null}
            loading={activeQuery.isLoading}
            error={activeQuery.isError}
            onSelect={(entryId) => {
              setSelectedId(entryId);
              const entry = items.find((item) => item.id === entryId);
              if (
                entry?.state === "UNREAD" &&
                !openedIds.current.has(entryId)
              ) {
                openedIds.current.add(entryId);
                openMutation.mutate({
                  entryId,
                  commandId: commandId("open"),
                });
              }
            }}
          />
        </section>

        <section className={styles.readingPanel}>
          {selected ? (
            <ResearchArticle
              entry={selected}
              busy={busy}
              onState={(state) =>
                stateMutation.mutate({
                  entryId: selected.id,
                  state,
                  commandId: commandId("state"),
                })
              }
              onFeedback={(value) =>
                feedbackMutation.mutate({
                  entryId: selected.id,
                  value,
                  commandId: commandId("feedback"),
                })
              }
            />
          ) : (
            <div className={styles.emptyReading}>
              <Inbox size={22} />
              <p>选择一条研究记录开始阅读。</p>
            </div>
          )}
        </section>
      </div>
    </WorkspaceShell>
  );
}
