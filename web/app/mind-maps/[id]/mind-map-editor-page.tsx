"use client";

import {
  ArrowLeft,
  Check,
  CircleAlert,
  Image as ImageIcon,
  Link2,
  ListPlus,
  Plus,
  Save,
  StickyNote,
  Tags,
  Trash2,
} from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";

import { EmptyState, WorkspaceShell } from "~/app/_components/ui";
import {
  type MindMapDialogKind,
  MindMapDialogs,
} from "~/app/mind-maps/mind-map-dialogs";
import {
  type MindMapContextMenuState,
  MindMapEditor,
  type MindMapEditorHandle,
  type MindMapHistoryState,
  type MindMapSearchState,
} from "~/app/mind-maps/mind-map-editor";
import {
  DEFAULT_MIND_MAP_CONFIG,
  EMPTY_MIND_MAP_SELECTION,
  type MindMapDocumentData,
  type MindMapEditorConfig,
  type MindMapSaveStatus,
  type MindMapSelection,
  normalizeMindMapConfig,
  normalizeMindMapData,
} from "~/app/mind-maps/mind-map-model";
import { MindMapSaveQueue } from "~/app/mind-maps/mind-map-save-queue";
import { MindMapSidebar } from "~/app/mind-maps/mind-map-sidebar";
import { MindMapToolbar } from "~/app/mind-maps/mind-map-toolbar";
import { api } from "~/trpc/react";

const SAVE_DELAY_MS = 1200;

type MindMapSaveSnapshot = {
  title: string;
  description: string | null;
  data: MindMapDocumentData;
  config: MindMapEditorConfig;
  collectionIds: string[];
};

const SAVE_LABELS: Record<MindMapSaveStatus, string> = {
  saved: "已保存",
  dirty: "未保存",
  saving: "保存中",
  error: "保存失败",
};

function ContextMenu(props: {
  state: MindMapContextMenuState;
  selection: MindMapSelection;
  onCommand: (command: string) => void;
  onDialog: (kind: Exclude<MindMapDialogKind, null>) => void;
  onClose: () => void;
}) {
  const items = [
    ["新增同级节点", ListPlus, "INSERT_NODE", null],
    ["新增子节点", Plus, "INSERT_CHILD_NODE", null],
    ["节点图片", ImageIcon, null, "image"],
    ["节点链接", Link2, null, "link"],
    ["节点备注", StickyNote, null, "note"],
    ["节点标签", Tags, null, "tags"],
    ["删除节点", Trash2, "REMOVE_NODE", null],
  ] as const;
  return (
    <>
      <button
        type="button"
        aria-label="关闭节点菜单"
        className="fixed inset-0 z-40 cursor-default"
        onClick={props.onClose}
      />
      <div
        role="menu"
        className="fixed z-50 grid w-44 gap-1 border border-[var(--app-border)] bg-[var(--app-panel-strong)] p-2 shadow-[var(--app-shadow-lg)]"
        style={{
          left: Math.max(8, props.state.x),
          top: Math.max(8, props.state.y),
        }}
      >
        {items.map(([label, Icon, command, dialog]) => {
          const siblingDisabled =
            command === "INSERT_NODE" && props.selection.hasRoot;
          return (
            <button
              key={label}
              type="button"
              role="menuitem"
              disabled={siblingDisabled}
              onClick={() => {
                if (command) props.onCommand(command);
                if (dialog) props.onDialog(dialog);
                props.onClose();
              }}
              className={`flex cursor-pointer items-center gap-2 rounded-[6px] px-2 py-2 text-left text-sm hover:bg-[var(--app-hover-surface)] disabled:cursor-not-allowed disabled:opacity-35 ${
                command === "REMOVE_NODE"
                  ? "text-[var(--app-danger-text)]"
                  : "text-[var(--app-text)]"
              }`}
            >
              <Icon className="h-4 w-4" />
              {label}
            </button>
          );
        })}
      </div>
    </>
  );
}

export function MindMapEditorPage({ id }: { id: string }) {
  const editorRef = useRef<MindMapEditorHandle>(null);
  const initializedRef = useRef(false);
  const saveQueueRef = useRef(new MindMapSaveQueue<MindMapSaveSnapshot>());
  const titleRef = useRef("");
  const descriptionRef = useRef("");
  const dataRef = useRef<MindMapDocumentData | null>(null);
  const configRef = useRef<MindMapEditorConfig>(DEFAULT_MIND_MAP_CONFIG);
  const collectionsRef = useRef<string[]>([]);
  const flushSaveRef = useRef<() => Promise<void>>(async () => undefined);

  const map = api.mindMap.get.useQuery({ id });
  const collections = api.mindMap.listCollections.useQuery();
  const utils = api.useUtils();
  const saveMutation = api.mindMap.update.useMutation();

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [draftData, setDraftData] = useState<MindMapDocumentData | null>(null);
  const [config, setConfig] = useState<MindMapEditorConfig>(
    DEFAULT_MIND_MAP_CONFIG,
  );
  const [selectedCollections, setSelectedCollections] = useState<string[]>([]);
  const [selection, setSelection] = useState<MindMapSelection>(
    EMPTY_MIND_MAP_SELECTION,
  );
  const [history, setHistory] = useState<MindMapHistoryState>({
    canUndo: false,
    canRedo: false,
  });
  const [scale, setScale] = useState(1);
  const [search, setSearch] = useState<MindMapSearchState>({
    current: 0,
    total: 0,
  });
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchText, setSearchText] = useState("");
  const [panelOpen, setPanelOpen] = useState(true);
  const [painterActive, setPainterActive] = useState(false);
  const [dialog, setDialog] = useState<MindMapDialogKind>(null);
  const [contextMenu, setContextMenu] =
    useState<MindMapContextMenuState | null>(null);
  const [saveStatus, setSaveStatus] = useState<MindMapSaveStatus>("saved");
  const [saveVersion, setSaveVersion] = useState(0);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    if (!map.data || initializedRef.current) return;
    initializedRef.current = true;
    const nextData = normalizeMindMapData(map.data.data);
    const nextConfig = normalizeMindMapConfig(map.data.config);
    setTitle(map.data.title);
    setDescription(map.data.description ?? "");
    setDraftData(nextData);
    setConfig(nextConfig);
    setSelectedCollections(map.data.collectionIds);
    titleRef.current = map.data.title;
    descriptionRef.current = map.data.description ?? "";
    dataRef.current = nextData;
    configRef.current = nextConfig;
    collectionsRef.current = map.data.collectionIds;
  }, [map.data]);

  const markDirty = useCallback(() => {
    saveQueueRef.current.markChanged();
    if (!saveQueueRef.current.isSaving) setSaveStatus("dirty");
    setSaveVersion((current) => current + 1);
    setSaveError(null);
  }, []);

  flushSaveRef.current = async () => {
    if (!initializedRef.current) return;
    await saveQueueRef.current.flush({
      getSnapshot: () => {
        const latestData = editorRef.current?.getData() ?? dataRef.current;
        if (!latestData) throw new Error("导图数据尚未加载");
        dataRef.current = latestData;
        return {
          title: titleRef.current.trim() || "未命名思维导图",
          description: descriptionRef.current.trim() || null,
          data: latestData,
          config: configRef.current,
          collectionIds: collectionsRef.current,
        };
      },
      save: async (snapshot) => {
        const saved = await saveMutation.mutateAsync({ id, ...snapshot });
        utils.mindMap.get.setData({ id }, saved);
        void utils.mindMap.list.invalidate();
        setSaveError(null);
      },
      onStatus: setSaveStatus,
      onError: (error) =>
        setSaveError(error instanceof Error ? error.message : "保存失败"),
    });
  };

  useEffect(() => {
    void saveVersion;
    if (!saveQueueRef.current.hasPending) return;
    const timer = window.setTimeout(() => {
      void flushSaveRef.current();
    }, SAVE_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [saveVersion]);

  useEffect(() => {
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!saveQueueRef.current.hasPending && !saveQueueRef.current.isSaving) {
        return;
      }
      event.preventDefault();
      event.returnValue = "";
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
        event.preventDefault();
        void flushSaveRef.current();
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "f") {
        event.preventDefault();
        setSearchOpen(true);
      }
    };
    window.addEventListener("beforeunload", handleBeforeUnload);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("beforeunload", handleBeforeUnload);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, []);

  useEffect(() => {
    if (!searchOpen) {
      editorRef.current?.endSearch();
      setSearch({ current: 0, total: 0 });
      return;
    }
    const timer = window.setTimeout(() => {
      editorRef.current?.search(searchText);
    }, 180);
    return () => window.clearTimeout(timer);
  }, [searchOpen, searchText]);

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
  if (!initializedRef.current || !draftData) {
    return (
      <WorkspaceShell section="mindMaps" title="思维导图">
        <EmptyState title="正在初始化导图" />
      </WorkspaceShell>
    );
  }

  const updateTitle = (value: string) => {
    setTitle(value);
    titleRef.current = value;
    markDirty();
  };
  const updateDescription = (value: string) => {
    setDescription(value);
    descriptionRef.current = value;
    markDirty();
  };
  const updateConfig = (patch: Partial<MindMapEditorConfig>) => {
    const next = normalizeMindMapConfig({ ...configRef.current, ...patch });
    setConfig(next);
    configRef.current = next;
    editorRef.current?.updateConfig(patch);
    markDirty();
  };
  const updateNodeStyle = (key: string, value: unknown) => {
    editorRef.current?.updateNodeStyle(key, value);
    setSelection((current) => ({
      ...current,
      styles: { ...current.styles, [key]: value },
    }));
  };

  return (
    <WorkspaceShell
      section="mindMaps"
      contentMode="editor"
      contentWidth="wide"
      showHistory={false}
    >
      <div className="flex h-[calc(100dvh-24px)] min-h-[680px] min-w-0 flex-col overflow-hidden border border-[var(--app-border-soft)] bg-[var(--app-panel-strong)] lg:h-[calc(100dvh-32px)]">
        <div className="flex min-h-14 shrink-0 items-center gap-3 border-b border-[var(--app-border-soft)] px-3 sm:px-4">
          <Link
            href="/mind-maps"
            aria-label="返回导图列表"
            title="返回导图列表"
            className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-[7px] text-[var(--app-text-muted)] hover:bg-[var(--app-hover-surface)] hover:text-[var(--app-text-strong)]"
          >
            <ArrowLeft className="h-[18px] w-[18px]" />
          </Link>
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-medium text-[var(--app-text-strong)]">
              {title.trim() || "未命名思维导图"}
            </div>
            <div
              aria-live="polite"
              className={`mt-0.5 flex items-center gap-1 text-xs ${
                saveStatus === "error"
                  ? "text-[var(--app-danger-text)]"
                  : "text-[var(--app-text-subtle)]"
              }`}
              title={saveError ?? undefined}
            >
              {saveStatus === "saved" ? <Check className="h-3 w-3" /> : null}
              {saveStatus === "error" ? (
                <CircleAlert className="h-3 w-3" />
              ) : null}
              {SAVE_LABELS[saveStatus]}
              {saveError ? `：${saveError}` : ""}
            </div>
          </div>
          <button
            type="button"
            onClick={() => void flushSaveRef.current()}
            disabled={saveStatus === "saving"}
            className="app-button app-button-primary h-9 min-h-9 cursor-pointer rounded-[7px] px-3 py-1.5"
          >
            <Save className="h-4 w-4" />
            <span className="hidden sm:inline">保存</span>
          </button>
        </div>

        <MindMapToolbar
          selection={selection}
          history={history}
          scale={scale}
          search={search}
          searchOpen={searchOpen}
          searchText={searchText}
          panelOpen={panelOpen}
          painterActive={painterActive}
          onSearchOpenChange={setSearchOpen}
          onSearchTextChange={setSearchText}
          onSearchNext={() => editorRef.current?.search(searchText)}
          onSearchPrevious={() => editorRef.current?.searchPrevious()}
          onPanelToggle={() => setPanelOpen((current) => !current)}
          onCommand={(command) => editorRef.current?.execute(command)}
          onPainter={() => editorRef.current?.startPainter()}
          onImage={() => setDialog("image")}
          onLink={() => setDialog("link")}
          onNote={() => setDialog("note")}
          onTags={() => setDialog("tags")}
          onImport={() => setDialog("import")}
          onExport={() => setDialog("export")}
          onZoomIn={() => editorRef.current?.zoomIn()}
          onZoomOut={() => editorRef.current?.zoomOut()}
          onFit={() => editorRef.current?.fit()}
          onResetView={() => editorRef.current?.resetView()}
        />

        <div className="relative flex min-h-0 flex-1">
          <div className="min-w-0 flex-1">
            <MindMapEditor
              ref={editorRef}
              data={draftData}
              config={config}
              onChange={(nextData) => {
                dataRef.current = nextData;
                setDraftData(nextData);
                markDirty();
              }}
              onSelectionChange={setSelection}
              onHistoryChange={setHistory}
              onScaleChange={setScale}
              onSearchChange={setSearch}
              onPainterChange={setPainterActive}
              onContextMenu={setContextMenu}
            />
          </div>
          {panelOpen ? (
            <button
              type="button"
              aria-label="关闭设置面板"
              className="absolute inset-0 z-20 bg-[var(--app-overlay)] xl:hidden"
              onClick={() => setPanelOpen(false)}
            />
          ) : null}
          <MindMapSidebar
            open={panelOpen}
            data={draftData}
            config={config}
            selection={selection}
            title={title}
            description={description}
            collections={collections.data ?? []}
            selectedCollections={selectedCollections}
            onClose={() => setPanelOpen(false)}
            onThemeChange={(theme, resetCustom) =>
              editorRef.current?.setTheme(theme, resetCustom)
            }
            onThemeConfigChange={(themeConfig, clear) =>
              editorRef.current?.setThemeConfig(themeConfig, clear)
            }
            onLayoutChange={(layout) => editorRef.current?.setLayout(layout)}
            onNodeStyleChange={updateNodeStyle}
            onTitleChange={updateTitle}
            onDescriptionChange={updateDescription}
            onCollectionToggle={(collectionId) => {
              const next = collectionsRef.current.includes(collectionId)
                ? collectionsRef.current.filter((item) => item !== collectionId)
                : [...collectionsRef.current, collectionId];
              collectionsRef.current = next;
              setSelectedCollections(next);
              markDirty();
            }}
            onConfigChange={updateConfig}
          />
        </div>
      </div>

      <MindMapDialogs
        kind={dialog}
        selection={selection}
        editorRef={editorRef}
        config={config}
        title={title}
        onClose={() => setDialog(null)}
        onConfigChange={updateConfig}
      />
      {contextMenu ? (
        <ContextMenu
          state={contextMenu}
          selection={selection}
          onCommand={(command) => editorRef.current?.execute(command)}
          onDialog={setDialog}
          onClose={() => setContextMenu(null)}
        />
      ) : null}
    </WorkspaceShell>
  );
}
