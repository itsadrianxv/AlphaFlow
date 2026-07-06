"use client";

import Link from "next/link";
import { useDeferredValue, useEffect, useMemo, useState } from "react";
import {
  EmptyState,
  InlineNotice,
  SectionCard,
  StatusPill,
  WorkspaceShell,
} from "~/app/_components/ui";
import {
  buildSpaceActionLinks,
  buildSpaceRecentSummaries,
} from "~/app/spaces/space-view-models";
import { buildResearchDigest } from "~/app/workflows/research-view-models";
import { buildRunDetailHref } from "~/app/workflows/run-detail-href";
import { api } from "~/trpc/react";

type SpaceDetailClientProps = {
  spaceId: string;
};

export function SpaceDetailClient({ spaceId }: SpaceDetailClientProps) {
  const [search, setSearch] = useState("");
  const deferredSearch = useDeferredValue(search.trim());
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [researchGoal, setResearchGoal] = useState("");
  const [coreThesis, setCoreThesis] = useState("");
  const [keyQuestions, setKeyQuestions] = useState("");
  const [focusDimensions, setFocusDimensions] = useState("");
  const [notes, setNotes] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const utils = api.useUtils();

  const detailQuery = api.space.getDetail.useQuery(
    { spaceId },
    { refetchOnWindowFocus: false },
  );
  const runLinksQuery = api.space.listRunLinks.useQuery(
    {
      spaceId,
      limit: 50,
      offset: 0,
      search: deferredSearch || undefined,
    },
    { refetchOnWindowFocus: false },
  );

  const updateMetaMutation = api.space.updateMeta.useMutation({
    onSuccess: async () => {
      setNotice("空间元信息已更新。");
      await utils.space.getDetail.invalidate({ spaceId });
    },
  });
  const updateBriefMutation = api.space.updateBrief.useMutation({
    onSuccess: async () => {
      setNotice("Space brief 已更新。");
      await utils.space.getDetail.invalidate({ spaceId });
    },
  });
  const unlinkWatchlistMutation = api.space.unlinkWatchlist.useMutation({
    onSuccess: async () => {
      await utils.space.getDetail.invalidate({ spaceId });
    },
  });
  const unlinkStockMutation = api.space.unlinkStock.useMutation({
    onSuccess: async () => {
      await utils.space.getDetail.invalidate({ spaceId });
    },
  });
  const removeRunMutation = api.space.removeRun.useMutation({
    onSuccess: async () => {
      await Promise.all([
        utils.space.getDetail.invalidate({ spaceId }),
        utils.space.listRunLinks.invalidate({
          spaceId,
          limit: 50,
          offset: 0,
        }),
      ]);
    },
  });

  useEffect(() => {
    if (!detailQuery.data) {
      return;
    }

    setName(detailQuery.data.name);
    setDescription(detailQuery.data.description ?? "");
    setResearchGoal(detailQuery.data.brief.researchGoal);
    setCoreThesis(detailQuery.data.brief.coreThesis);
    setKeyQuestions(detailQuery.data.brief.keyQuestions.join("\n"));
    setFocusDimensions(detailQuery.data.brief.focusDimensions.join("\n"));
    setNotes(detailQuery.data.brief.notes);
  }, [detailQuery.data]);

  const actionLinks = useMemo(
    () =>
      detailQuery.data
        ? buildSpaceActionLinks({
            spaceId,
            brief: detailQuery.data.brief,
            stocks: detailQuery.data.stocks,
            watchLists: detailQuery.data.watchLists,
          })
        : null,
    [detailQuery.data, spaceId],
  );
  const recentSummaries = useMemo(
    () =>
      buildSpaceRecentSummaries({
        runLinks: detailQuery.data?.recentSuccessfulRunLinks ?? [],
      }),
    [detailQuery.data?.recentSuccessfulRunLinks],
  );

  return (
    <WorkspaceShell
      section="spaces"
      eyebrow="Research Space"
      title={detailQuery.data?.name ?? "研究空间"}
      description={
        detailQuery.data?.description ??
        "按 thesis 聚合 session、标的与快捷发起入口。"
      }
      actions={
        <>
          <Link href="/spaces" className="app-button">
            返回空间列表
          </Link>
          {actionLinks ? (
            <>
              <Link
                href={actionLinks.industryResearchHref}
                className="app-button app-button-primary"
              >
                行业研究
              </Link>
              {actionLinks.companyResearchHref ? (
                <Link
                  href={actionLinks.companyResearchHref}
                  className="app-button"
                >
                  公司研究
                </Link>
              ) : null}
              <Link href={actionLinks.screeningHref} className="app-button">
                筛选
              </Link>
              <Link href={actionLinks.timingHref} className="app-button">
                择时
              </Link>
            </>
          ) : null}
        </>
      }
    >
      {notice ? <InlineNotice tone="success" description={notice} /> : null}

      {!detailQuery.data ? (
        <EmptyState
          title={
            detailQuery.isLoading ? "正在加载 Research Space" : "未找到该空间"
          }
          description={detailQuery.error?.message}
        />
      ) : (
        <div className="grid gap-6 xl:grid-cols-[minmax(0,1.1fr)_360px]">
          <div className="grid gap-6">
            <SectionCard
              title="Pinned Brief"
              description="Space v1 的首屏以 thesis 为先，后续发起都会基于这里预填。"
              actions={
                <button
                  type="button"
                  onClick={() =>
                    void updateBriefMutation.mutateAsync({
                      spaceId,
                      brief: {
                        researchGoal: researchGoal.trim(),
                        coreThesis: coreThesis.trim(),
                        keyQuestions: keyQuestions
                          .split("\n")
                          .map((item) => item.trim())
                          .filter(Boolean),
                        focusDimensions: focusDimensions
                          .split("\n")
                          .map((item) => item.trim())
                          .filter(Boolean),
                        notes: notes.trim(),
                      },
                    })
                  }
                  className="app-button app-button-primary"
                >
                  保存 brief
                </button>
              }
            >
              <div className="grid gap-3">
                <input
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  placeholder="空间名称"
                  className="app-input"
                />
                <input
                  value={description}
                  onChange={(event) => setDescription(event.target.value)}
                  placeholder="空间说明"
                  className="app-input"
                />
                <button
                  type="button"
                  onClick={() =>
                    void updateMetaMutation.mutateAsync({
                      spaceId,
                      name: name.trim(),
                      description: description.trim() || null,
                    })
                  }
                  className="app-button"
                >
                  保存名称与说明
                </button>
                <textarea
                  value={researchGoal}
                  onChange={(event) => setResearchGoal(event.target.value)}
                  placeholder="研究目标"
                  className="app-textarea min-h-[90px]"
                />
                <textarea
                  value={coreThesis}
                  onChange={(event) => setCoreThesis(event.target.value)}
                  placeholder="Core thesis"
                  className="app-textarea min-h-[140px]"
                />
                <textarea
                  value={keyQuestions}
                  onChange={(event) => setKeyQuestions(event.target.value)}
                  placeholder="关键问题，每行一条"
                  className="app-textarea min-h-[110px]"
                />
                <textarea
                  value={focusDimensions}
                  onChange={(event) => setFocusDimensions(event.target.value)}
                  placeholder="关注维度，每行一条"
                  className="app-textarea min-h-[110px]"
                />
                <textarea
                  value={notes}
                  onChange={(event) => setNotes(event.target.value)}
                  placeholder="补充说明"
                  className="app-textarea min-h-[110px]"
                />
              </div>
            </SectionCard>

            <SectionCard
              title="Session Timeline"
              description="只展示被手动加入当前 Space 的 run；删除关联不会影响原始 run 本体。"
            >
              <div className="grid gap-3">
                <input
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="搜索 run 标题、模板、状态或归档备注"
                  className="app-input"
                />
                {runLinksQuery.isLoading ? (
                  <EmptyState title="正在加载 timeline" />
                ) : (runLinksQuery.data?.items ?? []).length === 0 ? (
                  <EmptyState title="该 Space 还没有归档的 session" />
                ) : (
                  (runLinksQuery.data?.items ?? []).map((item) => {
                    const digest = buildResearchDigest({
                      templateCode: item.run.templateCode,
                      query: item.run.query,
                      status: item.run.status,
                      progressPercent: item.run.progressPercent,
                      currentNodeKey: item.run.currentNodeKey,
                    });

                    return (
                      <article
                        key={item.id}
                        className="rounded-[14px] border border-[var(--app-border-soft)] bg-[var(--app-surface)] p-4"
                      >
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-2">
                              <StatusPill
                                label={digest.templateLabel}
                                tone="info"
                              />
                              <StatusPill
                                label={item.run.status}
                                tone="neutral"
                              />
                            </div>
                            <h3 className="mt-3 text-lg text-[var(--app-text-strong)]">
                              {item.run.query}
                            </h3>
                            <p className="mt-2 text-sm leading-6 text-[var(--app-text-muted)]">
                              {item.note || digest.summary}
                            </p>
                          </div>
                          <div className="flex flex-wrap gap-2">
                            <Link
                              href={buildRunDetailHref({
                                runId: item.run.id,
                                templateCode: item.run.templateCode,
                              })}
                              className="app-button app-button-primary"
                            >
                              查看详情
                            </Link>
                            <button
                              type="button"
                              onClick={() =>
                                void removeRunMutation.mutateAsync({
                                  spaceId,
                                  runId: item.run.id,
                                })
                              }
                              className="app-button"
                            >
                              移出 Space
                            </button>
                          </div>
                        </div>
                      </article>
                    );
                  })
                )}
              </div>
            </SectionCard>
          </div>

          <div className="grid gap-6">
            <SectionCard title="Linked Targets">
              <div className="grid gap-3">
                <div>
                  <div className="mb-2 text-xs text-[var(--app-text-subtle)]">
                    关联 watchlists
                  </div>
                  {detailQuery.data.watchLists.length === 0 ? (
                    <p className="text-sm text-[var(--app-text-muted)]">
                      暂无关联
                    </p>
                  ) : (
                    detailQuery.data.watchLists.map((item) => (
                      <div
                        key={item.id}
                        className="mb-2 flex items-center justify-between gap-3 rounded-[12px] border border-[var(--app-border-soft)] px-3 py-2"
                      >
                        <span className="text-sm text-[var(--app-text)]">
                          {item.name}
                        </span>
                        <button
                          type="button"
                          onClick={() =>
                            void unlinkWatchlistMutation.mutateAsync({
                              spaceId,
                              watchListId: item.watchListId,
                            })
                          }
                          className="app-button"
                        >
                          解除关联
                        </button>
                      </div>
                    ))
                  )}
                </div>

                <div>
                  <div className="mb-2 text-xs text-[var(--app-text-subtle)]">
                    关联股票
                  </div>
                  {detailQuery.data.stocks.length === 0 ? (
                    <p className="text-sm text-[var(--app-text-muted)]">
                      暂无关联
                    </p>
                  ) : (
                    detailQuery.data.stocks.map((item) => (
                      <div
                        key={item.id}
                        className="mb-2 flex items-center justify-between gap-3 rounded-[12px] border border-[var(--app-border-soft)] px-3 py-2"
                      >
                        <span className="text-sm text-[var(--app-text)]">
                          {item.stockName} · {item.stockCode}
                        </span>
                        <button
                          type="button"
                          onClick={() =>
                            void unlinkStockMutation.mutateAsync({
                              spaceId,
                              stockCode: item.stockCode,
                            })
                          }
                          className="app-button"
                        >
                          解除关联
                        </button>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </SectionCard>

            <SectionCard
              title="Recent Conclusions"
              description="只取当前 Space 下最近成功归档的 runs 自动生成。"
            >
              {recentSummaries.length === 0 ? (
                <EmptyState title="还没有可展示的成功结论" />
              ) : (
                <div className="grid gap-3">
                  {recentSummaries.map((summary) => (
                    <article
                      key={summary.runId}
                      className="rounded-[14px] border border-[var(--app-border-soft)] bg-[var(--app-surface)] p-4"
                    >
                      <div className="flex flex-wrap items-center gap-2">
                        <StatusPill label={summary.templateCode} tone="info" />
                      </div>
                      <h3 className="mt-3 text-base text-[var(--app-text-strong)]">
                        {summary.title}
                      </h3>
                      <p className="mt-2 text-sm leading-6 text-[var(--app-text-muted)]">
                        {summary.note || summary.summary}
                      </p>
                    </article>
                  ))}
                </div>
              )}
            </SectionCard>
          </div>
        </div>
      )}
    </WorkspaceShell>
  );
}
