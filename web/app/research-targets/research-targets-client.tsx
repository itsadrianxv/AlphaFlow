"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { MarkdownContent } from "~/app/_components/markdown-content";
import {
  cn,
  EmptyState,
  InlineNotice,
  Panel,
  StatusPill,
  WorkspaceShell,
} from "~/app/_components/ui";
import type { WorkflowStageTab } from "~/app/_components/workflow-stage-config";
import { WorkflowStageSwitcher } from "~/app/_components/workflow-stage-switcher";
import type {
  ResearchTargetRef,
  ResearchTargetType,
} from "~/contracts/research-target";
import { api, type RouterOutputs } from "~/trpc/react";

type TargetSummary = RouterOutputs["researchTarget"]["listTargets"][number];
type ResearchNote = RouterOutputs["researchTarget"]["listNotes"][number];
type ResearchArtifact =
  RouterOutputs["researchTarget"]["listArtifacts"][number];

const selectableTargetTypes = ["company", "industry", "watchlist"] as const;
type SelectableTargetType = (typeof selectableTargetTypes)[number];

const targetTabs: WorkflowStageTab[] = [
  { id: "company", label: "收藏公司", summary: "" },
  { id: "industry", label: "收藏行业", summary: "" },
  { id: "watchlist", label: "自选股", summary: "" },
];

function splitTags(value: string) {
  return value
    .split(/[,，、\n]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function formatDate(value?: string | null) {
  if (!value) {
    return "-";
  }

  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function targetTypeLabel(type: ResearchTargetType | string) {
  switch (type) {
    case "company":
      return "公司";
    case "industry":
      return "行业";
    case "watchlist":
      return "自选股";
    default:
      return type;
  }
}

function serializeRef(ref: ResearchTargetRef) {
  return `${ref.type}:${ref.id}`;
}

function isSelectableTargetType(value: string): value is SelectableTargetType {
  return selectableTargetTypes.includes(value as SelectableTargetType);
}

function asRecord(value: unknown) {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function artifactMarkdown(artifact: ResearchArtifact) {
  const payload = asRecord(artifact.payload);
  if (typeof payload.markdown === "string") {
    return payload.markdown;
  }
  if (typeof artifact.payload === "string") {
    return artifact.payload;
  }
  return `\`\`\`json\n${JSON.stringify(artifact.payload, null, 2)}\n\`\`\``;
}

function EditableMarkdownBlock(props: {
  content: string;
  compact?: boolean;
  saving?: boolean;
  onSave: (content: string) => Promise<void>;
}) {
  const { content, compact = true, saving = false, onSave } = props;
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(content);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!editing) {
      setDraft(content);
      setError(null);
    }
  }, [content, editing]);

  async function handleSave() {
    const trimmed = draft.trim();
    if (!trimmed) {
      setError("内容不能为空。");
      return;
    }

    try {
      setError(null);
      await onSave(trimmed);
      setEditing(false);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "保存失败。");
    }
  }

  if (editing) {
    return (
      <div className="grid gap-3">
        <textarea
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
              event.preventDefault();
              void handleSave();
            }
          }}
          className="app-textarea min-h-[220px]"
          aria-label="编辑 markdown 内容"
        />
        {error ? <InlineNotice tone="danger" description={error} /> : null}
        <div className="flex flex-wrap justify-end gap-2">
          <button
            type="button"
            className="app-button"
            onClick={() => {
              setDraft(content);
              setEditing(false);
              setError(null);
            }}
            disabled={saving}
          >
            取消
          </button>
          <button
            type="button"
            className="app-button app-button-primary"
            onClick={() => void handleSave()}
            disabled={saving || !draft.trim()}
          >
            {saving ? "保存中..." : "保存"}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="group grid gap-2">
      <button
        type="button"
        className="min-h-[72px] rounded-[12px] border border-transparent p-0 text-left transition-colors hover:border-[var(--app-border-soft)] hover:bg-[var(--app-selection)]"
        onClick={() => setEditing(true)}
      >
        <MarkdownContent content={content} compact={compact} />
      </button>
      <button
        type="button"
        className="app-button justify-self-start opacity-100 sm:opacity-0 sm:transition-opacity sm:group-hover:opacity-100"
        onClick={() => setEditing(true)}
      >
        编辑
      </button>
    </div>
  );
}

function TargetCard(props: {
  target: TargetSummary;
  active: boolean;
  onSelect: () => void;
}) {
  const { target, active, onSelect } = props;

  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        "rounded-[12px] border p-4 text-left transition-colors",
        active
          ? "border-[var(--app-border-strong)] bg-[var(--app-panel-soft)]"
          : "border-[var(--app-border-soft)] bg-[var(--app-surface)] hover:border-[var(--app-border-strong)]",
      )}
    >
      <div className="flex flex-wrap items-center gap-2">
        <StatusPill label={targetTypeLabel(target.ref.type)} tone="info" />
        {target.archived ? <StatusPill label="已归档" tone="warning" /> : null}
      </div>
      <div className="mt-3 text-base font-medium text-[var(--app-text-strong)]">
        {target.label}
      </div>
      <p className="mt-2 line-clamp-2 text-sm leading-6 text-[var(--app-text-muted)]">
        {target.description || "暂无说明"}
      </p>
      <p className="mt-3 text-xs text-[var(--app-text-soft)]">
        更新于 {formatDate(target.updatedAt)}
      </p>
    </button>
  );
}

function CompanyCreateForm(props: {
  stockCode: string;
  setStockCode: (value: string) => void;
  companyName: string;
  setCompanyName: (value: string) => void;
  companyReason: string;
  setCompanyReason: (value: string) => void;
  companyTags: string;
  setCompanyTags: (value: string) => void;
  pending: boolean;
  onSubmit: () => void;
}) {
  return (
    <Panel title="新建收藏公司" density="compact">
      <div className="grid gap-3">
        <div className="grid gap-2 md:grid-cols-[120px_minmax(0,1fr)]">
          <input
            value={props.stockCode}
            onChange={(event) =>
              props.setStockCode(
                event.target.value.replace(/\D/g, "").slice(0, 6),
              )
            }
            placeholder="股票代码"
            className="app-input"
          />
          <input
            value={props.companyName}
            onChange={(event) => props.setCompanyName(event.target.value)}
            placeholder="公司名称"
            className="app-input"
          />
        </div>
        <textarea
          value={props.companyReason}
          onChange={(event) => props.setCompanyReason(event.target.value)}
          placeholder="关注理由"
          className="app-textarea min-h-[80px]"
        />
        <input
          value={props.companyTags}
          onChange={(event) => props.setCompanyTags(event.target.value)}
          placeholder="标签，用逗号分隔"
          className="app-input"
        />
        <button
          type="button"
          className="app-button app-button-primary justify-self-start"
          disabled={
            props.stockCode.length !== 6 ||
            !props.companyName.trim() ||
            props.pending
          }
          onClick={props.onSubmit}
        >
          {props.pending ? "保存中..." : "保存公司"}
        </button>
      </div>
    </Panel>
  );
}

function IndustryCreateForm(props: {
  industryName: string;
  setIndustryName: (value: string) => void;
  industrySource: string;
  setIndustrySource: (value: string) => void;
  industryReason: string;
  setIndustryReason: (value: string) => void;
  industryTags: string;
  setIndustryTags: (value: string) => void;
  pending: boolean;
  onSubmit: () => void;
}) {
  return (
    <Panel title="新建收藏行业" density="compact">
      <div className="grid gap-3">
        <div className="grid gap-2 md:grid-cols-[minmax(0,1fr)_160px]">
          <input
            value={props.industryName}
            onChange={(event) => props.setIndustryName(event.target.value)}
            placeholder="行业或主题"
            className="app-input"
          />
          <input
            value={props.industrySource}
            onChange={(event) => props.setIndustrySource(event.target.value)}
            placeholder="来源"
            className="app-input"
          />
        </div>
        <textarea
          value={props.industryReason}
          onChange={(event) => props.setIndustryReason(event.target.value)}
          placeholder="关注理由"
          className="app-textarea min-h-[80px]"
        />
        <input
          value={props.industryTags}
          onChange={(event) => props.setIndustryTags(event.target.value)}
          placeholder="标签，用逗号分隔"
          className="app-input"
        />
        <button
          type="button"
          className="app-button app-button-primary justify-self-start"
          disabled={!props.industryName.trim() || props.pending}
          onClick={props.onSubmit}
        >
          {props.pending ? "保存中..." : "保存行业"}
        </button>
      </div>
    </Panel>
  );
}

function WatchlistCreateForm(props: {
  name: string;
  setName: (value: string) => void;
  description: string;
  setDescription: (value: string) => void;
  pending: boolean;
  onSubmit: () => void;
}) {
  return (
    <Panel title="新建自选股" density="compact">
      <div className="grid gap-3">
        <input
          value={props.name}
          onChange={(event) => props.setName(event.target.value)}
          placeholder="列表名称"
          className="app-input"
        />
        <input
          value={props.description}
          onChange={(event) => props.setDescription(event.target.value)}
          placeholder="列表说明"
          className="app-input"
        />
        <button
          type="button"
          className="app-button app-button-primary justify-self-start"
          disabled={!props.name.trim() || props.pending}
          onClick={props.onSubmit}
        >
          {props.pending ? "创建中..." : "创建列表"}
        </button>
      </div>
    </Panel>
  );
}

function TargetContentPanel(props: {
  selectedTarget: TargetSummary | null;
  notes: ResearchNote[];
  notesLoading: boolean;
  snapshots: RouterOutputs["researchTarget"]["listFinancialSnapshots"];
  snapshotsLoading: boolean;
  artifacts: ResearchArtifact[];
  artifactsLoading: boolean;
  noteSaving: boolean;
  artifactSaving: boolean;
  onSaveNote: (note: ResearchNote, content: string) => Promise<void>;
  onSaveArtifact: (
    artifact: ResearchArtifact,
    content: string,
  ) => Promise<void>;
  onArchive?: () => void;
  archivePending?: boolean;
}) {
  const {
    selectedTarget,
    notes,
    notesLoading,
    snapshots,
    snapshotsLoading,
    artifacts,
    artifactsLoading,
    noteSaving,
    artifactSaving,
    onSaveNote,
    onSaveArtifact,
    onArchive,
    archivePending = false,
  } = props;

  if (!selectedTarget) {
    return (
      <Panel title="对象内容">
        <EmptyState
          title="还没有选中投研对象"
          description="先从左侧选择收藏公司、收藏行业或自选股，再查看它的笔记、财务快照和研究报告。"
        />
      </Panel>
    );
  }

  return (
    <div className="grid gap-6">
      <Panel
        title={selectedTarget.label}
        description={selectedTarget.description || "暂无说明"}
        actions={
          <div className="flex flex-wrap gap-2">
            {selectedTarget.ref.type === "watchlist" ? (
              <>
                <Link
                  href={`/watchlists/${selectedTarget.ref.id}`}
                  className="app-button app-button-primary"
                >
                  打开列表
                </Link>
                <Link
                  href={`/timing?watchListId=${selectedTarget.ref.id}`}
                  className="app-button"
                >
                  去择时
                </Link>
              </>
            ) : null}
            {onArchive && !selectedTarget.archived ? (
              <button
                type="button"
                className="app-button"
                onClick={onArchive}
                disabled={archivePending}
              >
                {archivePending ? "归档中..." : "归档"}
              </button>
            ) : null}
            {selectedTarget.archived ? (
              <StatusPill label="已归档" tone="warning" />
            ) : null}
          </div>
        }
      >
        <div className="flex flex-wrap gap-2">
          <StatusPill
            label={targetTypeLabel(selectedTarget.ref.type)}
            tone="info"
          />
          <StatusPill
            label={`更新于 ${formatDate(selectedTarget.updatedAt)}`}
            tone="neutral"
          />
          {selectedTarget.tags.map((tag) => (
            <StatusPill key={tag} label={tag} tone="neutral" />
          ))}
        </div>
      </Panel>

      <Panel title="最近笔记">
        <div className="grid gap-3">
          {notesLoading ? (
            <EmptyState title="正在加载笔记" />
          ) : notes.length === 0 ? (
            <EmptyState title="还没有笔记" />
          ) : (
            notes.map((note) => (
              <article
                key={note.id}
                className="rounded-[12px] border border-[var(--app-border-soft)] bg-[var(--app-panel)] p-4"
              >
                <div className="mb-3 flex flex-wrap gap-2">
                  {note.title ? (
                    <StatusPill label={note.title} tone="info" />
                  ) : null}
                  <StatusPill
                    label={formatDate(note.updatedAt)}
                    tone="neutral"
                  />
                </div>
                <EditableMarkdownBlock
                  content={note.contentMarkdown}
                  saving={noteSaving}
                  onSave={(content) => onSaveNote(note, content)}
                />
              </article>
            ))
          )}
        </div>
      </Panel>

      <Panel title="财务快照">
        <div className="grid gap-3">
          {snapshotsLoading ? (
            <EmptyState title="正在加载财务快照" />
          ) : snapshots.length === 0 ? (
            <EmptyState title="还没有财务快照" />
          ) : (
            snapshots.map((snapshot) => (
              <article
                key={snapshot.id}
                className="rounded-[12px] border border-[var(--app-border-soft)] bg-[var(--app-panel)] p-4"
              >
                <p className="text-sm text-[var(--app-text-strong)]">
                  {snapshot.companyRefs
                    .map((item) => `${item.stockName}(${item.stockCode})`)
                    .join("、") || "未记录公司"}
                </p>
                <p className="mt-2 text-xs text-[var(--app-text-soft)]">
                  保存于 {formatDate(snapshot.createdAt)}
                </p>
              </article>
            ))
          )}
        </div>
      </Panel>

      <Panel title="研究报告">
        <div className="grid gap-3">
          {artifactsLoading ? (
            <EmptyState title="正在加载研究报告" />
          ) : artifacts.length === 0 ? (
            <EmptyState title="还没有研究报告" />
          ) : (
            artifacts.map((artifact) => (
              <article
                key={artifact.id}
                className="rounded-[12px] border border-[var(--app-border-soft)] bg-[var(--app-panel)] p-4"
              >
                <div className="mb-3 flex flex-wrap gap-2">
                  <StatusPill label={artifact.title} tone="info" />
                  <StatusPill
                    label={`${artifact.artifactType} · ${formatDate(
                      artifact.updatedAt,
                    )}`}
                    tone="neutral"
                  />
                </div>
                <EditableMarkdownBlock
                  content={artifactMarkdown(artifact)}
                  compact={false}
                  saving={artifactSaving}
                  onSave={(content) => onSaveArtifact(artifact, content)}
                />
              </article>
            ))
          )}
        </div>
      </Panel>
    </div>
  );
}

export function ResearchTargetsClient() {
  const utils = api.useUtils();
  const [activeType, setActiveType] = useState<SelectableTargetType>("company");
  const [selectedKeyByType, setSelectedKeyByType] = useState<
    Record<SelectableTargetType, string | null>
  >({
    company: null,
    industry: null,
    watchlist: null,
  });
  const [stockCode, setStockCode] = useState("");
  const [companyName, setCompanyName] = useState("");
  const [companyReason, setCompanyReason] = useState("");
  const [companyTags, setCompanyTags] = useState("");
  const [industryName, setIndustryName] = useState("");
  const [industrySource, setIndustrySource] = useState("自定义主题");
  const [industryReason, setIndustryReason] = useState("");
  const [industryTags, setIndustryTags] = useState("");
  const [watchlistName, setWatchlistName] = useState("");
  const [watchlistDescription, setWatchlistDescription] = useState("");

  const targetsQuery = api.researchTarget.listTargets.useQuery({
    types: [activeType],
    limit: 100,
  });
  const targets = useMemo(() => targetsQuery.data ?? [], [targetsQuery.data]);
  const selectedKey = selectedKeyByType[activeType];
  const selectedTarget =
    targets.find((target) => serializeRef(target.ref) === selectedKey) ?? null;
  const selectedTargetRef = selectedTarget?.ref ?? null;

  useEffect(() => {
    if (targetsQuery.isLoading) {
      return;
    }

    const currentKey = selectedKeyByType[activeType];
    const currentStillExists = targets.some(
      (target) => serializeRef(target.ref) === currentKey,
    );
    if (currentStillExists) {
      return;
    }

    setSelectedKeyByType((current) => ({
      ...current,
      [activeType]: targets[0] ? serializeRef(targets[0].ref) : null,
    }));
  }, [activeType, selectedKeyByType, targets, targetsQuery.isLoading]);

  const notesQuery = api.researchTarget.listNotes.useQuery(
    {
      targetRef: selectedTargetRef ?? undefined,
      limit: 12,
      offset: 0,
    },
    { enabled: Boolean(selectedTargetRef) },
  );
  const snapshotsQuery = api.researchTarget.listFinancialSnapshots.useQuery(
    {
      targetRef: selectedTargetRef ?? undefined,
      limit: 8,
      offset: 0,
    },
    { enabled: Boolean(selectedTargetRef) },
  );
  const artifactsQuery = api.researchTarget.listArtifacts.useQuery(
    {
      targetRef: selectedTargetRef ?? undefined,
      limit: 8,
      offset: 0,
    },
    { enabled: Boolean(selectedTargetRef) },
  );

  const createCompanyMutation = api.researchTarget.createCompany.useMutation({
    onSuccess: async (created) => {
      setStockCode("");
      setCompanyName("");
      setCompanyReason("");
      setCompanyTags("");
      setSelectedKeyByType((current) => ({
        ...current,
        company: serializeRef({ type: "company", id: created.id }),
      }));
      await Promise.all([
        utils.researchTarget.listCompanies.invalidate(),
        utils.researchTarget.listTargets.invalidate(),
      ]);
    },
  });
  const createIndustryMutation = api.researchTarget.createIndustry.useMutation({
    onSuccess: async (created) => {
      setIndustryName("");
      setIndustryReason("");
      setIndustryTags("");
      setIndustrySource("自定义主题");
      setSelectedKeyByType((current) => ({
        ...current,
        industry: serializeRef({ type: "industry", id: created.id }),
      }));
      await Promise.all([
        utils.researchTarget.listIndustries.invalidate(),
        utils.researchTarget.listTargets.invalidate(),
      ]);
    },
  });
  const createWatchlistMutation = api.watchlist.create.useMutation({
    onSuccess: async (created) => {
      setWatchlistName("");
      setWatchlistDescription("");
      setSelectedKeyByType((current) => ({
        ...current,
        watchlist: serializeRef({ type: "watchlist", id: created.id }),
      }));
      await Promise.all([
        utils.watchlist.list.invalidate(),
        utils.researchTarget.listTargets.invalidate(),
      ]);
    },
  });
  const archiveCompanyMutation = api.researchTarget.archiveCompany.useMutation({
    onSuccess: async () => {
      await Promise.all([
        utils.researchTarget.listCompanies.invalidate(),
        utils.researchTarget.listTargets.invalidate(),
      ]);
    },
  });
  const archiveIndustryMutation =
    api.researchTarget.archiveIndustry.useMutation({
      onSuccess: async () => {
        await Promise.all([
          utils.researchTarget.listIndustries.invalidate(),
          utils.researchTarget.listTargets.invalidate(),
        ]);
      },
    });
  const updateNoteMutation = api.researchTarget.updateNote.useMutation({
    onSuccess: async () => {
      await utils.researchTarget.listNotes.invalidate();
    },
  });
  const updateArtifactMutation = api.researchTarget.updateArtifact.useMutation({
    onSuccess: async () => {
      await utils.researchTarget.listArtifacts.invalidate();
    },
  });

  const emptyTitle =
    activeType === "company"
      ? "还没有收藏公司"
      : activeType === "industry"
        ? "还没有收藏行业"
        : "还没有自选股";

  return (
    <WorkspaceShell
      section="researchTargets"
      title="投研收藏"
      description="统一管理收藏公司、收藏行业和自选股，并在每个对象中沉淀笔记、财务快照与研究报告。"
      contentWidth="wide"
      titleSize="compact"
      actions={null}
      showWatchlistsAction={false}
    >
      <WorkflowStageSwitcher
        tabs={targetTabs}
        activeTabId={activeType}
        onChange={(tabId) => {
          if (isSelectableTargetType(tabId)) {
            setActiveType(tabId);
          }
        }}
        panels={{ company: null, industry: null, watchlist: null }}
      />

      <div className="grid gap-6 xl:grid-cols-[minmax(320px,0.85fr)_minmax(0,1.35fr)]">
        <div className="grid content-start gap-6">
          <Panel title={targetTabs.find((tab) => tab.id === activeType)?.label}>
            <div className="grid gap-3">
              {targetsQuery.isLoading ? (
                <EmptyState title="正在加载投研对象" />
              ) : targets.length === 0 ? (
                <EmptyState title={emptyTitle} />
              ) : (
                targets.map((target) => (
                  <TargetCard
                    key={serializeRef(target.ref)}
                    target={target}
                    active={serializeRef(target.ref) === selectedKey}
                    onSelect={() =>
                      setSelectedKeyByType((current) => ({
                        ...current,
                        [activeType]: serializeRef(target.ref),
                      }))
                    }
                  />
                ))
              )}
            </div>
          </Panel>

          {activeType === "company" ? (
            <CompanyCreateForm
              stockCode={stockCode}
              setStockCode={setStockCode}
              companyName={companyName}
              setCompanyName={setCompanyName}
              companyReason={companyReason}
              setCompanyReason={setCompanyReason}
              companyTags={companyTags}
              setCompanyTags={setCompanyTags}
              pending={createCompanyMutation.isPending}
              onSubmit={() =>
                createCompanyMutation.mutate({
                  stockCode,
                  companyName: companyName.trim(),
                  reason: companyReason.trim() || undefined,
                  tags: splitTags(companyTags),
                })
              }
            />
          ) : null}

          {activeType === "industry" ? (
            <IndustryCreateForm
              industryName={industryName}
              setIndustryName={setIndustryName}
              industrySource={industrySource}
              setIndustrySource={setIndustrySource}
              industryReason={industryReason}
              setIndustryReason={setIndustryReason}
              industryTags={industryTags}
              setIndustryTags={setIndustryTags}
              pending={createIndustryMutation.isPending}
              onSubmit={() =>
                createIndustryMutation.mutate({
                  name: industryName.trim(),
                  source: industrySource.trim() || "自定义主题",
                  reason: industryReason.trim() || undefined,
                  tags: splitTags(industryTags),
                })
              }
            />
          ) : null}

          {activeType === "watchlist" ? (
            <WatchlistCreateForm
              name={watchlistName}
              setName={setWatchlistName}
              description={watchlistDescription}
              setDescription={setWatchlistDescription}
              pending={createWatchlistMutation.isPending}
              onSubmit={() =>
                createWatchlistMutation.mutate({
                  name: watchlistName.trim(),
                  description: watchlistDescription.trim() || undefined,
                })
              }
            />
          ) : null}
        </div>

        <TargetContentPanel
          selectedTarget={selectedTarget}
          notes={notesQuery.data ?? []}
          notesLoading={notesQuery.isLoading}
          snapshots={snapshotsQuery.data ?? []}
          snapshotsLoading={snapshotsQuery.isLoading}
          artifacts={artifactsQuery.data ?? []}
          artifactsLoading={artifactsQuery.isLoading}
          noteSaving={updateNoteMutation.isPending}
          artifactSaving={updateArtifactMutation.isPending}
          onSaveNote={async (note, content) => {
            await updateNoteMutation.mutateAsync({
              id: note.id,
              contentMarkdown: content,
            });
          }}
          onSaveArtifact={async (artifact, content) => {
            await updateArtifactMutation.mutateAsync({
              id: artifact.id,
              markdown: content,
            });
          }}
          onArchive={
            selectedTarget?.ref.type === "company"
              ? () =>
                  archiveCompanyMutation.mutate({
                    id: selectedTarget.ref.id,
                  })
              : selectedTarget?.ref.type === "industry"
                ? () =>
                    archiveIndustryMutation.mutate({
                      id: selectedTarget.ref.id,
                    })
                : undefined
          }
          archivePending={
            archiveCompanyMutation.isPending ||
            archiveIndustryMutation.isPending
          }
        />
      </div>
    </WorkspaceShell>
  );
}
