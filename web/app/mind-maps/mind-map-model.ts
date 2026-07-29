export const MIND_MAP_IMAGE_MAX_BYTES = 1024 * 1024;
export const MIND_MAP_IMAGE_TYPES = [
  "image/png",
  "image/jpeg",
  "image/webp",
] as const;

export const MIND_MAP_IMPORT_EXTENSIONS = [
  "smm",
  "json",
  "xmind",
  "md",
] as const;

export type MindMapNodeData = {
  text?: string;
  uid?: string;
  hyperlink?: string;
  hyperlinkTitle?: string;
  note?: string;
  tag?: Array<string | { text: string; [key: string]: unknown }>;
  image?: string;
  imageTitle?: string;
  imageSize?: { width: number; height: number };
  [key: string]: unknown;
};

export type MindMapNodeTree = {
  data: MindMapNodeData;
  children?: MindMapNodeTree[];
  [key: string]: unknown;
};

export type MindMapActiveNode = {
  isRoot?: boolean;
  isGeneralization?: boolean;
  getData(key?: string): unknown;
  getStyle(key: string, mergeTheme?: boolean): unknown;
  setStyle(key: string, value: unknown): void;
  setStyles(styles: Record<string, unknown>): void;
  setImage(
    value: {
      url: string;
      title?: string;
      width: number;
      height: number;
    } | null,
  ): void;
  setHyperlink(url: string, title?: string): void;
  setNote(note: string): void;
  setTag(tags: string[]): void;
};

export type MindMapSelection = {
  count: number;
  hasRoot: boolean;
  hasGeneralization: boolean;
  styles: Record<string, unknown>;
  data: MindMapNodeData;
};

export const EMPTY_MIND_MAP_SELECTION: MindMapSelection = {
  count: 0,
  hasRoot: false,
  hasGeneralization: false,
  styles: {},
  data: {},
};

export type MindMapThemeData = {
  template: string;
  config: Record<string, unknown>;
};

export type MindMapDocumentData = {
  root: MindMapNodeTree;
  layout: string;
  theme: MindMapThemeData;
  view: Record<string, unknown> | null;
  [key: string]: unknown;
};

export type MindMapEditorConfig = {
  enableFreeDrag: boolean;
  mousewheelAction: "zoom" | "move";
  mousewheelZoomActionReverse: boolean;
  enableAutoEnterTextEditWhenKeydown: boolean;
  alwaysShowExpandBtn: boolean;
  enableInheritAncestorLineStyle: boolean;
  exportPaddingX: number;
  exportPaddingY: number;
  [key: string]: unknown;
};

export const DEFAULT_MIND_MAP_CONFIG: MindMapEditorConfig = {
  enableFreeDrag: false,
  mousewheelAction: "zoom",
  mousewheelZoomActionReverse: false,
  enableAutoEnterTextEditWhenKeydown: true,
  alwaysShowExpandBtn: false,
  enableInheritAncestorLineStyle: false,
  exportPaddingX: 16,
  exportPaddingY: 16,
};

export const EMPTY_MIND_MAP_DATA: MindMapDocumentData = {
  root: { data: { text: "中心主题" }, children: [] },
  layout: "logicalStructure",
  theme: { template: "default", config: {} },
  view: null,
};

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export function normalizeMindMapData(value: unknown): MindMapDocumentData {
  const source = asRecord(value);
  const root = asRecord(source.root);
  const rootData = asRecord(root.data);
  const theme = asRecord(source.theme);
  const themeConfig = asRecord(theme.config);

  return {
    ...source,
    root: {
      ...root,
      data: {
        ...rootData,
        text:
          typeof rootData.text === "string" && rootData.text.trim()
            ? rootData.text
            : "中心主题",
      },
      children: Array.isArray(root.children) ? root.children : [],
    } as MindMapNodeTree,
    layout:
      typeof source.layout === "string"
        ? source.layout
        : EMPTY_MIND_MAP_DATA.layout,
    theme: {
      template:
        typeof theme.template === "string"
          ? theme.template
          : EMPTY_MIND_MAP_DATA.theme.template,
      config: themeConfig,
    },
    view: source.view === null ? null : asRecord(source.view),
  };
}

export function normalizeMindMapConfig(value: unknown): MindMapEditorConfig {
  const source = asRecord(value);
  return {
    ...source,
    ...DEFAULT_MIND_MAP_CONFIG,
    ...source,
    mousewheelAction: source.mousewheelAction === "move" ? "move" : "zoom",
    enableFreeDrag:
      typeof source.enableFreeDrag === "boolean"
        ? source.enableFreeDrag
        : DEFAULT_MIND_MAP_CONFIG.enableFreeDrag,
    mousewheelZoomActionReverse:
      typeof source.mousewheelZoomActionReverse === "boolean"
        ? source.mousewheelZoomActionReverse
        : DEFAULT_MIND_MAP_CONFIG.mousewheelZoomActionReverse,
    enableAutoEnterTextEditWhenKeydown:
      typeof source.enableAutoEnterTextEditWhenKeydown === "boolean"
        ? source.enableAutoEnterTextEditWhenKeydown
        : DEFAULT_MIND_MAP_CONFIG.enableAutoEnterTextEditWhenKeydown,
    alwaysShowExpandBtn:
      typeof source.alwaysShowExpandBtn === "boolean"
        ? source.alwaysShowExpandBtn
        : DEFAULT_MIND_MAP_CONFIG.alwaysShowExpandBtn,
    enableInheritAncestorLineStyle:
      typeof source.enableInheritAncestorLineStyle === "boolean"
        ? source.enableInheritAncestorLineStyle
        : DEFAULT_MIND_MAP_CONFIG.enableInheritAncestorLineStyle,
    exportPaddingX: normalizePadding(source.exportPaddingX),
    exportPaddingY: normalizePadding(source.exportPaddingY),
  };
}

function normalizePadding(value: unknown) {
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) ? Math.min(200, Math.max(0, number)) : 16;
}

export function normalizeHyperlink(value: string, protocol = "https") {
  const trimmed = value.trim();
  if (!trimmed) return "";
  if (/^[a-z][a-z\d+.-]*:/i.test(trimmed)) return trimmed;
  return `${protocol}://${trimmed}`;
}

export function normalizeNodeTags(values: string[]) {
  return Array.from(
    new Set(values.map((item) => item.trim()).filter(Boolean)),
  ).slice(0, 5);
}

export function getMindMapImportExtension(fileName: string) {
  const extension = fileName.split(".").pop()?.toLowerCase() ?? "";
  return MIND_MAP_IMPORT_EXTENSIONS.includes(
    extension as (typeof MIND_MAP_IMPORT_EXTENSIONS)[number],
  )
    ? (extension as (typeof MIND_MAP_IMPORT_EXTENSIONS)[number])
    : null;
}

export function parseMindMapJson(source: string) {
  const parsed: unknown = JSON.parse(source);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("文件内容不是有效的导图对象");
  }
  return parsed as Record<string, unknown>;
}

export function validateMindMapImage(file: Pick<File, "size" | "type">) {
  if (
    !MIND_MAP_IMAGE_TYPES.includes(
      file.type as (typeof MIND_MAP_IMAGE_TYPES)[number],
    )
  ) {
    return "仅支持 PNG、JPEG 或 WebP 图片";
  }
  if (file.size > MIND_MAP_IMAGE_MAX_BYTES) {
    return "图片不能超过 1 MiB";
  }
  return null;
}

export type MindMapSaveStatus = "saved" | "dirty" | "saving" | "error";

export function nextSaveStatus(
  current: MindMapSaveStatus,
  event: "change" | "start" | "success" | "failure",
): MindMapSaveStatus {
  if (event === "change") return current === "saving" ? "saving" : "dirty";
  if (event === "start") return "saving";
  if (event === "failure") return "error";
  return "saved";
}
