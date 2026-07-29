"use client";

import {
  ChevronLeft,
  ChevronRight,
  Download,
  FileUp,
  Focus,
  Image as ImageIcon,
  Link2,
  ListPlus,
  Maximize2,
  MoreHorizontal,
  Paintbrush,
  PanelRight,
  Plus,
  Redo2,
  Search,
  StickyNote,
  Tags,
  Trash2,
  Undo2,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import type { ComponentType, SVGProps } from "react";
import { useEffect, useRef } from "react";

import type {
  MindMapHistoryState,
  MindMapSearchState,
} from "~/app/mind-maps/mind-map-editor";
import type { MindMapSelection } from "~/app/mind-maps/mind-map-model";

type Icon = ComponentType<SVGProps<SVGSVGElement>>;

export function getMindMapToolbarCapabilities(selection: MindMapSelection) {
  const hasSelection = selection.count > 0;
  return {
    hasSelection,
    canInsertSibling:
      hasSelection && !selection.hasRoot && !selection.hasGeneralization,
    canActOnNode: hasSelection && !selection.hasGeneralization,
  };
}

function ToolButton(props: {
  label: string;
  icon: Icon;
  onClick: () => void;
  disabled?: boolean;
  active?: boolean;
  className?: string;
}) {
  const {
    label,
    icon: IconComponent,
    onClick,
    disabled,
    active,
    className,
  } = props;
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      aria-pressed={active || undefined}
      onClick={onClick}
      className={`inline-flex h-9 w-9 shrink-0 cursor-pointer items-center justify-center rounded-[7px] border transition-colors disabled:cursor-not-allowed disabled:opacity-35 ${
        active
          ? "border-[var(--app-border-strong)] bg-[var(--app-selection)] text-[var(--app-text-strong)]"
          : "border-transparent text-[var(--app-text-muted)] hover:border-[var(--app-border-soft)] hover:bg-[var(--app-hover-surface)] hover:text-[var(--app-text-strong)]"
      } ${className ?? ""}`}
    >
      <IconComponent className="h-[17px] w-[17px]" strokeWidth={1.8} />
    </button>
  );
}

function Divider() {
  return (
    <span className="mx-1 h-6 w-px shrink-0 bg-[var(--app-border-soft)]" />
  );
}

export function MindMapToolbar(props: {
  selection: MindMapSelection;
  history: MindMapHistoryState;
  scale: number;
  search: MindMapSearchState;
  searchOpen: boolean;
  searchText: string;
  panelOpen: boolean;
  painterActive: boolean;
  onSearchOpenChange: (open: boolean) => void;
  onSearchTextChange: (value: string) => void;
  onSearchNext: () => void;
  onSearchPrevious: () => void;
  onPanelToggle: () => void;
  onCommand: (command: string) => void;
  onPainter: () => void;
  onImage: () => void;
  onLink: () => void;
  onNote: () => void;
  onTags: () => void;
  onImport: () => void;
  onExport: () => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onFit: () => void;
  onResetView: () => void;
}) {
  const searchInputRef = useRef<HTMLInputElement>(null);
  const {
    selection,
    history,
    scale,
    search,
    searchOpen,
    searchText,
    panelOpen,
  } = props;
  const { hasSelection, canInsertSibling, canActOnNode } =
    getMindMapToolbarCapabilities(selection);

  useEffect(() => {
    if (searchOpen) searchInputRef.current?.focus();
  }, [searchOpen]);

  return (
    <div className="relative flex min-h-14 min-w-0 items-center border-b border-[var(--app-border-soft)] bg-[var(--app-panel-strong)] px-2">
      <div className="flex min-w-0 flex-1 items-center overflow-x-auto py-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        <ToolButton
          label="撤销"
          icon={Undo2}
          disabled={!history.canUndo}
          onClick={() => props.onCommand("BACK")}
        />
        <ToolButton
          label="重做"
          icon={Redo2}
          disabled={!history.canRedo}
          onClick={() => props.onCommand("FORWARD")}
        />
        <ToolButton
          label="格式刷"
          icon={Paintbrush}
          active={props.painterActive}
          disabled={!canActOnNode}
          onClick={props.onPainter}
        />
        <Divider />
        <ToolButton
          label="新增同级节点"
          icon={ListPlus}
          disabled={!canInsertSibling}
          onClick={() => props.onCommand("INSERT_NODE")}
        />
        <ToolButton
          label="新增子节点"
          icon={Plus}
          disabled={!canActOnNode}
          onClick={() => props.onCommand("INSERT_CHILD_NODE")}
        />
        <ToolButton
          label="删除节点"
          icon={Trash2}
          disabled={!hasSelection}
          onClick={() => props.onCommand("REMOVE_NODE")}
        />
        <Divider />
        <div className="hidden items-center lg:flex">
          <ToolButton
            label="节点图片"
            icon={ImageIcon}
            disabled={!hasSelection}
            onClick={props.onImage}
          />
          <ToolButton
            label="节点链接"
            icon={Link2}
            disabled={!hasSelection}
            onClick={props.onLink}
          />
          <ToolButton
            label="节点备注"
            icon={StickyNote}
            disabled={!hasSelection}
            onClick={props.onNote}
          />
          <ToolButton
            label="节点标签"
            icon={Tags}
            disabled={!hasSelection}
            onClick={props.onTags}
          />
          <Divider />
        </div>
        <ToolButton
          label="搜索节点"
          icon={Search}
          active={searchOpen}
          onClick={() => props.onSearchOpenChange(!searchOpen)}
        />
        <div className="hidden items-center md:flex">
          <ToolButton label="导入" icon={FileUp} onClick={props.onImport} />
          <ToolButton label="导出" icon={Download} onClick={props.onExport} />
        </div>
        <details className="relative ml-1 lg:hidden">
          <summary className="flex h-9 w-9 cursor-pointer list-none items-center justify-center rounded-[7px] text-[var(--app-text-muted)] hover:bg-[var(--app-hover-surface)] hover:text-[var(--app-text-strong)]">
            <MoreHorizontal className="h-[18px] w-[18px]" />
            <span className="sr-only">更多工具</span>
          </summary>
          <div className="absolute left-0 top-11 z-40 grid w-44 gap-1 border border-[var(--app-border)] bg-[var(--app-panel-strong)] p-2 shadow-[var(--app-shadow-lg)]">
            {[
              ["节点图片", ImageIcon, props.onImage],
              ["节点链接", Link2, props.onLink],
              ["节点备注", StickyNote, props.onNote],
              ["节点标签", Tags, props.onTags],
              ["导入", FileUp, props.onImport],
              ["导出", Download, props.onExport],
            ].map(([label, icon, action]) => {
              const IconComponent = icon as Icon;
              const needsNode = String(label).startsWith("节点");
              return (
                <button
                  key={String(label)}
                  type="button"
                  disabled={needsNode && !hasSelection}
                  onClick={action as () => void}
                  className="flex cursor-pointer items-center gap-2 rounded-[6px] px-2 py-2 text-left text-sm text-[var(--app-text-muted)] hover:bg-[var(--app-hover-surface)] hover:text-[var(--app-text-strong)] disabled:cursor-not-allowed disabled:opacity-35"
                >
                  <IconComponent className="h-4 w-4" />
                  {String(label)}
                </button>
              );
            })}
          </div>
        </details>
      </div>

      <div className="ml-2 hidden shrink-0 items-center border-l border-[var(--app-border-soft)] pl-2 sm:flex">
        <ToolButton label="缩小" icon={ZoomOut} onClick={props.onZoomOut} />
        <span className="w-12 text-center font-[family-name:var(--font-data)] text-xs text-[var(--app-text-muted)]">
          {Math.round(scale * 100)}%
        </span>
        <ToolButton label="放大" icon={ZoomIn} onClick={props.onZoomIn} />
        <ToolButton label="适应画布" icon={Maximize2} onClick={props.onFit} />
        <ToolButton
          label="居中并重置"
          icon={Focus}
          onClick={props.onResetView}
        />
      </div>
      <Divider />
      <ToolButton
        label={panelOpen ? "收起设置面板" : "展开设置面板"}
        icon={PanelRight}
        active={panelOpen}
        onClick={props.onPanelToggle}
      />

      {searchOpen ? (
        <search className="absolute left-2 top-[calc(100%+6px)] z-40 flex w-[min(390px,calc(100vw-32px))] items-center border border-[var(--app-border)] bg-[var(--app-panel-strong)] p-2 shadow-[var(--app-shadow-lg)]">
          <form
            className="contents"
            onSubmit={(event) => {
              event.preventDefault();
              props.onSearchNext();
            }}
          >
            <Search className="ml-1 h-4 w-4 shrink-0 text-[var(--app-text-subtle)]" />
            <label htmlFor="mind-map-search" className="sr-only">
              搜索节点
            </label>
            <input
              ref={searchInputRef}
              id="mind-map-search"
              value={searchText}
              onChange={(event) => props.onSearchTextChange(event.target.value)}
              className="min-w-0 flex-1 bg-transparent px-2 py-1 text-sm text-[var(--app-text)] outline-none"
              placeholder="输入节点文字"
            />
            <span className="mr-1 min-w-12 text-center text-xs text-[var(--app-text-subtle)]">
              {search.current}/{search.total}
            </span>
            <ToolButton
              label="上一个结果"
              icon={ChevronLeft}
              disabled={!search.total}
              onClick={props.onSearchPrevious}
            />
            <ToolButton
              label="下一个结果"
              icon={ChevronRight}
              disabled={!search.total}
              onClick={props.onSearchNext}
            />
          </form>
        </search>
      ) : null}
    </div>
  );
}
