"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import React, { type ReactNode } from "react";
import { api, type RouterOutputs } from "~/platform/trpc/react";
import {
  ActionStrip,
  EmptyState,
  InlineNotice,
  StatusPill,
  WorkspaceShell,
} from "~/shared/ui/primitives/ui";

type SpaceSummary = RouterOutputs["research"]["spaces"]["list"][number];

export type SpaceCardSummary = {
  id: SpaceSummary["id"];
  name: SpaceSummary["name"];
  description: SpaceSummary["description"];
  brief: Pick<SpaceSummary["brief"], "coreThesis">;
  runCount: SpaceSummary["runCount"];
  watchListCount: SpaceSummary["watchListCount"];
  stockCount: SpaceSummary["stockCount"];
};

export type CreateSpaceFormValues = {
  name: string;
  description: string;
  researchGoal: string;
  coreThesis: string;
  keyQuestions: string;
  focusDimensions: string;
  notes: string;
  archiveNote: string;
};

const emptyCreateSpaceFormValues: CreateSpaceFormValues = {
  name: "",
  description: "",
  researchGoal: "",
  coreThesis: "",
  keyQuestions: "",
  focusDimensions: "",
  notes: "",
  archiveNote: "",
};

const createSpaceFieldIds = {
  name: "create-space-name",
  description: "create-space-description",
  researchGoal: "create-space-research-goal",
  coreThesis: "create-space-core-thesis",
  keyQuestions: "create-space-key-questions",
  focusDimensions: "create-space-focus-dimensions",
  notes: "create-space-notes",
  archiveNote: "create-space-archive-note",
} as const;

function parseDelimitedParam(value: string | null) {
  return value
    ? value
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean)
    : [];
}

function parsePendingStocks(searchParams: URLSearchParams) {
  const stockCodes = parseDelimitedParam(searchParams.get("stockCodes"));
  const stockNames = parseDelimitedParam(searchParams.get("stockNames"));

  return stockCodes.map((stockCode, index) => ({
    stockCode,
    stockName: stockNames[index] ?? stockCode,
  }));
}

function DialogField(props: {
  label: string;
  htmlFor: string;
  children: ReactNode;
}) {
  const { label, htmlFor, children } = props;

  return (
    <div className="grid gap-2 text-sm text-[var(--app-text-muted)]">
      <label
        htmlFor={htmlFor}
        className="font-medium text-[var(--app-text-strong)]"
      >
        {label}
      </label>
      {children}
    </div>
  );
}

export function SpacesHeaderActions(props: { onOpenCreate: () => void }) {
  const { onOpenCreate } = props;

  return (
    <>
      <button
        type="button"
        onClick={onOpenCreate}
        className="app-button app-button-primary"
      >
        创建 Research Space
      </button>
      <Link href="/watchlists" className="app-button">
        打开自选股列表
      </Link>
    </>
  );
}

export function ResearchSpacesListSection(props: {
  isLoading: boolean;
  spaces: SpaceCardSummary[];
  pendingContext: boolean;
  onAttachPendingContext: (spaceId: string) => void;
  createAction: ReactNode;
}) {
  const {
    isLoading,
    spaces,
    pendingContext,
    onAttachPendingContext,
    createAction,
  } = props;

  return (
    <section className="grid gap-4" data-space-list-layout="plain">
      <div className="grid gap-2">
        <div className="font-[family-name:var(--font-heading)] text-[24px] leading-none text-[var(--app-text-strong)]">
          已有研究空间
        </div>
        <p className="max-w-3xl text-sm leading-6 text-[var(--app-text-muted)]">
          Space 是长期研究容器。运行记录、自选股和股票需要你主动归档或关联，避免
          thesis 被短期会话稀释。
        </p>
      </div>

      {isLoading ? (
        <EmptyState title="正在加载研究空间" />
      ) : spaces.length === 0 ? (
        <EmptyState
          title="还没有 Research Space"
          description="先创建一个长期研究容器，再把 thesis、关键问题和归档上下文沉淀进去。"
          actions={createAction}
        />
      ) : (
        <div className="grid gap-4">
          {spaces.map((space) => (
            <article
              key={space.id}
              className="rounded-[16px] border border-[var(--app-border-soft)] bg-[var(--app-surface)] p-5 transition-colors hover:border-[var(--app-border-strong)]"
            >
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <StatusPill label={`${space.runCount} runs`} tone="info" />
                    <StatusPill
                      label={`${space.watchListCount} watchlists`}
                      tone="neutral"
                    />
                    <StatusPill
                      label={`${space.stockCount} stocks`}
                      tone="success"
                    />
                  </div>
                  <h2 className="mt-3 text-xl text-[var(--app-text-strong)]">
                    {space.name}
                  </h2>
                  <p className="mt-2 text-sm leading-6 text-[var(--app-text-muted)]">
                    {space.brief.coreThesis ||
                      space.description ||
                      "暂无 thesis 摘要"}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Link
                    href={`/research/spaces/${space.id}`}
                    className="app-button app-button-primary"
                  >
                    打开空间
                  </Link>
                  {pendingContext ? (
                    <button
                      type="button"
                      onClick={() => onAttachPendingContext(space.id)}
                      className="app-button"
                    >
                      加入当前上下文
                    </button>
                  ) : null}
                </div>
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}

export function CreateSpaceDialog(props: {
  open: boolean;
  pending: boolean;
  showArchiveNote: boolean;
  values: CreateSpaceFormValues;
  onValueChange: (field: keyof CreateSpaceFormValues, value: string) => void;
  onClose: () => void;
  onSubmit: () => void;
}) {
  const {
    open,
    pending,
    showArchiveNote,
    values,
    onValueChange,
    onClose,
    onSubmit,
  } = props;

  React.useEffect(() => {
    if (!open || typeof document === "undefined") {
      return;
    }

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !pending) {
        event.preventDefault();
        onClose();
      }
    };

    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open, pending, onClose]);

  if (!open) {
    return null;
  }

  function handleRequestClose() {
    if (!pending) {
      onClose();
    }
  }

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!pending && values.name.trim()) {
      onSubmit();
    }
  }

  return (
    <div className="fixed inset-0 z-[70] p-4 sm:p-6">
      <button
        type="button"
        aria-label="关闭创建 Research Space 弹窗"
        disabled={pending}
        onClick={handleRequestClose}
        className="absolute inset-0 bg-[rgba(0,0,0,0.76)] backdrop-blur-sm"
      />

      <div className="relative mx-auto flex h-full max-w-3xl items-center justify-center">
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="create-space-dialog-title"
          aria-describedby="create-space-dialog-description"
          aria-busy={pending}
          className="relative flex max-h-full w-full flex-col overflow-hidden rounded-[24px] border border-[var(--app-border-soft)] bg-[var(--app-sidebar-bg)] shadow-[var(--app-shadow-lg)]"
        >
          <div className="flex items-start justify-between gap-4 border-b border-[var(--app-border-soft)] px-5 py-4 sm:px-6">
            <div className="min-w-0">
              <h2
                id="create-space-dialog-title"
                className="font-[family-name:var(--font-heading)] text-[28px] leading-none text-[var(--app-text-strong)]"
              >
                创建 Research Space
              </h2>
              <p
                id="create-space-dialog-description"
                className="mt-3 max-w-2xl text-sm leading-6 text-[var(--app-text-muted)]"
              >
                用一份半结构化 brief 固化 thesis、关键问题和研究维度，后续再把
                run、自选股和股票持续归档进来。
              </p>
            </div>
            <button
              type="button"
              onClick={handleRequestClose}
              disabled={pending}
              className="app-button shrink-0"
            >
              关闭
            </button>
          </div>

          <form
            onSubmit={handleSubmit}
            className="flex min-h-0 flex-1 flex-col"
          >
            <div className="grid gap-4 overflow-y-auto px-5 py-5 sm:px-6">
              <DialogField
                label="Space 名称"
                htmlFor={createSpaceFieldIds.name}
              >
                <input
                  id={createSpaceFieldIds.name}
                  value={values.name}
                  onChange={(event) =>
                    onValueChange("name", event.target.value)
                  }
                  placeholder="空间名称"
                  className="app-input"
                />
              </DialogField>

              <DialogField
                label="一句话说明"
                htmlFor={createSpaceFieldIds.description}
              >
                <input
                  id={createSpaceFieldIds.description}
                  value={values.description}
                  onChange={(event) =>
                    onValueChange("description", event.target.value)
                  }
                  placeholder="一句话说明"
                  className="app-input"
                />
              </DialogField>

              <DialogField
                label="研究目标"
                htmlFor={createSpaceFieldIds.researchGoal}
              >
                <textarea
                  id={createSpaceFieldIds.researchGoal}
                  value={values.researchGoal}
                  onChange={(event) =>
                    onValueChange("researchGoal", event.target.value)
                  }
                  placeholder="研究目标"
                  className="app-textarea min-h-[90px]"
                />
              </DialogField>

              <DialogField
                label="Core thesis"
                htmlFor={createSpaceFieldIds.coreThesis}
              >
                <textarea
                  id={createSpaceFieldIds.coreThesis}
                  value={values.coreThesis}
                  onChange={(event) =>
                    onValueChange("coreThesis", event.target.value)
                  }
                  placeholder="Core thesis"
                  className="app-textarea min-h-[120px]"
                />
              </DialogField>

              <DialogField
                label="关键问题"
                htmlFor={createSpaceFieldIds.keyQuestions}
              >
                <textarea
                  id={createSpaceFieldIds.keyQuestions}
                  value={values.keyQuestions}
                  onChange={(event) =>
                    onValueChange("keyQuestions", event.target.value)
                  }
                  placeholder="关键问题，每行一条"
                  className="app-textarea min-h-[90px]"
                />
              </DialogField>

              <DialogField
                label="关注维度"
                htmlFor={createSpaceFieldIds.focusDimensions}
              >
                <textarea
                  id={createSpaceFieldIds.focusDimensions}
                  value={values.focusDimensions}
                  onChange={(event) =>
                    onValueChange("focusDimensions", event.target.value)
                  }
                  placeholder="关注维度，每行一条"
                  className="app-textarea min-h-[90px]"
                />
              </DialogField>

              <DialogField label="补充说明" htmlFor={createSpaceFieldIds.notes}>
                <textarea
                  id={createSpaceFieldIds.notes}
                  value={values.notes}
                  onChange={(event) =>
                    onValueChange("notes", event.target.value)
                  }
                  placeholder="补充说明"
                  className="app-textarea min-h-[90px]"
                />
              </DialogField>

              {showArchiveNote ? (
                <DialogField
                  label="可选：这条 run 为什么应该进入这个 Space"
                  htmlFor={createSpaceFieldIds.archiveNote}
                >
                  <textarea
                    id={createSpaceFieldIds.archiveNote}
                    value={values.archiveNote}
                    onChange={(event) =>
                      onValueChange("archiveNote", event.target.value)
                    }
                    placeholder="可选：这条 run 为什么应该进入这个 Space"
                    className="app-textarea min-h-[80px]"
                  />
                </DialogField>
              ) : null}
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[var(--app-border-soft)] px-5 py-4 sm:px-6">
              <p className="text-sm leading-6 text-[var(--app-text-muted)]">
                创建后会保留当前表单结构，并自动刷新研究空间列表。
              </p>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={handleRequestClose}
                  disabled={pending}
                  className="app-button"
                >
                  取消
                </button>
                <button
                  type="submit"
                  disabled={pending || !values.name.trim()}
                  className="app-button app-button-primary"
                >
                  {pending ? "创建中..." : "创建空间"}
                </button>
              </div>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}

export function SpacesClient() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const utils = api.useUtils();
  const [notice, setNotice] = React.useState<string | null>(null);
  const [createDialogOpen, setCreateDialogOpen] = React.useState(false);
  const [formValues, setFormValues] = React.useState<CreateSpaceFormValues>(
    emptyCreateSpaceFormValues,
  );

  const addRunId = searchParams.get("addRunId");
  const watchListId = searchParams.get("watchListId");
  const pendingStocks = React.useMemo(
    () => parsePendingStocks(searchParams),
    [searchParams],
  );

  const spacesQuery = api.research.spaces.list.useQuery({
    limit: 50,
    offset: 0,
  });
  const pendingRunQuery = api.research.runs.getRun.useQuery(
    { runId: addRunId ?? "" },
    {
      enabled: Boolean(addRunId),
      refetchOnWindowFocus: false,
    },
  );
  const pendingWatchListQuery = api.watchlist.getDetail.useQuery(
    { id: watchListId ?? "" },
    {
      enabled: Boolean(watchListId),
      refetchOnWindowFocus: false,
    },
  );

  const createMutation = api.research.spaces.create.useMutation({
    onSuccess: async () => {
      await utils.research.spaces.list.invalidate();
    },
  });
  const addRunMutation = api.research.spaces.addRun.useMutation();
  const linkWatchlistMutation = api.research.spaces.linkWatchlist.useMutation();
  const linkStocksMutation = api.research.spaces.linkStocks.useMutation();

  function updateFormValue(field: keyof CreateSpaceFormValues, value: string) {
    setFormValues((current) => ({
      ...current,
      [field]: value,
    }));
  }

  function resetForm() {
    setFormValues(emptyCreateSpaceFormValues);
  }

  async function attachPendingContext(spaceId: string) {
    if (addRunId) {
      await addRunMutation.mutateAsync({
        spaceId,
        runId: addRunId,
        note: formValues.archiveNote.trim() || undefined,
      });
    }

    if (watchListId) {
      await linkWatchlistMutation.mutateAsync({
        spaceId,
        watchListId,
      });
    }

    if (pendingStocks.length > 0) {
      await linkStocksMutation.mutateAsync({
        spaceId,
        stocks: pendingStocks,
      });
    }

    if (addRunId || watchListId || pendingStocks.length > 0) {
      setNotice("已完成当前待处理上下文的归档或关联。");
      router.replace("/research/spaces");
      await Promise.all([
        utils.research.spaces.list.invalidate(),
        utils.research.spaces.getDetail.invalidate(),
      ]);
    }
  }

  async function handleCreateSpace() {
    const created = await createMutation.mutateAsync({
      name: formValues.name.trim(),
      description: formValues.description.trim() || null,
      brief: {
        researchGoal: formValues.researchGoal.trim(),
        coreThesis: formValues.coreThesis.trim(),
        keyQuestions: formValues.keyQuestions
          .split("\n")
          .map((item) => item.trim())
          .filter(Boolean),
        focusDimensions: formValues.focusDimensions
          .split("\n")
          .map((item) => item.trim())
          .filter(Boolean),
        notes: formValues.notes.trim(),
      },
    });

    resetForm();
    setCreateDialogOpen(false);

    await attachPendingContext(created.id);
  }

  const pendingContext = Boolean(
    pendingRunQuery.data ||
      pendingWatchListQuery.data ||
      pendingStocks.length > 0,
  );
  const spaces = (spacesQuery.data ?? []) as SpaceCardSummary[];

  return (
    <WorkspaceShell
      section="spaces"
      eyebrow="Research Space"
      title="研究空间"
      description="把 thesis、关键问题、关联标的和归档过的 session 聚合到一个长期研究容器里。"
      actions={
        <SpacesHeaderActions onOpenCreate={() => setCreateDialogOpen(true)} />
      }
    >
      {pendingContext ? (
        <ActionStrip
          title="当前有待处理的归档或关联上下文"
          description={
            pendingRunQuery.data
              ? `待加入 Space 的运行记录：${pendingRunQuery.data.query}`
              : pendingWatchListQuery.data
                ? `待关联的自选股列表：${pendingWatchListQuery.data.name}`
                : `待关联的股票：${pendingStocks
                    .map((item) => item.stockName)
                    .join("、")}`
          }
          tone="warning"
        />
      ) : null}

      {addRunId ? (
        <label className="grid gap-2 rounded-[16px] border border-[var(--app-border-soft)] bg-[var(--app-bg-inset)] p-4 text-sm text-[var(--app-text-muted)]">
          <span className="font-medium text-[var(--app-text-strong)]">
            可选：这条 run 为什么应该进入某个 Space
          </span>
          <textarea
            value={formValues.archiveNote}
            onChange={(event) =>
              updateFormValue("archiveNote", event.target.value)
            }
            placeholder="可选：补充一条归档说明，创建新 Space 或加入现有 Space 时都会带上"
            className="app-textarea min-h-[90px]"
          />
        </label>
      ) : null}

      {notice ? <InlineNotice tone="success" description={notice} /> : null}

      <ResearchSpacesListSection
        isLoading={spacesQuery.isLoading}
        spaces={spaces}
        pendingContext={pendingContext}
        onAttachPendingContext={(spaceId) => void attachPendingContext(spaceId)}
        createAction={
          <button
            type="button"
            onClick={() => setCreateDialogOpen(true)}
            className="app-button app-button-primary"
          >
            创建 Research Space
          </button>
        }
      />

      <CreateSpaceDialog
        open={createDialogOpen}
        pending={createMutation.isPending}
        showArchiveNote={Boolean(addRunId)}
        values={formValues}
        onValueChange={updateFormValue}
        onClose={() => setCreateDialogOpen(false)}
        onSubmit={() => void handleCreateSpace()}
      />
    </WorkspaceShell>
  );
}
