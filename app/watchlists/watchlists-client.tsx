"use client";

import Link from "next/link";
import { useState } from "react";
import {
  EmptyState,
  InlineNotice,
  SectionCard,
  StatusPill,
  WorkspaceShell,
} from "~/app/_components/ui";
import { api, type RouterOutputs } from "~/trpc/react";

type WatchlistSummary = RouterOutputs["watchlist"]["list"][number];

export function WatchlistsClient() {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const utils = api.useUtils();
  const watchlistsQuery = api.watchlist.list.useQuery({
    limit: 50,
    offset: 0,
    sortBy: "updatedAt",
    sortDirection: "desc",
  });
  const createMutation = api.watchlist.create.useMutation({
    onSuccess: async () => {
      setNotice("自选股列表已创建。");
      setName("");
      setDescription("");
      await utils.watchlist.list.invalidate();
    },
  });

  return (
    <WorkspaceShell
      section="watchlists"
      eyebrow="Watchlists"
      title="自选股列表"
      description="第一版聚焦轻管理和强发起：管理多个列表、选股、多选后触发筛选/研究/择时。"
      showWatchlistsAction={false}
      actions={
        <Link href="/spaces" className="app-button">
          返回研究空间
        </Link>
      }
    >
      {notice ? <InlineNotice tone="success" description={notice} /> : null}

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
        <SectionCard title="所有列表">
          {watchlistsQuery.isLoading ? (
            <EmptyState title="正在加载自选股列表" />
          ) : (watchlistsQuery.data ?? []).length === 0 ? (
            <EmptyState title="还没有任何自选股列表" />
          ) : (
            <div className="grid gap-4">
              {(watchlistsQuery.data ?? []).map((item: WatchlistSummary) => (
                <article
                  key={item.id}
                  className="rounded-[16px] border border-[var(--app-border-soft)] bg-[var(--app-surface)] p-5"
                >
                  <div className="flex flex-wrap items-start justify-between gap-4">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <StatusPill
                          label={`${item.stockCount} stocks`}
                          tone="info"
                        />
                      </div>
                      <h2 className="mt-3 text-xl text-[var(--app-text-strong)]">
                        {item.name}
                      </h2>
                      <p className="mt-2 text-sm leading-6 text-[var(--app-text-muted)]">
                        {item.description ?? "暂无说明"}
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Link
                        href={`/watchlists/${item.id}`}
                        className="app-button app-button-primary"
                      >
                        打开列表
                      </Link>
                      <Link
                        href={`/timing?watchListId=${item.id}`}
                        className="app-button"
                      >
                        去择时
                      </Link>
                    </div>
                  </div>
                </article>
              ))}
            </div>
          )}
        </SectionCard>

        <SectionCard title="新建列表">
          <div className="grid gap-3">
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="列表名称"
              className="app-input"
            />
            <input
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder="列表说明"
              className="app-input"
            />
            <button
              type="button"
              onClick={() =>
                void createMutation.mutateAsync({
                  name: name.trim(),
                  description: description.trim() || undefined,
                })
              }
              disabled={createMutation.isPending || !name.trim()}
              className="app-button app-button-primary"
            >
              {createMutation.isPending ? "创建中..." : "创建列表"}
            </button>
          </div>
        </SectionCard>
      </div>
    </WorkspaceShell>
  );
}
