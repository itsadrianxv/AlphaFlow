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

const selectableTargetTypes = ["industry", "company", "watchlist"] as const;
type SelectableTargetType = (typeof selectableTargetTypes)[number];
type CreateMode = SelectableTargetType;

const researchTargetViewTabs: WorkflowStageTab[] = [
  {
    id: "industry",
    label: "收藏行业",
    summary: "",
  },
  {
    id: "company",
    label: "收藏公司",
    summary: "",
  },
  {
    id: "watchlist",
    label: "自选股",
    summary: "",
  },
];

function splitTags(value: string) {
  return value
    .split(/[,，、\n]/)
    .map((item) => item.trim())
    .filter(Boolean);
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

function parseSerializedRef(
  value: string | null,
): (ResearchTargetRef & { type: SelectableTargetType }) | null {
  if (!value) {
    return null;
  }

  const [type, id] = value.split(":");
  if (!type || !id || !isSelectableTargetType(type)) {
    return null;
  }
  return { type, id };
}

function parseTargetType(value: string | null): SelectableTargetType | null {
  return value && isSelectableTargetType(value) ? value : null;
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

function sameTargetRef(left: ResearchTargetRef, right: ResearchTargetRef) {
  return left.type === right.type && left.id === right.id;
}

function TargetContentList(props: {
  targets: TargetSummary[];
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
}) {
  const {
    targets,
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
  } = props;

  if (targets.length === 0) {
    return (
      <Panel title="对象内容">
        <EmptyState
          title="当前分类还没有投研对象"
          description="可以点击右上角“新建”，先创建收藏行业、收藏公司或自选股列表。"
        />
      </Panel>
    );
  }

  return (
    <div className="grid gap-6">
      {targets.map((target) => {
        const targetNotes = notes.filter((note) =>
          sameTargetRef(note.targetRef, target.ref),
        );
        const targetSnapshots = snapshots.filter((snapshot) =>
          sameTargetRef(snapshot.targetRef, target.ref),
        );
        const targetArtifacts = artifacts.filter((artifact) =>
          sameTargetRef(artifact.targetRef, target.ref),
        );
        const showNotes = notesLoading || targetNotes.length > 0;
        const showSnapshots = snapshotsLoading || targetSnapshots.length > 0;
        const showArtifacts = artifactsLoading || targetArtifacts.length > 0;
        const targetKey = serializeRef(target.ref);

        return (
          <Panel
            key={targetKey}
            title={target.label}
            description={target.description || "暂无说明"}
            actions={
              <div className="flex flex-wrap gap-2">
                {target.ref.type === "watchlist" ? (
                  <>
                    <Link
                      href={`/watchlists/${target.ref.id}`}
                      className="app-button app-button-primary"
                    >
                      打开列表
                    </Link>
                    <Link
                      href={`/timing?watchListId=${target.ref.id}`}
                      className="app-button"
                    >
                      去择时
                    </Link>
                  </>
                ) : null}
              </div>
            }
          >
            <div className="grid gap-4">
              {target.tags.length > 0 ? (
                <div className="flex flex-wrap gap-2">
                  {target.tags.map((tag) => (
                    <StatusPill key={tag} label={tag} tone="neutral" />
                  ))}
                </div>
              ) : null}

              {showNotes ? (
                <section className="grid gap-3 border-t border-[var(--app-border-soft)] pt-4">
                  <h3 className="font-[family-name:var(--font-heading)] text-sm text-[var(--app-text-strong)]">
                    最近笔记
                  </h3>
                  {notesLoading ? (
                    <EmptyState title="正在加载笔记" />
                  ) : (
                    <div className="grid gap-4">
                      {targetNotes.map((note) => (
                        <div key={note.id} className="grid gap-2">
                          {note.title ? (
                            <p className="text-sm text-[var(--app-text-muted)]">
                              {note.title}
                            </p>
                          ) : null}
                          <EditableMarkdownBlock
                            content={note.contentMarkdown}
                            saving={noteSaving}
                            onSave={(content) => onSaveNote(note, content)}
                          />
                        </div>
                      ))}
                    </div>
                  )}
                </section>
              ) : null}

              {showSnapshots ? (
                <section className="grid gap-3 border-t border-[var(--app-border-soft)] pt-4">
                  <h3 className="font-[family-name:var(--font-heading)] text-sm text-[var(--app-text-strong)]">
                    财务快照
                  </h3>
                  {snapshotsLoading ? (
                    <EmptyState title="正在加载财务快照" />
                  ) : (
                    <div className="grid gap-3">
                      {targetSnapshots.map((snapshot) => (
                        <div key={snapshot.id}>
                          <p className="text-sm text-[var(--app-text-strong)]">
                            {snapshot.companyRefs
                              .map(
                                (item) =>
                                  `${item.stockName}(${item.stockCode})`,
                              )
                              .join("、") || "未记录公司"}
                          </p>
                        </div>
                      ))}
                    </div>
                  )}
                </section>
              ) : null}

              {showArtifacts ? (
                <section className="grid gap-3 border-t border-[var(--app-border-soft)] pt-4">
                  <h3 className="font-[family-name:var(--font-heading)] text-sm text-[var(--app-text-strong)]">
                    研究报告
                  </h3>
                  {artifactsLoading ? (
                    <EmptyState title="正在加载研究报告" />
                  ) : (
                    <div className="grid gap-4">
                      {targetArtifacts.map((artifact) => (
                        <div key={artifact.id} className="grid gap-2">
                          <p className="text-sm text-[var(--app-text-muted)]">
                            {artifact.title}
                          </p>
                          <EditableMarkdownBlock
                            content={artifactMarkdown(artifact)}
                            compact={false}
                            saving={artifactSaving}
                            onSave={(content) =>
                              onSaveArtifact(artifact, content)
                            }
                          />
                        </div>
                      ))}
                    </div>
                  )}
                </section>
              ) : null}
            </div>
          </Panel>
        );
      })}
    </div>
  );
}

export function ResearchTargetsClient() {
  const utils = api.useUtils();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [createOpen, setCreateOpen] = useState(false);
  const [activeTargetType, setActiveTargetType] =
    useState<SelectableTargetType>(
      () =>
        parseSerializedRef(searchParams.get("target"))?.type ??
        parseTargetType(searchParams.get("type")) ??
        "industry",
    );
  const [createMode, setCreateMode] = useState<CreateMode>(activeTargetType);
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
  const requestedType = parseTargetType(searchParams.get("type"));
  const requestedKey = requestedTargetRef
    ? serializeRef(requestedTargetRef)
    : null;

  useEffect(() => {
    if (requestedTargetRef) {
      setActiveTargetType(requestedTargetRef.type);
      return;
    }

    if (requestedType) {
      setActiveTargetType(requestedType);
    }
  }, [requestedTargetRef, requestedType]);

  const visibleTargets = targets.filter(
    (target) => target.ref.type === activeTargetType,
  );
  const activeHistoryTarget =
    visibleTargets.find(
      (target) => serializeRef(target.ref) === requestedKey,
    ) ?? null;
  const selectedKey = activeHistoryTarget
    ? serializeRef(activeHistoryTarget.ref)
    : "";
  const historyItems = visibleTargets.map((target) => ({
    id: serializeRef(target.ref),
    title: `[${targetTypeLabel(target.ref.type)}] ${target.label}`,
    href: `/research-targets?target=${encodeURIComponent(serializeRef(target.ref))}`,
  }));

  function handleTargetTypeChange(tabId: string) {
    if (!isSelectableTargetType(tabId)) {
      return;
    }

    setActiveTargetType(tabId);
    setCreateMode(tabId);
    const firstTarget = targets.find((target) => target.ref.type === tabId);

    if (firstTarget) {
      router.push(
        `/research-targets?target=${encodeURIComponent(
          serializeRef(firstTarget.ref),
        )}`,
      );
      return;
    }

    router.push(`/research-targets?type=${tabId}`);
  }

  const notesQuery = api.researchTarget.listNotes.useQuery(
    {
      limit: 100,
      offset: 0,
    },
    { enabled: visibleTargets.length > 0 },
  );
  const snapshotsQuery = api.researchTarget.listFinancialSnapshots.useQuery(
    {
      limit: 100,
      offset: 0,
    },
    { enabled: visibleTargets.length > 0 },
  );
  const artifactsQuery = api.researchTarget.listArtifacts.useQuery(
    {
      limit: 100,
      offset: 0,
    },
    { enabled: visibleTargets.length > 0 },
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
          onClick={() => {
            setCreateMode(activeTargetType);
            setCreateOpen((current) => !current);
          }}
        >
          新建
        </button>
      }
      showWatchlistsAction={false}
    >
      <WorkflowStageSwitcher
        tabs={researchTargetViewTabs}
        activeTabId={activeTargetType}
        onChange={handleTargetTypeChange}
        panels={{
          industry: null,
          company: null,
          watchlist: null,
        }}
      />

      <div className="mt-6 grid gap-6">
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

        <TargetContentList
          targets={visibleTargets}
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
        />
      </div>
    </WorkspaceShell>
  );
}
