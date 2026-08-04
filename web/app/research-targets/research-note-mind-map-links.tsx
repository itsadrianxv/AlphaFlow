"use client";

import {
  ArrowUpRight,
  Maximize2,
  Network,
  RefreshCw,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import {
  MindMapCanvas,
  type MindMapEditorHandle,
} from "~/app/mind-maps/mind-map-editor";
import { normalizeMindMapConfig } from "~/app/mind-maps/mind-map-model";
import type { LinkedMindMapSummary } from "~/contracts/research-target";
import { api } from "~/trpc/react";

const EMBEDDED_MIND_MAP_HEIGHT = 400;

function useEnteredViewport() {
  const rootRef = useRef<HTMLElement>(null);
  const [entered, setEntered] = useState(false);

  useEffect(() => {
    const element = rootRef.current;
    if (!element || entered) return;
    if (typeof IntersectionObserver === "undefined") {
      setEntered(true);
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return;
        setEntered(true);
        observer.disconnect();
      },
      { rootMargin: "200px 0px" },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [entered]);

  return { rootRef, entered };
}

function ViewerState({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="grid place-items-center bg-white px-6 text-center text-sm text-[var(--app-text-muted)]"
      style={{ height: EMBEDDED_MIND_MAP_HEIGHT }}
    >
      {children}
    </div>
  );
}

function LoadedMindMapViewer({ mindMap }: { mindMap: LinkedMindMapSummary }) {
  const canvasRef = useRef<MindMapEditorHandle>(null);
  const query = api.mindMap.get.useQuery({ id: mindMap.id }, { retry: false });

  if (query.isLoading || query.isFetching) {
    return <ViewerState>正在加载思维导图</ViewerState>;
  }

  if (query.isError) {
    const code = (query.error.data as { code?: string } | undefined)?.code;
    if (code === "NOT_FOUND") {
      return <ViewerState>导图不存在或已被删除</ViewerState>;
    }
    return (
      <ViewerState>
        <div className="grid justify-items-center gap-3">
          <span>思维导图加载失败</span>
          <button
            type="button"
            className="app-button"
            onClick={() => void query.refetch()}
          >
            <RefreshCw aria-hidden="true" className="size-4" />
            重试
          </button>
        </div>
      </ViewerState>
    );
  }

  if (!query.data) {
    return <ViewerState>导图不存在或已被删除</ViewerState>;
  }

  return (
    <div className="relative bg-white">
      <div className="absolute right-2 top-2 z-10 flex items-center gap-1 border border-neutral-200 bg-white p-1 shadow-sm">
        <button
          type="button"
          className="inline-flex size-8 items-center justify-center rounded-[6px] text-neutral-600 hover:bg-neutral-100 hover:text-neutral-950"
          aria-label="缩小导图"
          title="缩小"
          onClick={() => canvasRef.current?.zoomOut()}
        >
          <ZoomOut aria-hidden="true" className="size-4" />
        </button>
        <button
          type="button"
          className="inline-flex size-8 items-center justify-center rounded-[6px] text-neutral-600 hover:bg-neutral-100 hover:text-neutral-950"
          aria-label="放大导图"
          title="放大"
          onClick={() => canvasRef.current?.zoomIn()}
        >
          <ZoomIn aria-hidden="true" className="size-4" />
        </button>
        <button
          type="button"
          className="inline-flex size-8 items-center justify-center rounded-[6px] text-neutral-600 hover:bg-neutral-100 hover:text-neutral-950"
          aria-label="适应导图视图"
          title="适应视图"
          onClick={() => canvasRef.current?.fit()}
        >
          <Maximize2 aria-hidden="true" className="size-4" />
        </button>
      </div>
      <MindMapCanvas
        ref={canvasRef}
        data={query.data.data}
        config={normalizeMindMapConfig(query.data.config)}
        readonly
        height={EMBEDDED_MIND_MAP_HEIGHT}
        restoreView={false}
        fitOnReady
        loadingLabel="正在初始化思维导图"
      />
    </div>
  );
}

export function EmbeddedMindMapViewer({
  mindMap,
  enabled,
}: {
  mindMap: LinkedMindMapSummary;
  enabled: boolean;
}) {
  if (!enabled) {
    return <ViewerState>滚动至此加载导图</ViewerState>;
  }
  return <LoadedMindMapViewer mindMap={mindMap} />;
}

export function ResearchNoteMindMapLinks({
  linkedMindMaps,
}: {
  linkedMindMaps: LinkedMindMapSummary[];
}) {
  const [selectedId, setSelectedId] = useState(
    () => linkedMindMaps[0]?.id ?? "",
  );
  const { rootRef, entered } = useEnteredViewport();

  useEffect(() => {
    if (linkedMindMaps.some((mindMap) => mindMap.id === selectedId)) return;
    setSelectedId(linkedMindMaps[0]?.id ?? "");
  }, [linkedMindMaps, selectedId]);

  if (linkedMindMaps.length === 0) {
    return null;
  }

  const selectedMindMap =
    linkedMindMaps.find((mindMap) => mindMap.id === selectedId) ??
    linkedMindMaps[0];
  if (!selectedMindMap) return null;

  return (
    <section
      ref={rootRef}
      className="min-w-0 overflow-hidden border border-[var(--app-border-soft)] bg-[var(--app-panel-strong)]"
      aria-label="关联思维导图"
    >
      <div className="border-b border-[var(--app-border-soft)] px-3 pt-3">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-sm font-medium text-[var(--app-text-strong)]">
            <Network aria-hidden="true" className="size-4" />
            <span>关联思维导图</span>
          </div>
          <Link
            href={`/mind-maps/${selectedMindMap.id}`}
            className="inline-flex size-8 shrink-0 items-center justify-center rounded-[6px] text-[var(--app-text-muted)] hover:bg-[var(--app-hover-surface)] hover:text-[var(--app-text-strong)]"
            aria-label={`打开完整导图：${selectedMindMap.title}`}
            title="打开完整导图"
          >
            <ArrowUpRight aria-hidden="true" className="size-4" />
          </Link>
        </div>
        <div
          className="mt-2 flex min-w-0 gap-4 overflow-x-auto"
          role="tablist"
          aria-label="选择关联思维导图"
        >
          {linkedMindMaps.map((mindMap) => {
            const selected = mindMap.id === selectedMindMap.id;
            return (
              <button
                key={`${mindMap.id}:${mindMap.nodeId ?? "map"}`}
                type="button"
                role="tab"
                aria-selected={selected}
                className={`shrink-0 border-b-2 pb-2 text-sm transition-colors ${
                  selected
                    ? "border-[var(--app-text-strong)] font-medium text-[var(--app-text-strong)]"
                    : "border-transparent text-[var(--app-text-muted)] hover:text-[var(--app-text-strong)]"
                }`}
                onClick={() => setSelectedId(mindMap.id)}
              >
                {mindMap.title}
              </button>
            );
          })}
        </div>
      </div>
      {selectedMindMap.description ? (
        <p className="border-b border-[var(--app-border-soft)] px-3 py-2 text-xs text-[var(--app-text-muted)]">
          {selectedMindMap.description}
        </p>
      ) : null}
      <div role="tabpanel" aria-label={selectedMindMap.title}>
        <EmbeddedMindMapViewer
          key={selectedMindMap.id}
          mindMap={selectedMindMap}
          enabled={entered}
        />
      </div>
    </section>
  );
}
