"use client";

import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";

export type MindMapEditorHandle = {
  getData: () => Record<string, unknown>;
};

type MindMapEditorProps = {
  data: Record<string, unknown>;
  onChange: (data: Record<string, unknown>) => void;
  onReady?: () => void;
};

type MindMapInstance = {
  getData: (withConfig?: boolean) => Record<string, unknown>;
  on: (event: string, listener: () => void) => void;
  off?: (event: string, listener: () => void) => void;
  destroy?: () => void;
};

function normalizeData(data: Record<string, unknown>) {
  if (data.root && typeof data.root === "object") return data;
  return {
    root: { data: { text: "中心主题" }, children: [] },
    layout: "logicalStructure",
    theme: { template: "default", config: {} },
    view: null,
  };
}

export const MindMapEditor = forwardRef<
  MindMapEditorHandle,
  MindMapEditorProps
>(function MindMapEditor({ data, onChange, onReady }, ref) {
  const containerRef = useRef<HTMLDivElement>(null);
  const instanceRef = useRef<MindMapInstance | null>(null);
  const onChangeRef = useRef(onChange);
  const onReadyRef = useRef(onReady);
  const initialDataRef = useRef(data);
  const [loading, setLoading] = useState(true);

  onChangeRef.current = onChange;
  onReadyRef.current = onReady;

  useImperativeHandle(
    ref,
    () => ({
      getData: () => instanceRef.current?.getData(true) ?? normalizeData(data),
    }),
    [data],
  );

  useEffect(() => {
    let disposed = false;
    let cleanup: (() => void) | undefined;

    void (async () => {
      const module = await import("simple-mind-map");
      if (disposed || !containerRef.current) return;
      const MindMap = module.default;
      const fullData = normalizeData(initialDataRef.current);
      const theme =
        typeof fullData.theme === "object" && fullData.theme !== null
          ? (fullData.theme as Record<string, unknown>)
          : {};
      const instance = new MindMap({
        el: containerRef.current,
        data: fullData.root,
        layout: fullData.layout ?? "logicalStructure",
        theme: theme.template ?? "default",
        themeConfig: theme.config ?? {},
        viewData: fullData.view ?? null,
        fit: true,
        openRealtimeRenderOnNodeTextEdit: true,
        enableAutoEnterTextEditWhenKeydown: true,
      });
      instanceRef.current = instance as MindMapInstance;
      const handleDataChange = () => {
        onChangeRef.current(instance.getData(true));
      };
      const handleViewChange = () => {
        onChangeRef.current(instance.getData(true));
      };
      instance.on("data_change", handleDataChange);
      instance.on("view_data_change", handleViewChange);
      cleanup = () => {
        instance.off?.("data_change", handleDataChange);
        instance.off?.("view_data_change", handleViewChange);
        instance.destroy?.();
        instanceRef.current = null;
      };
      setLoading(false);
      onReadyRef.current?.();
    })();

    return () => {
      disposed = true;
      cleanup?.();
    };
    // 每次进入编辑页只初始化一个实例，外部数据变化由保存流程处理。
  }, []);

  return (
    <div className="relative min-h-[620px] overflow-hidden rounded-[12px] border border-[var(--app-border-soft)] bg-white">
      {loading ? (
        <div className="absolute inset-0 z-10 grid place-items-center text-sm text-[var(--app-text-muted)]">
          正在加载思维导图编辑器
        </div>
      ) : null}
      <div ref={containerRef} className="h-[620px] w-full" />
    </div>
  );
});
