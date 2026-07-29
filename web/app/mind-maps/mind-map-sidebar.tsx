"use client";

import { RotateCcw, X } from "lucide-react";
import Image from "next/image";
import { useEffect, useMemo, useState } from "react";

import type {
  MindMapDocumentData,
  MindMapEditorConfig,
  MindMapSelection,
} from "~/app/mind-maps/mind-map-model";

type SidebarTab = "theme" | "layout" | "style" | "document";

type CollectionOption = {
  id: string;
  title: string;
  collectionType: string;
};

type ThemeOption = {
  name: string;
  value: string;
  dark?: boolean;
  image?: string;
};

const SIMPLE_THEMES = new Set([
  "default",
  "skyGreen",
  "classic2",
  "classic3",
  "classicGreen",
  "classicBlue",
  "blueSky",
  "earthYellow",
  "freshGreen",
  "freshRed",
  "mint",
]);

const LAYOUTS = [
  ["logicalStructure", "逻辑结构", "logicalStructure.jpg"],
  ["logicalStructureLeft", "左向逻辑结构", "logicalStructureLeft.jpg"],
  ["mindMap", "思维导图", "mindMap.jpg"],
  ["organizationStructure", "组织结构", "organizationStructure.jpg"],
  ["catalogOrganization", "目录组织", "catalogOrganization.jpg"],
  ["timeline", "时间轴", "timeline.jpg"],
  ["timeline2", "上下时间轴", "timeline2.jpg"],
  ["verticalTimeline", "垂直时间轴", "verticalTimeline.jpg"],
  ["fishbone", "鱼骨图", "fishbone.jpg"],
] as const;

function FieldLabel(props: { children: React.ReactNode; htmlFor?: string }) {
  return (
    <label
      htmlFor={props.htmlFor}
      className="mb-1.5 block text-xs font-medium text-[var(--app-text-muted)]"
    >
      {props.children}
    </label>
  );
}

function ColorField(props: {
  id: string;
  label: string;
  value: unknown;
  onChange: (value: string) => void;
}) {
  const value =
    typeof props.value === "string" && /^#[\da-f]{6}$/i.test(props.value)
      ? props.value
      : "#333333";
  return (
    <div>
      <FieldLabel htmlFor={props.id}>{props.label}</FieldLabel>
      <div className="flex h-9 items-center gap-2 rounded-[7px] border border-[var(--app-border-soft)] bg-[var(--app-bg-inset)] px-2">
        <input
          id={props.id}
          type="color"
          value={value}
          onChange={(event) => props.onChange(event.target.value)}
          className="h-6 w-7 cursor-pointer border-0 bg-transparent p-0"
        />
        <input
          value={typeof props.value === "string" ? props.value : ""}
          onChange={(event) => props.onChange(event.target.value)}
          className="min-w-0 flex-1 bg-transparent font-[family-name:var(--font-data)] text-xs text-[var(--app-text)] outline-none"
          aria-label={`${props.label}色值`}
        />
      </div>
    </div>
  );
}

function SelectField(props: {
  id: string;
  label: string;
  value: unknown;
  options: Array<[string, string]>;
  onChange: (value: string) => void;
}) {
  return (
    <div>
      <FieldLabel htmlFor={props.id}>{props.label}</FieldLabel>
      <select
        id={props.id}
        value={typeof props.value === "string" ? props.value : ""}
        onChange={(event) => props.onChange(event.target.value)}
        className="h-9 rounded-[7px] px-2 py-1 text-sm"
      >
        {props.options.map(([value, label]) => (
          <option key={value} value={value}>
            {label}
          </option>
        ))}
      </select>
    </div>
  );
}

function NumberField(props: {
  id: string;
  label: string;
  value: unknown;
  min?: number;
  max?: number;
  onChange: (value: number) => void;
}) {
  return (
    <div>
      <FieldLabel htmlFor={props.id}>{props.label}</FieldLabel>
      <input
        id={props.id}
        type="number"
        min={props.min}
        max={props.max}
        value={typeof props.value === "number" ? props.value : 0}
        onChange={(event) => props.onChange(Number(event.target.value))}
        className="app-input h-9 rounded-[7px] px-2 py-1 text-sm"
      />
    </div>
  );
}

function Toggle(props: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="flex cursor-pointer items-center justify-between gap-4 border-b border-[var(--app-border-soft)] py-3 text-sm text-[var(--app-text)] last:border-0">
      <span>{props.label}</span>
      <input
        type="checkbox"
        checked={props.checked}
        onChange={(event) => props.onChange(event.target.checked)}
        className="h-4 w-4 accent-[var(--app-brand)]"
      />
    </label>
  );
}

export function MindMapSidebar(props: {
  open: boolean;
  data: MindMapDocumentData;
  config: MindMapEditorConfig;
  selection: MindMapSelection;
  title: string;
  description: string;
  collections: CollectionOption[];
  selectedCollections: string[];
  onClose: () => void;
  onThemeChange: (theme: string, resetCustom: boolean) => void;
  onThemeConfigChange: (
    config: Record<string, unknown>,
    clear?: boolean,
  ) => void;
  onLayoutChange: (layout: string) => void;
  onNodeStyleChange: (key: string, value: unknown) => void;
  onTitleChange: (value: string) => void;
  onDescriptionChange: (value: string) => void;
  onCollectionToggle: (id: string) => void;
  onConfigChange: (config: Partial<MindMapEditorConfig>) => void;
}) {
  const [tab, setTab] = useState<SidebarTab>("theme");
  const [themes, setThemes] = useState<ThemeOption[]>([
    { name: "默认主题", value: "default" },
  ]);

  useEffect(() => {
    let cancelled = false;
    void Promise.all([
      import("simple-mind-map-plugin-themes/themeList"),
      import("simple-mind-map-plugin-themes/themeImgMap"),
    ]).then(([listModule, imageModule]) => {
      if (cancelled) return;
      const imageMap = imageModule.default;
      setThemes([
        { name: "默认主题", value: "default", image: imageMap.default },
        ...listModule.default.map((theme) => ({
          ...theme,
          image: imageMap[theme.value],
        })),
      ]);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const themeGroups = useMemo(
    () => [
      {
        name: "经典",
        list: themes.filter(
          (theme) => !theme.dark && !SIMPLE_THEMES.has(theme.value),
        ),
      },
      {
        name: "简洁",
        list: themes.filter((theme) => SIMPLE_THEMES.has(theme.value)),
      },
      { name: "深色", list: themes.filter((theme) => theme.dark) },
    ],
    [themes],
  );
  const styles = props.selection.styles;
  const customTheme = props.data.theme.config;

  const updateThemeConfig = (key: string, value: unknown) =>
    props.onThemeConfigChange({ ...customTheme, [key]: value });

  const updateThemeNode = (
    level: "root" | "second" | "node",
    key: string,
    value: unknown,
  ) => {
    const current = customTheme[level];
    props.onThemeConfigChange({
      ...customTheme,
      [level]: {
        ...(current && typeof current === "object" ? current : {}),
        [key]: value,
      },
    });
  };

  return (
    <aside
      className={`absolute inset-y-0 right-0 z-30 flex w-[min(340px,88vw)] flex-col border-l border-[var(--app-border-soft)] bg-[var(--app-panel-strong)] transition-[transform] duration-150 xl:static xl:z-auto xl:w-[330px] xl:shrink-0 ${
        props.open ? "translate-x-0" : "translate-x-full xl:hidden"
      }`}
      aria-label="思维导图设置"
    >
      <div className="flex h-12 shrink-0 items-center border-b border-[var(--app-border-soft)] px-3">
        <div className="font-medium text-[var(--app-text-strong)]">
          导图设置
        </div>
        <button
          type="button"
          aria-label="关闭设置面板"
          onClick={props.onClose}
          className="ml-auto inline-flex h-8 w-8 cursor-pointer items-center justify-center rounded-[7px] text-[var(--app-text-muted)] hover:bg-[var(--app-hover-surface)] hover:text-[var(--app-text-strong)]"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
      <div
        role="tablist"
        className="grid shrink-0 grid-cols-4 border-b border-[var(--app-border-soft)] px-2"
      >
        {[
          ["theme", "主题"],
          ["layout", "结构"],
          ["style", "样式"],
          ["document", "导图"],
        ].map(([value, label]) => (
          <button
            key={value}
            type="button"
            role="tab"
            aria-selected={tab === value}
            onClick={() => setTab(value as SidebarTab)}
            className={`cursor-pointer border-b-2 px-1 py-3 text-sm transition-colors ${
              tab === value
                ? "border-[var(--app-brand)] text-[var(--app-text-strong)]"
                : "border-transparent text-[var(--app-text-muted)] hover:text-[var(--app-text-strong)]"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        {tab === "theme" ? (
          <div className="grid gap-5">
            {themeGroups.map((group) => (
              <section key={group.name}>
                <h3 className="mb-2 text-sm font-medium text-[var(--app-text-strong)]">
                  {group.name}
                </h3>
                <div className="grid grid-cols-2 gap-2">
                  {group.list.map((theme) => (
                    <button
                      key={theme.value}
                      type="button"
                      onClick={() => {
                        const hasCustom = Object.keys(customTheme).length > 0;
                        const reset =
                          hasCustom &&
                          window.confirm(
                            "切换主题时是否清除当前自定义主题设置？选择取消将保留设置。",
                          );
                        props.onThemeChange(theme.value, reset);
                      }}
                      className={`cursor-pointer overflow-hidden rounded-[7px] border bg-white text-left transition-colors ${
                        props.data.theme.template === theme.value
                          ? "border-[var(--app-brand)]"
                          : "border-[var(--app-border-soft)] hover:border-[var(--app-border-strong)]"
                      }`}
                    >
                      {theme.image ? (
                        <Image
                          src={theme.image}
                          alt=""
                          width={160}
                          height={90}
                          unoptimized
                          className="aspect-[16/9] w-full object-cover"
                        />
                      ) : (
                        <div className="aspect-[16/9] bg-neutral-100" />
                      )}
                      <span className="block truncate border-t border-neutral-200 px-2 py-1.5 text-xs text-neutral-700">
                        {theme.name}
                      </span>
                    </button>
                  ))}
                </div>
              </section>
            ))}

            <section className="border-t border-[var(--app-border-soft)] pt-4">
              <div className="mb-3 flex items-center justify-between">
                <h3 className="text-sm font-medium text-[var(--app-text-strong)]">
                  自定义主题
                </h3>
                <button
                  type="button"
                  onClick={() => props.onThemeConfigChange({}, true)}
                  className="inline-flex cursor-pointer items-center gap-1 rounded-[6px] px-2 py-1 text-xs text-[var(--app-text-muted)] hover:bg-[var(--app-hover-surface)] hover:text-[var(--app-text-strong)]"
                >
                  <RotateCcw className="h-3.5 w-3.5" />
                  恢复默认
                </button>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <ColorField
                  id="theme-background"
                  label="画布背景"
                  value={customTheme.backgroundColor}
                  onChange={(value) =>
                    updateThemeConfig("backgroundColor", value)
                  }
                />
                <ColorField
                  id="theme-line"
                  label="默认连线"
                  value={customTheme.lineColor}
                  onChange={(value) => updateThemeConfig("lineColor", value)}
                />
                {(["root", "second", "node"] as const).flatMap((level) => [
                  <ColorField
                    key={`${level}-fill`}
                    id={`${level}-fill`}
                    label={`${level === "root" ? "根" : level === "second" ? "二级" : "普通"}节点`}
                    value={
                      customTheme[level] &&
                      typeof customTheme[level] === "object"
                        ? (customTheme[level] as Record<string, unknown>)
                            .fillColor
                        : undefined
                    }
                    onChange={(value) =>
                      updateThemeNode(level, "fillColor", value)
                    }
                  />,
                  <ColorField
                    key={`${level}-text`}
                    id={`${level}-text`}
                    label={`${level === "root" ? "根" : level === "second" ? "二级" : "普通"}文字`}
                    value={
                      customTheme[level] &&
                      typeof customTheme[level] === "object"
                        ? (customTheme[level] as Record<string, unknown>).color
                        : undefined
                    }
                    onChange={(value) => updateThemeNode(level, "color", value)}
                  />,
                ])}
              </div>
            </section>
          </div>
        ) : null}

        {tab === "layout" ? (
          <div className="grid grid-cols-2 gap-3">
            {LAYOUTS.map(([value, label, image]) => (
              <button
                key={value}
                type="button"
                onClick={() => props.onLayoutChange(value)}
                className={`cursor-pointer overflow-hidden rounded-[7px] border bg-white text-left transition-colors ${
                  props.data.layout === value
                    ? "border-[var(--app-brand)]"
                    : "border-[var(--app-border-soft)] hover:border-[var(--app-border-strong)]"
                }`}
              >
                <Image
                  src={`/mind-map/structures/${image}`}
                  alt={`${label}结构预览`}
                  width={120}
                  height={70}
                  className="aspect-[12/7] w-full object-cover"
                />
                <span className="block border-t border-neutral-200 px-2 py-1.5 text-xs text-neutral-700">
                  {label}
                </span>
              </button>
            ))}
          </div>
        ) : null}

        {tab === "style" ? (
          props.selection.count ? (
            <div className="grid gap-5">
              <section>
                <h3 className="mb-3 text-sm font-medium text-[var(--app-text-strong)]">
                  文字
                </h3>
                <div className="grid grid-cols-2 gap-3">
                  <SelectField
                    id="node-font"
                    label="字体"
                    value={styles.fontFamily}
                    options={[
                      ["IBM Plex Sans, Microsoft YaHei", "IBM Plex Sans"],
                      ["Microsoft YaHei", "微软雅黑"],
                      ["SimSun", "宋体"],
                      ["KaiTi", "楷体"],
                      ["IBM Plex Mono, monospace", "等宽字体"],
                    ]}
                    onChange={(value) =>
                      props.onNodeStyleChange("fontFamily", value)
                    }
                  />
                  <NumberField
                    id="node-font-size"
                    label="字号"
                    value={styles.fontSize}
                    min={10}
                    max={48}
                    onChange={(value) =>
                      props.onNodeStyleChange("fontSize", value)
                    }
                  />
                  <ColorField
                    id="node-text-color"
                    label="文字颜色"
                    value={styles.color}
                    onChange={(value) =>
                      props.onNodeStyleChange("color", value)
                    }
                  />
                  <SelectField
                    id="node-text-align"
                    label="对齐"
                    value={styles.textAlign}
                    options={[
                      ["left", "左对齐"],
                      ["center", "居中"],
                      ["right", "右对齐"],
                    ]}
                    onChange={(value) =>
                      props.onNodeStyleChange("textAlign", value)
                    }
                  />
                </div>
                <div className="mt-3 grid grid-cols-3 gap-2">
                  {(
                    [
                      ["fontWeight", "bold", "加粗"],
                      ["fontStyle", "italic", "斜体"],
                      ["textDecoration", "underline", "下划线"],
                    ] as const
                  ).map(([key, value, label]) => (
                    <button
                      key={key}
                      type="button"
                      aria-pressed={styles[key] === value}
                      onClick={() =>
                        props.onNodeStyleChange(
                          key,
                          styles[key] === value ? "normal" : value,
                        )
                      }
                      className={`cursor-pointer rounded-[7px] border px-2 py-2 text-sm transition-colors ${
                        styles[key] === value
                          ? "border-[var(--app-border-strong)] bg-[var(--app-selection)] text-[var(--app-text-strong)]"
                          : "border-[var(--app-border-soft)] text-[var(--app-text-muted)] hover:text-[var(--app-text-strong)]"
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </section>

              <section className="border-t border-[var(--app-border-soft)] pt-4">
                <h3 className="mb-3 text-sm font-medium text-[var(--app-text-strong)]">
                  节点
                </h3>
                <div className="grid grid-cols-2 gap-3">
                  <SelectField
                    id="node-shape"
                    label="形状"
                    value={styles.shape}
                    options={[
                      ["rectangle", "矩形"],
                      ["roundedRectangle", "圆角矩形"],
                      ["diamond", "菱形"],
                      ["parallelogram", "平行四边形"],
                      ["ellipse", "椭圆"],
                      ["circle", "圆形"],
                    ]}
                    onChange={(value) =>
                      props.onNodeStyleChange("shape", value)
                    }
                  />
                  <NumberField
                    id="node-radius"
                    label="圆角"
                    value={styles.borderRadius}
                    min={0}
                    max={30}
                    onChange={(value) =>
                      props.onNodeStyleChange("borderRadius", value)
                    }
                  />
                  <ColorField
                    id="node-fill"
                    label="填充颜色"
                    value={styles.fillColor}
                    onChange={(value) =>
                      props.onNodeStyleChange("fillColor", value)
                    }
                  />
                  <ColorField
                    id="node-border"
                    label="边框颜色"
                    value={styles.borderColor}
                    onChange={(value) =>
                      props.onNodeStyleChange("borderColor", value)
                    }
                  />
                  <NumberField
                    id="node-border-width"
                    label="边框宽度"
                    value={styles.borderWidth}
                    min={0}
                    max={10}
                    onChange={(value) =>
                      props.onNodeStyleChange("borderWidth", value)
                    }
                  />
                  <SelectField
                    id="node-border-style"
                    label="边框样式"
                    value={styles.borderDasharray}
                    options={[
                      ["none", "实线"],
                      ["5,5", "虚线"],
                      ["2,2", "点线"],
                    ]}
                    onChange={(value) =>
                      props.onNodeStyleChange("borderDasharray", value)
                    }
                  />
                </div>
              </section>

              <section className="border-t border-[var(--app-border-soft)] pt-4">
                <h3 className="mb-3 text-sm font-medium text-[var(--app-text-strong)]">
                  连线与间距
                </h3>
                <div className="grid grid-cols-2 gap-3">
                  <ColorField
                    id="node-line-color"
                    label="连线颜色"
                    value={styles.lineColor}
                    onChange={(value) =>
                      props.onNodeStyleChange("lineColor", value)
                    }
                  />
                  <NumberField
                    id="node-line-width"
                    label="连线宽度"
                    value={styles.lineWidth}
                    min={1}
                    max={10}
                    onChange={(value) =>
                      props.onNodeStyleChange("lineWidth", value)
                    }
                  />
                  <SelectField
                    id="node-line-style"
                    label="连线样式"
                    value={styles.lineDasharray}
                    options={[
                      ["none", "实线"],
                      ["5,5", "虚线"],
                      ["2,2", "点线"],
                    ]}
                    onChange={(value) =>
                      props.onNodeStyleChange("lineDasharray", value)
                    }
                  />
                  <NumberField
                    id="node-padding-x"
                    label="水平内边距"
                    value={styles.paddingX}
                    min={0}
                    max={80}
                    onChange={(value) =>
                      props.onNodeStyleChange("paddingX", value)
                    }
                  />
                  <NumberField
                    id="node-padding-y"
                    label="垂直内边距"
                    value={styles.paddingY}
                    min={0}
                    max={50}
                    onChange={(value) =>
                      props.onNodeStyleChange("paddingY", value)
                    }
                  />
                  <SelectField
                    id="node-image-placement"
                    label="图片位置"
                    value={styles.imgPlacement}
                    options={[
                      ["top", "上方"],
                      ["bottom", "下方"],
                      ["left", "左侧"],
                      ["right", "右侧"],
                    ]}
                    onChange={(value) =>
                      props.onNodeStyleChange("imgPlacement", value)
                    }
                  />
                  <SelectField
                    id="node-tag-placement"
                    label="标签位置"
                    value={styles.tagPlacement}
                    options={[
                      ["right", "右侧"],
                      ["bottom", "下方"],
                    ]}
                    onChange={(value) =>
                      props.onNodeStyleChange("tagPlacement", value)
                    }
                  />
                </div>
              </section>
            </div>
          ) : (
            <div className="grid min-h-48 place-items-center text-center text-sm leading-6 text-[var(--app-text-muted)]">
              选择一个或多个节点后编辑样式
            </div>
          )
        ) : null}

        {tab === "document" ? (
          <div className="grid gap-5">
            <section className="grid gap-3">
              <div>
                <FieldLabel htmlFor="mind-map-title">标题</FieldLabel>
                <input
                  id="mind-map-title"
                  value={props.title}
                  onChange={(event) => props.onTitleChange(event.target.value)}
                  className="app-input rounded-[7px] px-3 py-2 text-sm"
                />
              </div>
              <div>
                <FieldLabel htmlFor="mind-map-description">描述</FieldLabel>
                <textarea
                  id="mind-map-description"
                  value={props.description}
                  onChange={(event) =>
                    props.onDescriptionChange(event.target.value)
                  }
                  rows={4}
                  className="app-textarea rounded-[7px] px-3 py-2 text-sm"
                />
              </div>
            </section>

            <section className="border-t border-[var(--app-border-soft)] pt-4">
              <h3 className="mb-2 text-sm font-medium text-[var(--app-text-strong)]">
                关联投研收藏
              </h3>
              <div className="grid max-h-48 gap-1 overflow-y-auto">
                {props.collections.map((collection) => (
                  <label
                    key={collection.id}
                    className="flex cursor-pointer items-center gap-2 rounded-[6px] px-2 py-2 text-sm text-[var(--app-text)] hover:bg-[var(--app-hover-surface)]"
                  >
                    <input
                      type="checkbox"
                      checked={props.selectedCollections.includes(
                        collection.id,
                      )}
                      onChange={() => props.onCollectionToggle(collection.id)}
                      className="h-4 w-4 accent-[var(--app-brand)]"
                    />
                    <span className="min-w-0 truncate">{collection.title}</span>
                  </label>
                ))}
                {!props.collections.length ? (
                  <span className="py-3 text-xs text-[var(--app-text-subtle)]">
                    暂无统一收藏
                  </span>
                ) : null}
              </div>
            </section>

            <section className="border-t border-[var(--app-border-soft)] pt-2">
              <Toggle
                label="允许自由拖拽节点"
                checked={props.config.enableFreeDrag}
                onChange={(value) =>
                  props.onConfigChange({ enableFreeDrag: value })
                }
              />
              <Toggle
                label="键入时自动编辑节点"
                checked={props.config.enableAutoEnterTextEditWhenKeydown}
                onChange={(value) =>
                  props.onConfigChange({
                    enableAutoEnterTextEditWhenKeydown: value,
                  })
                }
              />
              <Toggle
                label="始终显示展开按钮"
                checked={props.config.alwaysShowExpandBtn}
                onChange={(value) =>
                  props.onConfigChange({ alwaysShowExpandBtn: value })
                }
              />
              <Toggle
                label="继承上级连线样式"
                checked={props.config.enableInheritAncestorLineStyle}
                onChange={(value) =>
                  props.onConfigChange({
                    enableInheritAncestorLineStyle: value,
                  })
                }
              />
              <div className="pt-3">
                <SelectField
                  id="mind-map-wheel-action"
                  label="鼠标滚轮"
                  value={props.config.mousewheelAction}
                  options={[
                    ["zoom", "缩放画布"],
                    ["move", "移动画布"],
                  ]}
                  onChange={(value) =>
                    props.onConfigChange({
                      mousewheelAction: value === "move" ? "move" : "zoom",
                    })
                  }
                />
              </div>
            </section>
          </div>
        ) : null}
      </div>
    </aside>
  );
}
