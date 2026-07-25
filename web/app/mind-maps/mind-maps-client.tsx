"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import {
  EmptyState,
  InlineNotice,
  SectionCard,
  WorkspaceShell,
} from "~/app/_components/ui";
import { api } from "~/trpc/react";

const emptyData = {
  root: { data: { text: "中心主题" }, children: [] },
  layout: "logicalStructure",
  theme: { template: "default", config: {} },
  view: null,
};

export function MindMapsClient() {
  const router = useRouter();
  const utils = api.useUtils();
  const [title, setTitle] = useState("");
  const [error, setError] = useState<string | null>(null);
  const maps = api.mindMap.list.useQuery();
  const create = api.mindMap.create.useMutation({
    onSuccess: async (map) => {
      await utils.mindMap.list.invalidate();
      router.push(`/mind-maps/${map.id}`);
    },
    onError: (nextError) => setError(nextError.message),
  });

  return (
    <WorkspaceShell
      section="mindMaps"
      title="思维导图"
      description="独立记录研究假设、证据和推演路径。"
      actions={
        <form
          className="flex flex-wrap gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            create.mutate({
              title: title.trim() || "未命名思维导图",
              data: emptyData,
            });
          }}
        >
          <input
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            className="app-input w-48"
            placeholder="导图标题"
            aria-label="导图标题"
          />
          <button
            type="submit"
            className="app-button app-button-primary"
            disabled={create.isPending}
          >
            新建导图
          </button>
        </form>
      }
    >
      {error ? <InlineNotice tone="danger" description={error} /> : null}
      <SectionCard title="全部导图">
        {maps.isLoading ? (
          <EmptyState title="正在加载导图" />
        ) : (maps.data ?? []).length === 0 ? (
          <EmptyState
            title="还没有导图"
            description="创建一张导图，开始整理研究思路。"
          />
        ) : (
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {(maps.data ?? []).map((map) => (
              <Link
                key={map.id}
                href={`/mind-maps/${map.id}`}
                className="rounded-[10px] border border-[var(--app-border-soft)] bg-[var(--app-bg-inset)] p-4 transition-colors hover:border-[var(--app-border-strong)]"
              >
                <h2 className="text-base font-medium text-[var(--app-text-strong)]">
                  {map.title}
                </h2>
                <p className="mt-2 line-clamp-2 text-sm text-[var(--app-text-muted)]">
                  {map.description || "暂无描述"}
                </p>
                <div className="mt-4 text-xs text-[var(--app-text-subtle)]">
                  {map.collectionCount} 个关联收藏 · 更新于{" "}
                  {new Date(map.updatedAt).toLocaleString("zh-CN")}
                </div>
              </Link>
            ))}
          </div>
        )}
      </SectionCard>
    </WorkspaceShell>
  );
}
