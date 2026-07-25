"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";

import {
  EmptyState,
  InlineNotice,
  SectionCard,
  WorkspaceShell,
} from "~/app/_components/ui";
import {
  MindMapEditor,
  type MindMapEditorHandle,
} from "~/app/mind-maps/mind-map-editor";
import { api } from "~/trpc/react";

export function MindMapEditorPage({ id }: { id: string }) {
  const editorRef = useRef<MindMapEditorHandle>(null);
  const map = api.mindMap.get.useQuery({ id });
  const collections = api.mindMap.listCollections.useQuery();
  const utils = api.useUtils();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [draftData, setDraftData] = useState<Record<string, unknown> | null>(
    null,
  );
  const [selectedCollections, setSelectedCollections] = useState<string[]>([]);
  const [dirty, setDirty] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    if (!map.data) return;
    setTitle(map.data.title);
    setDescription(map.data.description ?? "");
    setDraftData(map.data.data);
    setSelectedCollections(map.data.collectionIds);
    setDirty(false);
  }, [map.data]);

  useEffect(() => {
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!dirty) return;
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [dirty]);

  const save = api.mindMap.update.useMutation({
    onSuccess: async () => {
      setDirty(false);
      setNotice("导图已保存");
      await Promise.all([
        utils.mindMap.get.invalidate({ id }),
        utils.mindMap.list.invalidate(),
      ]);
    },
    onError: (error) => setNotice(error.message),
  });

  const selected = useMemo(
    () => new Set(selectedCollections),
    [selectedCollections],
  );

  if (map.isLoading) {
    return (
      <WorkspaceShell section="mindMaps" title="思维导图">
        <EmptyState title="正在加载导图" />
      </WorkspaceShell>
    );
  }
  if (!map.data) {
    return (
      <WorkspaceShell section="mindMaps" title="思维导图">
        <EmptyState title="导图不存在" />
      </WorkspaceShell>
    );
  }
  const loadedMap = map.data;

  function handleSave() {
    save.mutate({
      id,
      title: title.trim() || "未命名思维导图",
      description: description.trim() || null,
      data: editorRef.current?.getData() ?? draftData ?? loadedMap.data,
      collectionIds: selectedCollections,
    });
  }

  return (
    <WorkspaceShell
      section="mindMaps"
      title={title || loadedMap.title}
      actions={
        <>
          <Link href="/mind-maps" className="app-button">
            返回导图列表
          </Link>
          <button
            type="button"
            className="app-button app-button-primary"
            onClick={handleSave}
            disabled={save.isPending}
          >
            {save.isPending ? "保存中" : "保存导图"}
          </button>
        </>
      }
    >
      {notice ? (
        <InlineNotice
          tone={save.isError ? "danger" : "success"}
          description={notice}
        />
      ) : null}
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_300px]">
        <SectionCard
          title="画布"
          description={dirty ? "有未保存的编辑" : "所有编辑会在点击保存后写入"}
        >
          <MindMapEditor
            ref={editorRef}
            data={loadedMap.data}
            onChange={(data) => {
              setDraftData(data);
              setDirty(true);
            }}
          />
        </SectionCard>
        <SectionCard title="导图信息">
          <div className="grid gap-4">
            <label className="grid gap-2 text-sm text-[var(--app-text-muted)]">
              标题
              <input
                value={title}
                onChange={(event) => {
                  setTitle(event.target.value);
                  setDirty(true);
                }}
                className="app-input"
              />
            </label>
            <label className="grid gap-2 text-sm text-[var(--app-text-muted)]">
              描述
              <textarea
                value={description}
                onChange={(event) => {
                  setDescription(event.target.value);
                  setDirty(true);
                }}
                className="app-input min-h-24"
              />
            </label>
            <div className="grid gap-2 text-sm text-[var(--app-text-muted)]">
              <span>关联投研收藏</span>
              <div className="grid max-h-64 gap-2 overflow-auto rounded-[8px] border border-[var(--app-border-soft)] p-3">
                {(collections.data ?? []).map((collection) => (
                  <label
                    key={collection.id}
                    className="flex items-center gap-2 text-sm text-[var(--app-text)]"
                  >
                    <input
                      type="checkbox"
                      checked={selected.has(collection.id)}
                      onChange={() => {
                        setSelectedCollections((current) =>
                          current.includes(collection.id)
                            ? current.filter(
                                (idValue) => idValue !== collection.id,
                              )
                            : [...current, collection.id],
                        );
                        setDirty(true);
                      }}
                    />
                    <span>{collection.title}</span>
                  </label>
                ))}
                {(collections.data ?? []).length === 0 ? (
                  <span className="text-xs">暂无统一收藏</span>
                ) : null}
              </div>
            </div>
          </div>
        </SectionCard>
      </div>
    </WorkspaceShell>
  );
}
