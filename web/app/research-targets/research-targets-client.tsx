"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { MarkdownContent } from "~/app/_components/markdown-content";
import {
  EmptyState,
  InlineNotice,
  Panel,
  StatusPill,
  WorkspaceShell,
} from "~/app/_components/ui";
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
type CreateMode = SelectableTargetType;

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

function parseSerializedRef(value: string | null): ResearchTargetRef | null {
  if (!value) {
    return null;
  }

  const [type, id] = value.split(":");
  if (!type || !id || !isSelectableTargetType(type)) {
    return null;
  }
  return { type, id };
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
  );
}

function UnifiedCreatePanel(props: {
  mode: CreateMode;
  setMode: (mode: CreateMode) => void;
  onClose: () => void;
  stockCode: string;
  setStockCode: (value: string) => void;
  companyName: string;
  setCompanyName: (value: string) => void;
  companyReason: string;
  setCompanyReason: (value: string) => void;
  companyTags: string;
  setCompanyTags: (value: string) => void;
  companyPending: boolean;
  onCreateCompany: () => void;
  industryName: string;
  setIndustryName: (value: string) => void;
  industrySource: string;
  setIndustrySource: (value: string) => void;
  industryReason: string;
  setIndustryReason: (value: string) => void;
  industryTags: string;
  setIndustryTags: (value: string) => void;
  industryPending: boolean;
  onCreateIndustry: () => void;
  watchlistName: string;
  setWatchlistName: (value: string) => void;
  watchlistDescription: string;
  setWatchlistDescription: (value: string) => void;
  watchlistPending: boolean;
  onCreateWatchlist: () => void;
}) {
  return (
    <Panel
      title="新建投研对象"
      actions={
        <button type="button" className="app-button" onClick={props.onClose}>
          关闭
        </button>
      }
    >
      <div className="grid gap-4">
        <label className="grid gap-2 text-sm text-[var(--app-text-muted)]">
          类型
          <select
            value={props.mode}
            onChange={(event) => {
              if (isSelectableTargetType(event.target.value)) {
                props.setMode(event.target.value);
              }
            }}
            className="app-input"
          >
            <option value="company">收藏公司</option>
            <option value="industry">收藏行业</option>
            <option value="watchlist">自选股</option>
          </select>
        </label>

        {props.mode === "company" ? (
          <CompanyCreateForm
            stockCode={props.stockCode}
            setStockCode={props.setStockCode}
            companyName={props.companyName}
            setCompanyName={props.setCompanyName}
            companyReason={props.companyReason}
            setCompanyReason={props.setCompanyReason}
            companyTags={props.companyTags}
            setCompanyTags={props.setCompanyTags}
            pending={props.companyPending}
            onSubmit={props.onCreateCompany}
          />
        ) : null}

        {props.mode === "industry" ? (
          <IndustryCreateForm
            industryName={props.industryName}
            setIndustryName={props.setIndustryName}
            industrySource={props.industrySource}
            setIndustrySource={props.setIndustrySource}
            industryReason={props.industryReason}
            setIndustryReason={props.setIndustryReason}
            industryTags={props.industryTags}
            setIndustryTags={props.setIndustryTags}
            pending={props.industryPending}
            onSubmit={props.onCreateIndustry}
          />
        ) : null}

        {props.mode === "watchlist" ? (
          <WatchlistCreateForm
            name={props.watchlistName}
            setName={props.setWatchlistName}
            description={props.watchlistDescription}
            setDescription={props.setWatchlistDescription}
            pending={props.watchlistPending}
            onSubmit={props.onCreateWatchlist}
          />
        ) : null}
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
  const router = useRouter();
  const searchParams = useSearchParams();
  const [createOpen, setCreateOpen] = useState(false);
  const [createMode, setCreateMode] = useState<CreateMode>("company");
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
    types: ["company", "industry", "watchlist"],
    limit: 100,
  });
  const targets = useMemo(() => targetsQuery.data ?? [], [targetsQuery.data]);
  const requestedTargetRef = parseSerializedRef(searchParams.get("target"));
  const requestedKey = requestedTargetRef
    ? serializeRef(requestedTargetRef)
    : null;
  const selectedTarget =
    targets.find((target) => serializeRef(target.ref) === requestedKey) ??
    targets[0] ??
    null;
  const selectedTargetRef = selectedTarget?.ref ?? null;
  const selectedKey = selectedTarget ? serializeRef(selectedTarget.ref) : "";
  const historyItems = targets.map((target) => ({
    id: serializeRef(target.ref),
    title: `[${targetTypeLabel(target.ref.type)}] ${target.label}`,
    href: `/research-targets?target=${encodeURIComponent(serializeRef(target.ref))}`,
  }));

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
      setCreateOpen(false);
      router.push(
        `/research-targets?target=${encodeURIComponent(
          serializeRef({ type: "company", id: created.id }),
        )}`,
      );
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
      setCreateOpen(false);
      router.push(
        `/research-targets?target=${encodeURIComponent(
          serializeRef({ type: "industry", id: created.id }),
        )}`,
      );
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
      setCreateOpen(false);
      router.push(
        `/research-targets?target=${encodeURIComponent(
          serializeRef({ type: "watchlist", id: created.id }),
        )}`,
      );
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

  return (
    <WorkspaceShell
      section="researchTargets"
      contentWidth="wide"
      titleSize="compact"
      historyHeading="投研对象"
      historyItems={historyItems}
      activeHistoryId={selectedKey}
      historyItemLimit={100}
      historyLoading={targetsQuery.isLoading}
      historyEmptyText="暂无投研对象"
      actions={
        <button
          type="button"
          className="app-button app-button-primary"
          onClick={() => setCreateOpen((current) => !current)}
        >
          新建
        </button>
      }
      showWatchlistsAction={false}
    >
      <div className="grid gap-6">
        {createOpen ? (
          <UnifiedCreatePanel
            mode={createMode}
            setMode={setCreateMode}
            onClose={() => setCreateOpen(false)}
            stockCode={stockCode}
            setStockCode={setStockCode}
            companyName={companyName}
            setCompanyName={setCompanyName}
            companyReason={companyReason}
            setCompanyReason={setCompanyReason}
            companyTags={companyTags}
            setCompanyTags={setCompanyTags}
            companyPending={createCompanyMutation.isPending}
            onCreateCompany={() =>
              createCompanyMutation.mutate({
                stockCode,
                companyName: companyName.trim(),
                reason: companyReason.trim() || undefined,
                tags: splitTags(companyTags),
              })
            }
            industryName={industryName}
            setIndustryName={setIndustryName}
            industrySource={industrySource}
            setIndustrySource={setIndustrySource}
            industryReason={industryReason}
            setIndustryReason={setIndustryReason}
            industryTags={industryTags}
            setIndustryTags={setIndustryTags}
            industryPending={createIndustryMutation.isPending}
            onCreateIndustry={() =>
              createIndustryMutation.mutate({
                name: industryName.trim(),
                source: industrySource.trim() || "自定义主题",
                reason: industryReason.trim() || undefined,
                tags: splitTags(industryTags),
              })
            }
            watchlistName={watchlistName}
            setWatchlistName={setWatchlistName}
            watchlistDescription={watchlistDescription}
            setWatchlistDescription={setWatchlistDescription}
            watchlistPending={createWatchlistMutation.isPending}
            onCreateWatchlist={() =>
              createWatchlistMutation.mutate({
                name: watchlistName.trim(),
                description: watchlistDescription.trim() || undefined,
              })
            }
          />
        ) : null}

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
