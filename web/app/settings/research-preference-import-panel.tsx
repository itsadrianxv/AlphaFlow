"use client";

import { BookmarkPlus, RefreshCw, X } from "lucide-react";
import { useEffect, useId, useMemo, useState } from "react";
import type { ResearchPreferenceImportCandidateSource } from "~/contracts/research-preference";
import { api } from "~/trpc/react";
import {
  beginImportConfirmation,
  buildImportCandidateGroups,
  cancelImportConfirmation,
  createImportState,
  executeResearchPreferenceImport,
  getImportSubmission,
  reconcileImportSelection,
  selectImportGroup,
  toggleImportCandidate,
} from "./research-preference-import-view-model";

export function ResearchPreferenceImportPanel() {
  const headingId = useId();
  const candidatesQuery = api.researchPreference.importCandidates.useQuery();
  const currentQuery = api.researchPreference.current.useQuery();
  const utils = api.useUtils();
  const importMutation = api.researchPreference.import.useMutation();
  const [state, setState] = useState(createImportState);
  const groups = useMemo(
    () =>
      buildImportCandidateGroups(
        candidatesQuery.data ?? [],
        currentQuery.data?.items ?? [],
      ),
    [candidatesQuery.data, currentQuery.data?.items],
  );
  const submission = getImportSubmission(state, groups);
  const loading = candidatesQuery.isLoading || currentQuery.isLoading;
  const loadError = candidatesQuery.error ?? currentQuery.error;
  const allItems = groups.flatMap((group) => group.items);
  const availableItems = allItems.filter((item) => !item.alreadyFollowing);

  useEffect(() => {
    setState((current) => reconcileImportSelection(current, groups));
  }, [groups]);

  async function confirmImport() {
    if (!submission || importMutation.isPending) return;
    const next = await executeResearchPreferenceImport({
      state,
      groups,
      currentItems: currentQuery.data?.items ?? [],
      importTargets: (input) => importMutation.mutateAsync(input),
      refresh: () =>
        Promise.all([
          utils.researchPreference.current.invalidate(),
          utils.researchPreference.importCandidates.invalidate(),
        ]),
    });
    setState(next);
  }

  return (
    <section
      className="app-panel min-w-0 overflow-hidden"
      aria-labelledby={headingId}
    >
      <header className="flex flex-wrap items-start justify-between gap-4 border-b border-[var(--app-border-soft)] px-5 py-5 sm:px-6">
        <div className="min-w-0">
          <h2
            id={headingId}
            className="text-xl font-medium text-[var(--app-text-strong)]"
          >
            从收藏导入研究关注
          </h2>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-[var(--app-text-muted)]">
            选择收藏公司、收藏行业或自选股成员，确认后导入为常规关注。
          </p>
        </div>
        <button
          type="button"
          className="app-button inline-flex items-center gap-2"
          disabled={
            loading || candidatesQuery.isFetching || currentQuery.isFetching
          }
          onClick={() =>
            void Promise.all([
              candidatesQuery.refetch(),
              currentQuery.refetch(),
            ])
          }
        >
          <RefreshCw className="h-4 w-4" aria-hidden="true" />
          重试刷新
        </button>
      </header>

      <div className="px-5 py-5 sm:px-6">
        {loading ? (
          <p className="py-5 text-sm text-[var(--app-text-muted)]">
            正在读取收藏与研究关注
          </p>
        ) : loadError ? (
          <div
            className="border-l-2 border-[var(--app-danger)] py-1 pl-4"
            role="alert"
          >
            <p className="text-sm font-medium text-[var(--app-text-strong)]">
              无法读取导入候选
            </p>
            <p className="mt-1 break-words text-sm text-[var(--app-danger)]">
              {loadError.message}
            </p>
          </div>
        ) : allItems.length === 0 ? (
          <p className="py-5 text-sm leading-6 text-[var(--app-text-muted)]">
            暂无收藏公司、收藏行业或自选股成员可供导入。
          </p>
        ) : availableItems.length === 0 ? (
          <p className="py-5 text-sm leading-6 text-[var(--app-text-muted)]">
            当前收藏对象均已成为研究关注。
          </p>
        ) : (
          <div className="divide-y divide-[var(--app-border-soft)] border-y border-[var(--app-border-soft)]">
            {groups.map((group) => {
              const selectable = group.items.filter(
                (item) => !item.alreadyFollowing,
              );
              const selectedCount = selectable.filter((item) =>
                state.selectedKeys.includes(item.key),
              ).length;
              const allSelected =
                selectable.length > 0 && selectedCount === selectable.length;

              return (
                <section key={group.id} className="py-4">
                  <div className="mb-2 flex min-h-9 flex-wrap items-center justify-between gap-2">
                    <h3 className="text-base font-medium text-[var(--app-text-strong)]">
                      {group.label}（{group.items.length}）
                    </h3>
                    <button
                      type="button"
                      className="app-button"
                      disabled={
                        selectable.length === 0 || importMutation.isPending
                      }
                      onClick={() =>
                        setState((current) =>
                          selectImportGroup(current, group, !allSelected),
                        )
                      }
                    >
                      {allSelected ? "清空本组" : "全选本组"}
                    </button>
                  </div>
                  <div className="divide-y divide-[var(--app-border-soft)]">
                    {group.items.map((item) => (
                      <label
                        key={item.key}
                        className={`grid min-w-0 grid-cols-[20px_minmax(0,1fr)] gap-3 py-3 ${
                          item.alreadyFollowing
                            ? "cursor-not-allowed opacity-60"
                            : "cursor-pointer"
                        }`}
                      >
                        <input
                          type="checkbox"
                          className="mt-0.5 h-4 w-4 accent-[var(--app-primary)]"
                          checked={
                            !item.alreadyFollowing &&
                            state.selectedKeys.includes(item.key)
                          }
                          disabled={
                            item.alreadyFollowing || importMutation.isPending
                          }
                          onChange={() =>
                            setState((current) =>
                              toggleImportCandidate(current, item.key),
                            )
                          }
                        />
                        <span className="min-w-0">
                          <span className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-1">
                            <span className="font-medium text-[var(--app-text-strong)]">
                              {item.label}
                            </span>
                            <span className="break-all font-mono text-xs text-[var(--app-text-subtle)]">
                              {item.targetKey}
                            </span>
                            {item.alreadyFollowing ? (
                              <span className="text-xs text-[var(--app-text-muted)]">
                                已关注
                              </span>
                            ) : null}
                          </span>
                          <span className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs leading-5 text-[var(--app-text-muted)]">
                            {item.sources.map((source) => (
                              <span
                                key={`${source.source}:${source.name ?? ""}`}
                              >
                                {sourceLabel(source)}
                              </span>
                            ))}
                          </span>
                        </span>
                      </label>
                    ))}
                  </div>
                </section>
              );
            })}
          </div>
        )}

        {state.importedCount !== null ? (
          <output className="mt-4 block text-sm text-[var(--app-success)]">
            {state.importedCount > 0
              ? `已导入 ${state.importedCount} 个常规关注。`
              : "所选对象已在研究关注中，未重复新增。"}
          </output>
        ) : null}

        <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-[var(--app-text-muted)]">
            已选择 {state.selectedKeys.length} 个对象
          </p>
          <button
            type="button"
            className="app-button app-button-primary inline-flex items-center gap-2"
            disabled={
              state.selectedKeys.length === 0 ||
              importMutation.isPending ||
              state.confirmationOpen
            }
            onClick={() => {
              setState((current) => {
                const reconciled = reconcileImportSelection(current, groups);
                return beginImportConfirmation(reconciled, crypto.randomUUID());
              });
            }}
          >
            <BookmarkPlus className="h-4 w-4" aria-hidden="true" />
            导入研究关注
          </button>
        </div>
      </div>

      {state.confirmationOpen && submission ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-[var(--app-overlay)] px-4 py-8"
          role="presentation"
        >
          <div
            className="max-h-full w-full max-w-xl overflow-y-auto rounded-[8px] border border-[var(--app-border-strong)] bg-[var(--app-panel-strong)]"
            role="dialog"
            aria-modal="true"
            aria-labelledby={`${headingId}-confirmation`}
          >
            <header className="flex items-start justify-between gap-4 border-b border-[var(--app-border-soft)] px-5 py-4 sm:px-6">
              <div>
                <h3
                  id={`${headingId}-confirmation`}
                  className="text-lg font-medium text-[var(--app-text-strong)]"
                >
                  确认导入研究关注
                </h3>
                <p className="mt-1 text-sm text-[var(--app-text-muted)]">
                  公司 {submission.summary.companies} 个，行业{" "}
                  {submission.summary.industries} 个
                </p>
              </div>
              <button
                type="button"
                className="app-button grid h-9 w-9 place-items-center p-0"
                aria-label="关闭确认层"
                title="关闭"
                disabled={importMutation.isPending}
                onClick={() => setState(cancelImportConfirmation)}
              >
                <X className="h-4 w-4" aria-hidden="true" />
              </button>
            </header>
            <div className="space-y-4 px-5 py-5 text-sm leading-6 text-[var(--app-text-muted)] sm:px-6">
              <p>
                导入后全部默认为常规关注，可影响个性化研究雷达、研究收件箱和定时简报。
              </p>
              <p>
                本次导入不会触发紧急提醒。只有之后由你主动提升为重点关注，并同时满足系统的重要性、置信度和信息增量门槛，才可能取得紧急提醒资格。
              </p>
              <p>研究关注不代表持仓、投资评级或投资建议。</p>
              {state.errorMessage ? (
                <p
                  className="break-words border-l-2 border-[var(--app-danger)] pl-3 text-[var(--app-danger)]"
                  role="alert"
                >
                  {state.errorMessage}
                </p>
              ) : null}
            </div>
            <footer className="flex flex-wrap justify-end gap-2 border-t border-[var(--app-border-soft)] px-5 py-4 sm:px-6">
              <button
                type="button"
                className="app-button"
                disabled={importMutation.isPending}
                onClick={() => setState(cancelImportConfirmation)}
              >
                取消
              </button>
              <button
                type="button"
                className="app-button app-button-primary"
                disabled={importMutation.isPending}
                onClick={() => void confirmImport()}
              >
                {importMutation.isPending
                  ? "正在导入"
                  : state.errorMessage
                    ? "重试导入"
                    : `确认导入 ${submission.summary.total} 个对象`}
              </button>
            </footer>
          </div>
        </div>
      ) : null}
    </section>
  );
}

function sourceLabel(source: ResearchPreferenceImportCandidateSource) {
  if (source.source === "SAVED_COMPANY") return "收藏公司";
  if (source.source === "SAVED_INDUSTRY") return "收藏行业";
  return source.name ? `自选股 · ${source.name}` : "自选股";
}
