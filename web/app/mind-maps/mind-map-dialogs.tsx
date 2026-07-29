"use client";

import { Download, X } from "lucide-react";
import {
  type FormEvent,
  type ReactNode,
  type RefObject,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";

import type { MindMapEditorHandle } from "~/app/mind-maps/mind-map-editor";
import {
  getMindMapImportExtension,
  type MindMapEditorConfig,
  type MindMapSelection,
  normalizeHyperlink,
  normalizeNodeTags,
  parseMindMapJson,
  validateMindMapImage,
} from "~/app/mind-maps/mind-map-model";

export type MindMapDialogKind =
  | "image"
  | "link"
  | "note"
  | "tags"
  | "import"
  | "export"
  | null;

function Modal(props: {
  open: boolean;
  title: string;
  children: ReactNode;
  onClose: () => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const titleId = useId();

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (props.open && !dialog.open) {
      returnFocusRef.current =
        document.activeElement instanceof HTMLElement
          ? document.activeElement
          : null;
      dialog.showModal();
      window.requestAnimationFrame(() => {
        dialog
          .querySelector<HTMLElement>("input, textarea, select, button")
          ?.focus();
      });
    } else if (!props.open && dialog.open) {
      dialog.close();
    }
  }, [props.open]);

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby={titleId}
      onCancel={(event) => {
        event.preventDefault();
        props.onClose();
      }}
      onClose={() => returnFocusRef.current?.focus()}
      className="m-auto max-h-[min(760px,90dvh)] w-[min(620px,calc(100vw-24px))] overflow-hidden rounded-[8px] border border-[var(--app-border)] bg-[var(--app-panel-strong)] p-0 text-[var(--app-text)] shadow-[var(--app-shadow-lg)] backdrop:bg-[var(--app-overlay)]"
    >
      <div className="flex h-12 items-center border-b border-[var(--app-border-soft)] px-4">
        <h2
          id={titleId}
          className="text-base font-medium text-[var(--app-text-strong)]"
        >
          {props.title}
        </h2>
        <button
          type="button"
          aria-label="关闭"
          onClick={props.onClose}
          className="ml-auto inline-flex h-8 w-8 cursor-pointer items-center justify-center rounded-[7px] text-[var(--app-text-muted)] hover:bg-[var(--app-hover-surface)] hover:text-[var(--app-text-strong)]"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
      {props.children}
    </dialog>
  );
}

function DialogFooter(props: {
  onCancel: () => void;
  submitLabel?: string;
  pending?: boolean;
}) {
  return (
    <div className="flex items-center justify-end gap-2 border-t border-[var(--app-border-soft)] px-4 py-3">
      <button
        type="button"
        className="app-button rounded-[7px]"
        onClick={props.onCancel}
      >
        取消
      </button>
      <button
        type="submit"
        disabled={props.pending}
        className="app-button app-button-primary rounded-[7px]"
      >
        {props.pending ? "处理中" : (props.submitLabel ?? "确定")}
      </button>
    </div>
  );
}

function getImageDimensions(source: string) {
  return new Promise<{ width: number; height: number }>((resolve, reject) => {
    const image = new Image();
    image.onload = () =>
      resolve({
        width: image.naturalWidth || 100,
        height: image.naturalHeight || 100,
      });
    image.onerror = () => reject(new Error("无法读取图片"));
    image.src = source;
  });
}

function readFileAsDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(new Error("无法读取图片文件"));
    reader.readAsDataURL(file);
  });
}

function ImageDialog(props: {
  open: boolean;
  selection: MindMapSelection;
  onClose: () => void;
  onSubmit: MindMapEditorHandle["setNodeImage"];
}) {
  const [url, setUrl] = useState("");
  const [title, setTitle] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    if (!props.open) return;
    const image =
      typeof props.selection.data.image === "string"
        ? props.selection.data.image
        : "";
    setUrl(image.startsWith("https://") ? image : "");
    setTitle(
      typeof props.selection.data.imageTitle === "string"
        ? props.selection.data.imageTitle
        : "",
    );
    setFile(null);
    setError(null);
  }, [props.open, props.selection.data]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setPending(true);
    try {
      if (!file && !url.trim()) {
        props.onSubmit(null);
        props.onClose();
        return;
      }
      let source = url.trim();
      if (file) {
        const validationError = validateMindMapImage(file);
        if (validationError) throw new Error(validationError);
        source = await readFileAsDataUrl(file);
      } else if (!source.startsWith("https://")) {
        throw new Error("图片地址必须使用 HTTPS");
      }
      const size = await getImageDimensions(source);
      props.onSubmit({
        url: source,
        title: title.trim(),
        width: size.width,
        height: size.height,
      });
      props.onClose();
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "图片读取失败");
    } finally {
      setPending(false);
    }
  }

  return (
    <Modal open={props.open} title="节点图片" onClose={props.onClose}>
      <form onSubmit={submit}>
        <div className="grid gap-4 p-4">
          <div>
            <label htmlFor="node-image-file" className="mb-1.5 block text-sm">
              本地图片
            </label>
            <input
              id="node-image-file"
              type="file"
              accept="image/png,image/jpeg,image/webp"
              onChange={(event) => setFile(event.target.files?.[0] ?? null)}
              className="block w-full text-sm text-[var(--app-text-muted)] file:mr-3 file:cursor-pointer file:rounded-[6px] file:border file:border-[var(--app-border)] file:bg-[var(--app-bg-inset)] file:px-3 file:py-2 file:text-[var(--app-text)]"
            />
            <p className="mt-1 text-xs text-[var(--app-text-subtle)]">
              PNG、JPEG 或 WebP，最大 1 MiB
            </p>
          </div>
          <div>
            <label htmlFor="node-image-url" className="mb-1.5 block text-sm">
              HTTPS 图片地址
            </label>
            <input
              id="node-image-url"
              value={url}
              disabled={Boolean(file)}
              onChange={(event) => setUrl(event.target.value)}
              className="app-input rounded-[7px]"
              placeholder="https://example.com/image.png"
            />
          </div>
          <div>
            <label htmlFor="node-image-title" className="mb-1.5 block text-sm">
              图片说明
            </label>
            <input
              id="node-image-title"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              className="app-input rounded-[7px]"
            />
          </div>
          {error ? (
            <p className="text-sm text-[var(--app-danger-text)]">{error}</p>
          ) : null}
        </div>
        <DialogFooter onCancel={props.onClose} pending={pending} />
      </form>
    </Modal>
  );
}

function LinkDialog(props: {
  open: boolean;
  selection: MindMapSelection;
  onClose: () => void;
  onSubmit: MindMapEditorHandle["setNodeHyperlink"];
}) {
  const [url, setUrl] = useState("");
  const [title, setTitle] = useState("");

  useEffect(() => {
    if (!props.open) return;
    setUrl(
      typeof props.selection.data.hyperlink === "string"
        ? props.selection.data.hyperlink
        : "",
    );
    setTitle(
      typeof props.selection.data.hyperlinkTitle === "string"
        ? props.selection.data.hyperlinkTitle
        : "",
    );
  }, [props.open, props.selection.data]);

  return (
    <Modal open={props.open} title="节点链接" onClose={props.onClose}>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          props.onSubmit(normalizeHyperlink(url), title.trim());
          props.onClose();
        }}
      >
        <div className="grid gap-4 p-4">
          <div>
            <label htmlFor="node-link-url" className="mb-1.5 block text-sm">
              链接地址
            </label>
            <input
              id="node-link-url"
              value={url}
              onChange={(event) => setUrl(event.target.value)}
              className="app-input rounded-[7px]"
              placeholder="example.com/research"
            />
          </div>
          <div>
            <label htmlFor="node-link-title" className="mb-1.5 block text-sm">
              链接名称
            </label>
            <input
              id="node-link-title"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              className="app-input rounded-[7px]"
            />
          </div>
        </div>
        <DialogFooter onCancel={props.onClose} />
      </form>
    </Modal>
  );
}

function NoteDialog(props: {
  open: boolean;
  selection: MindMapSelection;
  onClose: () => void;
  onSubmit: MindMapEditorHandle["setNodeNote"];
}) {
  const [note, setNote] = useState("");
  useEffect(() => {
    if (!props.open) return;
    setNote(
      typeof props.selection.data.note === "string"
        ? props.selection.data.note
        : "",
    );
  }, [props.open, props.selection.data.note]);
  return (
    <Modal open={props.open} title="节点备注" onClose={props.onClose}>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          props.onSubmit(note);
          props.onClose();
        }}
      >
        <div className="p-4">
          <label htmlFor="node-note" className="mb-1.5 block text-sm">
            Markdown 内容
          </label>
          <textarea
            id="node-note"
            value={note}
            onChange={(event) => setNote(event.target.value)}
            rows={14}
            className="app-textarea rounded-[7px] font-[family-name:var(--font-data)] text-sm leading-6"
          />
        </div>
        <DialogFooter onCancel={props.onClose} />
      </form>
    </Modal>
  );
}

function TagsDialog(props: {
  open: boolean;
  selection: MindMapSelection;
  onClose: () => void;
  onSubmit: MindMapEditorHandle["setNodeTags"];
}) {
  const [value, setValue] = useState("");
  useEffect(() => {
    if (!props.open) return;
    const tags = Array.isArray(props.selection.data.tag)
      ? props.selection.data.tag.map((tag) =>
          typeof tag === "string" ? tag : tag.text,
        )
      : [];
    setValue(tags.join("，"));
  }, [props.open, props.selection.data.tag]);
  return (
    <Modal open={props.open} title="节点标签" onClose={props.onClose}>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          props.onSubmit(normalizeNodeTags(value.split(/[,，\n]/)));
          props.onClose();
        }}
      >
        <div className="p-4">
          <label htmlFor="node-tags" className="mb-1.5 block text-sm">
            标签
          </label>
          <input
            id="node-tags"
            value={value}
            onChange={(event) => setValue(event.target.value)}
            className="app-input rounded-[7px]"
            placeholder="估值，催化剂，风险"
          />
          <p className="mt-2 text-xs text-[var(--app-text-subtle)]">
            使用逗号分隔，最多保留 5 个非空标签
          </p>
        </div>
        <DialogFooter onCancel={props.onClose} />
      </form>
    </Modal>
  );
}

function ImportDialog(props: {
  open: boolean;
  onClose: () => void;
  onSubmit: MindMapEditorHandle["replaceData"];
}) {
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [sheets, setSheets] = useState<Array<{ title: string }> | null>(null);
  const [selectedSheet, setSelectedSheet] = useState(0);
  const sheetResolverRef = useRef<((sheet: unknown) => void) | null>(null);
  const sheetRejecterRef = useRef<((error: Error) => void) | null>(null);

  useEffect(() => {
    if (!props.open) {
      sheetRejecterRef.current?.(new Error("已取消导入"));
      sheetResolverRef.current = null;
      sheetRejecterRef.current = null;
      setFile(null);
      setError(null);
      setSheets(null);
      setSelectedSheet(0);
    }
  }, [props.open]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (sheets && sheetResolverRef.current) {
      setPending(true);
      sheetResolverRef.current(sheets[selectedSheet]);
      sheetResolverRef.current = null;
      sheetRejecterRef.current = null;
      setSheets(null);
      return;
    }
    if (!file) {
      setError("请选择导图文件");
      return;
    }
    const extension = getMindMapImportExtension(file.name);
    if (!extension) {
      setError("仅支持 SMM、JSON、XMind 或 Markdown 文件");
      return;
    }
    if (!window.confirm("导入会替换当前画布，是否继续？")) return;
    setError(null);
    setPending(true);
    try {
      let data: Record<string, unknown>;
      if (extension === "smm" || extension === "json") {
        data = parseMindMapJson(await file.text());
      } else if (extension === "md") {
        const markdown = (await import("simple-mind-map/src/parse/markdown.js"))
          .default;
        data = markdown.transformMarkdownTo(await file.text());
      } else {
        const xmind = (await import("simple-mind-map/src/parse/xmind.js"))
          .default;
        data = await xmind.parseXmindFile(file, (nextSheets) => {
          setPending(false);
          setSheets(nextSheets);
          setSelectedSheet(0);
          return new Promise((resolve, reject) => {
            sheetResolverRef.current = resolve;
            sheetRejecterRef.current = reject;
          });
        });
      }
      props.onSubmit(data);
      props.onClose();
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "导入解析失败");
    } finally {
      setPending(false);
    }
  }

  return (
    <Modal open={props.open} title="导入导图" onClose={props.onClose}>
      <form onSubmit={submit}>
        <div className="grid gap-4 p-4">
          {sheets ? (
            <div>
              <label htmlFor="xmind-sheet" className="mb-1.5 block text-sm">
                选择 XMind 画布
              </label>
              <select
                id="xmind-sheet"
                value={selectedSheet}
                onChange={(event) =>
                  setSelectedSheet(Number(event.target.value))
                }
                className="rounded-[7px]"
              >
                {sheets.map((sheet, index) => (
                  <option key={`${sheet.title}-${index}`} value={index}>
                    {sheet.title || `画布 ${index + 1}`}
                  </option>
                ))}
              </select>
            </div>
          ) : (
            <div>
              <label htmlFor="mind-map-import" className="mb-1.5 block text-sm">
                导图文件
              </label>
              <input
                id="mind-map-import"
                type="file"
                accept=".smm,.json,.xmind,.md"
                onChange={(event) => setFile(event.target.files?.[0] ?? null)}
                className="block w-full text-sm text-[var(--app-text-muted)] file:mr-3 file:cursor-pointer file:rounded-[6px] file:border file:border-[var(--app-border)] file:bg-[var(--app-bg-inset)] file:px-3 file:py-2 file:text-[var(--app-text)]"
              />
              <p className="mt-2 text-xs text-[var(--app-text-subtle)]">
                支持 SMM、JSON、XMind 和 Markdown
              </p>
            </div>
          )}
          {error ? (
            <p className="text-sm text-[var(--app-danger-text)]">{error}</p>
          ) : null}
        </div>
        <DialogFooter
          onCancel={props.onClose}
          pending={pending}
          submitLabel={sheets ? "导入所选画布" : "导入"}
        />
      </form>
    </Modal>
  );
}

const EXPORT_FORMATS = [
  ["smm", "SMM"],
  ["json", "JSON"],
  ["xmind", "XMind"],
  ["md", "Markdown"],
  ["png", "PNG"],
  ["svg", "SVG"],
  ["pdf", "PDF"],
] as const;

function ExportDialog(props: {
  open: boolean;
  config: MindMapEditorConfig;
  defaultName: string;
  onClose: () => void;
  onConfigChange: (config: Partial<MindMapEditorConfig>) => void;
  onExport: MindMapEditorHandle["exportFile"];
}) {
  const [type, setType] = useState<(typeof EXPORT_FORMATS)[number][0]>("smm");
  const [fileName, setFileName] = useState("");
  const [transparent, setTransparent] = useState(false);
  const [fitBackground, setFitBackground] = useState(true);
  const [includeConfig, setIncludeConfig] = useState(true);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!props.open) return;
    setFileName(props.defaultName.trim() || "未命名思维导图");
    setError(null);
  }, [props.defaultName, props.open]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setPending(true);
    setError(null);
    try {
      if (type === "smm" || type === "json") {
        await props.onExport(type, fileName, includeConfig);
      } else if (type === "png") {
        await props.onExport(type, fileName, transparent, null, fitBackground);
      } else if (type === "pdf") {
        await props.onExport(type, fileName, transparent, fitBackground);
      } else if (type === "svg") {
        await props.onExport(type, fileName, "*{box-sizing:border-box}");
      } else {
        await props.onExport(type, fileName);
      }
      props.onClose();
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "导出失败");
    } finally {
      setPending(false);
    }
  }

  const showVisualOptions = ["png", "svg", "pdf"].includes(type);
  return (
    <Modal open={props.open} title="导出导图" onClose={props.onClose}>
      <form onSubmit={submit}>
        <div className="grid gap-4 p-4">
          <div className="grid grid-cols-4 gap-2 sm:grid-cols-7">
            {EXPORT_FORMATS.map(([value, label]) => (
              <button
                key={value}
                type="button"
                onClick={() => setType(value)}
                className={`cursor-pointer rounded-[7px] border px-2 py-2 text-xs transition-colors ${
                  type === value
                    ? "border-[var(--app-border-strong)] bg-[var(--app-selection)] text-[var(--app-text-strong)]"
                    : "border-[var(--app-border-soft)] text-[var(--app-text-muted)] hover:text-[var(--app-text-strong)]"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
          <div>
            <label htmlFor="export-file-name" className="mb-1.5 block text-sm">
              文件名
            </label>
            <input
              id="export-file-name"
              value={fileName}
              onChange={(event) => setFileName(event.target.value)}
              className="app-input rounded-[7px]"
            />
          </div>
          {showVisualOptions ? (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label
                  htmlFor="export-padding-x"
                  className="mb-1.5 block text-sm"
                >
                  水平边距
                </label>
                <input
                  id="export-padding-x"
                  type="number"
                  min={0}
                  max={200}
                  value={props.config.exportPaddingX}
                  onChange={(event) =>
                    props.onConfigChange({
                      exportPaddingX: Number(event.target.value),
                    })
                  }
                  className="app-input rounded-[7px]"
                />
              </div>
              <div>
                <label
                  htmlFor="export-padding-y"
                  className="mb-1.5 block text-sm"
                >
                  垂直边距
                </label>
                <input
                  id="export-padding-y"
                  type="number"
                  min={0}
                  max={200}
                  value={props.config.exportPaddingY}
                  onChange={(event) =>
                    props.onConfigChange({
                      exportPaddingY: Number(event.target.value),
                    })
                  }
                  className="app-input rounded-[7px]"
                />
              </div>
              {type === "png" || type === "pdf" ? (
                <>
                  <label className="flex cursor-pointer items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={transparent}
                      onChange={(event) => setTransparent(event.target.checked)}
                    />
                    透明背景
                  </label>
                  <label className="flex cursor-pointer items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={fitBackground}
                      disabled={transparent}
                      onChange={(event) =>
                        setFitBackground(event.target.checked)
                      }
                    />
                    适配背景
                  </label>
                </>
              ) : null}
            </div>
          ) : null}
          {type === "smm" || type === "json" ? (
            <label className="flex cursor-pointer items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={includeConfig}
                onChange={(event) => setIncludeConfig(event.target.checked)}
              />
              包含主题、结构和视图配置
            </label>
          ) : null}
          {error ? (
            <p className="text-sm text-[var(--app-danger-text)]">{error}</p>
          ) : null}
        </div>
        <div className="flex items-center justify-end gap-2 border-t border-[var(--app-border-soft)] px-4 py-3">
          <button
            type="button"
            className="app-button rounded-[7px]"
            onClick={props.onClose}
          >
            取消
          </button>
          <button
            type="submit"
            disabled={pending}
            className="app-button app-button-primary rounded-[7px]"
          >
            <Download className="h-4 w-4" />
            {pending ? "导出中" : "导出"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

export function MindMapDialogs(props: {
  kind: MindMapDialogKind;
  selection: MindMapSelection;
  editorRef: RefObject<MindMapEditorHandle | null>;
  config: MindMapEditorConfig;
  title: string;
  onClose: () => void;
  onConfigChange: (config: Partial<MindMapEditorConfig>) => void;
}) {
  const editor = props.editorRef.current;
  return (
    <>
      <ImageDialog
        open={props.kind === "image"}
        selection={props.selection}
        onClose={props.onClose}
        onSubmit={(value) => editor?.setNodeImage(value)}
      />
      <LinkDialog
        open={props.kind === "link"}
        selection={props.selection}
        onClose={props.onClose}
        onSubmit={(url, title) => editor?.setNodeHyperlink(url, title)}
      />
      <NoteDialog
        open={props.kind === "note"}
        selection={props.selection}
        onClose={props.onClose}
        onSubmit={(note) => editor?.setNodeNote(note)}
      />
      <TagsDialog
        open={props.kind === "tags"}
        selection={props.selection}
        onClose={props.onClose}
        onSubmit={(tags) => editor?.setNodeTags(tags)}
      />
      <ImportDialog
        open={props.kind === "import"}
        onClose={props.onClose}
        onSubmit={(data) => editor?.replaceData(data)}
      />
      <ExportDialog
        open={props.kind === "export"}
        config={props.config}
        defaultName={props.title}
        onClose={props.onClose}
        onConfigChange={props.onConfigChange}
        onExport={async (type, fileName, ...args) => {
          await editor?.exportFile(type, fileName, ...args);
        }}
      />
    </>
  );
}
