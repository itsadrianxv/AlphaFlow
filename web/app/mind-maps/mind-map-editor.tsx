"use client";

import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";

import {
  EMPTY_MIND_MAP_SELECTION,
  type MindMapActiveNode,
  type MindMapDocumentData,
  type MindMapEditorConfig,
  type MindMapSelection,
  normalizeMindMapData,
} from "~/app/mind-maps/mind-map-model";

const STYLE_KEYS = [
  "fontFamily",
  "fontSize",
  "color",
  "fontWeight",
  "fontStyle",
  "textDecoration",
  "textAlign",
  "shape",
  "fillColor",
  "borderColor",
  "borderWidth",
  "borderDasharray",
  "borderRadius",
  "lineColor",
  "lineWidth",
  "lineDasharray",
  "paddingX",
  "paddingY",
  "imgPlacement",
  "tagPlacement",
] as const;

type MindMapInstance = InstanceType<typeof import("simple-mind-map").default>;

let enginePromise: Promise<typeof import("simple-mind-map").default> | null =
  null;

async function loadMindMapEngine() {
  if (enginePromise) return enginePromise;
  enginePromise = (async () => {
    const [
      core,
      drag,
      select,
      keyboardNavigation,
      search,
      painter,
      nodeImgAdjust,
      nodeBase64ImageStorage,
      mindMapLayoutPro,
      exportPlugin,
      exportPdf,
      exportXMind,
      touchEvent,
      themes,
    ] = await Promise.all([
      import("simple-mind-map"),
      import("simple-mind-map/src/plugins/Drag.js"),
      import("simple-mind-map/src/plugins/Select.js"),
      import("simple-mind-map/src/plugins/KeyboardNavigation.js"),
      import("simple-mind-map/src/plugins/Search.js"),
      import("simple-mind-map/src/plugins/Painter.js"),
      import("simple-mind-map/src/plugins/NodeImgAdjust.js"),
      import("simple-mind-map/src/plugins/NodeBase64ImageStorage.js"),
      import("simple-mind-map/src/plugins/MindMapLayoutPro.js"),
      import("simple-mind-map/src/plugins/Export.js"),
      import("simple-mind-map/src/plugins/ExportPDF.js"),
      import("simple-mind-map/src/plugins/ExportXMind.js"),
      import("simple-mind-map/src/plugins/TouchEvent.js"),
      import("simple-mind-map-plugin-themes"),
    ]);
    const MindMap = core.default;
    [
      drag,
      select,
      keyboardNavigation,
      search,
      painter,
      nodeImgAdjust,
      nodeBase64ImageStorage,
      mindMapLayoutPro,
      exportPlugin,
      exportPdf,
      exportXMind,
      touchEvent,
    ].forEach((plugin) => {
      MindMap.usePlugin(plugin.default);
    });
    themes.default.init(MindMap);
    return MindMap;
  })();
  return enginePromise;
}

export type MindMapHistoryState = {
  canUndo: boolean;
  canRedo: boolean;
};

export type MindMapSearchState = {
  current: number;
  total: number;
};

export type MindMapContextMenuState = {
  x: number;
  y: number;
};

export type MindMapEditorHandle = {
  getData: () => MindMapDocumentData;
  execute: (command: string, ...args: unknown[]) => void;
  startPainter: () => void;
  setTheme: (theme: string, resetCustom?: boolean) => void;
  setThemeConfig: (config: Record<string, unknown>, clear?: boolean) => void;
  setLayout: (layout: string) => void;
  updateConfig: (config: Partial<MindMapEditorConfig>) => void;
  updateNodeStyle: (key: string, value: unknown) => void;
  setNodeImage: (
    value: {
      url: string;
      title?: string;
      width: number;
      height: number;
    } | null,
  ) => void;
  setNodeHyperlink: (url: string, title?: string) => void;
  setNodeNote: (note: string) => void;
  setNodeTags: (tags: string[]) => void;
  replaceData: (data: Record<string, unknown>) => void;
  exportFile: (
    type: string,
    fileName: string,
    ...args: unknown[]
  ) => Promise<void>;
  zoomIn: () => void;
  zoomOut: () => void;
  fit: () => void;
  resetView: () => void;
  search: (text: string) => void;
  searchPrevious: () => void;
  endSearch: () => void;
};

type MindMapEditorProps = {
  data: Record<string, unknown>;
  config: MindMapEditorConfig;
  onChange: (data: MindMapDocumentData) => void;
  onSelectionChange?: (selection: MindMapSelection) => void;
  onHistoryChange?: (history: MindMapHistoryState) => void;
  onScaleChange?: (scale: number) => void;
  onSearchChange?: (search: MindMapSearchState) => void;
  onPainterChange?: (active: boolean) => void;
  onContextMenu?: (menu: MindMapContextMenuState | null) => void;
  onReady?: () => void;
};

function readSelection(nodes: MindMapActiveNode[]): MindMapSelection {
  const first = nodes[0];
  if (!first) return EMPTY_MIND_MAP_SELECTION;
  const styles = Object.fromEntries(
    STYLE_KEYS.map((key) => [key, first.getStyle(key, false)]),
  );
  const data = first.getData();
  return {
    count: nodes.length,
    hasRoot: nodes.some((node) => Boolean(node.isRoot)),
    hasGeneralization: nodes.some((node) => Boolean(node.isGeneralization)),
    styles,
    data:
      data && typeof data === "object"
        ? (data as MindMapSelection["data"])
        : {},
  };
}

export const MindMapEditor = forwardRef<
  MindMapEditorHandle,
  MindMapEditorProps
>(function MindMapEditor(
  {
    data,
    config,
    onChange,
    onSelectionChange,
    onHistoryChange,
    onScaleChange,
    onSearchChange,
    onPainterChange,
    onContextMenu,
    onReady,
  },
  ref,
) {
  const containerRef = useRef<HTMLDivElement>(null);
  const instanceRef = useRef<MindMapInstance | null>(null);
  const activeNodesRef = useRef<MindMapActiveNode[]>([]);
  const callbacksRef = useRef({
    onChange,
    onSelectionChange,
    onHistoryChange,
    onScaleChange,
    onSearchChange,
    onPainterChange,
    onContextMenu,
    onReady,
  });
  const initialDataRef = useRef(data);
  const initialConfigRef = useRef(config);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  callbacksRef.current = {
    onChange,
    onSelectionChange,
    onHistoryChange,
    onScaleChange,
    onSearchChange,
    onPainterChange,
    onContextMenu,
    onReady,
  };

  const emitData = useCallback(() => {
    const instance = instanceRef.current;
    if (!instance) return;
    callbacksRef.current.onChange(normalizeMindMapData(instance.getData(true)));
  }, []);

  useImperativeHandle(
    ref,
    () => ({
      getData: () =>
        instanceRef.current
          ? normalizeMindMapData(instanceRef.current.getData(true))
          : normalizeMindMapData(data),
      execute: (command, ...args) =>
        instanceRef.current?.execCommand(command, ...args),
      startPainter: () => instanceRef.current?.painter.startPainter(),
      setTheme: (theme, resetCustom = false) => {
        const instance = instanceRef.current;
        if (!instance) return;
        if (resetCustom) instance.setThemeConfig({}, true);
        instance.setTheme(theme);
        emitData();
      },
      setThemeConfig: (themeConfig, clear = false) => {
        instanceRef.current?.setThemeConfig(themeConfig, clear);
        emitData();
      },
      setLayout: (layout) => {
        instanceRef.current?.setLayout(layout);
        emitData();
      },
      updateConfig: (nextConfig) =>
        instanceRef.current?.updateConfig(nextConfig),
      updateNodeStyle: (key, value) => {
        activeNodesRef.current.forEach((node) => {
          node.setStyle(key, value);
        });
      },
      setNodeImage: (value) => {
        activeNodesRef.current.forEach((node) => {
          node.setImage(value);
        });
      },
      setNodeHyperlink: (url, title) => {
        activeNodesRef.current.forEach((node) => {
          node.setHyperlink(url, title);
        });
      },
      setNodeNote: (note) => {
        activeNodesRef.current.forEach((node) => {
          node.setNote(note);
        });
      },
      setNodeTags: (tags) => {
        activeNodesRef.current.forEach((node) => {
          node.setTag(tags);
        });
      },
      replaceData: (nextData) => {
        const instance = instanceRef.current;
        if (!instance) return;
        instance.setFullData(normalizeMindMapData(nextData));
        instance.view.reset();
        emitData();
      },
      exportFile: async (type, fileName, ...args) => {
        await instanceRef.current?.export(type, true, fileName, ...args);
      },
      zoomIn: () => instanceRef.current?.view.enlarge(),
      zoomOut: () => instanceRef.current?.view.narrow(),
      fit: () => instanceRef.current?.view.fit(),
      resetView: () => instanceRef.current?.view.reset(),
      search: (text) => {
        const instance = instanceRef.current;
        if (!instance) return;
        if (text.trim()) instance.search.search(text.trim());
        else instance.search.endSearch();
      },
      searchPrevious: () => instanceRef.current?.search.searchPrev(),
      endSearch: () => instanceRef.current?.search.endSearch(),
    }),
    [data, emitData],
  );

  useEffect(() => {
    let disposed = false;
    let resizeObserver: ResizeObserver | null = null;
    let cleanup: (() => void) | undefined;

    void (async () => {
      try {
        const MindMap = await loadMindMapEngine();
        if (disposed || !containerRef.current) return;
        const fullData = normalizeMindMapData(initialDataRef.current);
        const instance = new MindMap({
          el: containerRef.current,
          data: fullData.root,
          layout: fullData.layout,
          theme: fullData.theme.template,
          themeConfig: fullData.theme.config,
          viewData: fullData.view,
          fit: true,
          initRootNodePosition: ["center", "center"],
          openRealtimeRenderOnNodeTextEdit: true,
          nodeTextEditZIndex: 70,
          ...initialConfigRef.current,
        });
        instanceRef.current = instance;

        const handleDataChange = () => emitData();
        const handleViewChange = () => emitData();
        const handleActive = (...args: unknown[]) => {
          const nodes = Array.isArray(args[1])
            ? (args[1] as MindMapActiveNode[])
            : [];
          activeNodesRef.current = nodes;
          callbacksRef.current.onSelectionChange?.(readSelection(nodes));
          callbacksRef.current.onContextMenu?.(null);
        };
        const handleHistory = (...args: unknown[]) => {
          const index = Number(args[0] ?? 0);
          const length = Number(args[1] ?? 0);
          callbacksRef.current.onHistoryChange?.({
            canUndo: index > 0,
            canRedo: index < length - 1,
          });
        };
        const handleScale = () =>
          callbacksRef.current.onScaleChange?.(instance.view.scale);
        const handleSearchList = (...args: unknown[]) => {
          const list = Array.isArray(args[0]) ? args[0] : [];
          callbacksRef.current.onSearchChange?.({
            current: list.length ? instance.search.currentIndex + 1 : 0,
            total: list.length,
          });
        };
        const handleSearchInfo = (...args: unknown[]) => {
          const info =
            args[0] && typeof args[0] === "object"
              ? (args[0] as { currentIndex?: number; total?: number })
              : {};
          callbacksRef.current.onSearchChange?.({
            current:
              typeof info.currentIndex === "number" && (info.total ?? 0) > 0
                ? info.currentIndex + 1
                : 0,
            total: info.total ?? 0,
          });
        };
        const handleContextMenu = (...args: unknown[]) => {
          const event = args.find(
            (item): item is MouseEvent => item instanceof MouseEvent,
          );
          if (!event) return;
          event.preventDefault();
          callbacksRef.current.onContextMenu?.({
            x: event.clientX,
            y: event.clientY,
          });
        };

        instance.on("data_change", handleDataChange);
        instance.on("view_data_change", handleViewChange);
        instance.on("node_active", handleActive);
        instance.on("back_forward", handleHistory);
        instance.on("scale", handleScale);
        instance.on("search_match_node_list_change", handleSearchList);
        instance.on("search_info_change", handleSearchInfo);
        instance.on("painter_start", () =>
          callbacksRef.current.onPainterChange?.(true),
        );
        instance.on("painter_end", () =>
          callbacksRef.current.onPainterChange?.(false),
        );
        instance.on("node_contextmenu", handleContextMenu);
        instance.on("draw_click", () =>
          callbacksRef.current.onContextMenu?.(null),
        );

        resizeObserver = new ResizeObserver(() => instance.resize());
        resizeObserver.observe(containerRef.current);
        cleanup = () => {
          resizeObserver?.disconnect();
          instance.destroy();
          instanceRef.current = null;
          activeNodesRef.current = [];
        };
        setLoading(false);
        callbacksRef.current.onScaleChange?.(instance.view.scale);
        callbacksRef.current.onReady?.();
      } catch (error) {
        if (disposed) return;
        setLoadError(
          error instanceof Error ? error.message : "思维导图引擎加载失败",
        );
        setLoading(false);
      }
    })();

    return () => {
      disposed = true;
      cleanup?.();
    };
  }, [emitData]);

  return (
    <div className="relative h-full min-h-[560px] overflow-hidden bg-white">
      {loading ? (
        <div className="absolute inset-0 z-10 grid place-items-center bg-white text-sm text-neutral-500">
          正在加载思维导图编辑器
        </div>
      ) : null}
      {loadError ? (
        <div className="absolute inset-0 z-10 grid place-items-center bg-white px-6 text-center text-sm text-red-700">
          {loadError}
        </div>
      ) : null}
      <div ref={containerRef} className="h-full min-h-[560px] w-full" />
    </div>
  );
});
