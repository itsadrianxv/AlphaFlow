"use client";

import type { ReactNode } from "react";
import { useRef, useState } from "react";
import { ResearchTargetPicker } from "~/app/_components/research-target-picker";
import type { ResearchTargetRef } from "~/contracts/research-target";
import { api } from "~/trpc/react";

type HighlightToNoteProps = {
  targetRef?: ResearchTargetRef | null;
  lastTargetRef?: ResearchTargetRef | null;
  floatingToolbar?: boolean;
  onLastTargetRefChange?: (targetRef: ResearchTargetRef | null) => void;
  source?: Record<string, unknown>;
  children: ReactNode;
};

type ToolbarPosition = {
  top: number;
  left: number;
};

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

export function HighlightToNote(props: HighlightToNoteProps) {
  const [selectedText, setSelectedText] = useState("");
  const [toolbarPosition, setToolbarPosition] =
    useState<ToolbarPosition | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [targetRef, setTargetRef] = useState<ResearchTargetRef | null>(
    props.lastTargetRef ?? props.targetRef ?? null,
  );
  const [lastNoteId, setLastNoteId] = useState("");
  const containerRef = useRef<HTMLDivElement | null>(null);
  const utils = api.useUtils();
  const createNoteMutation = api.researchTarget.createNote.useMutation({
    onSuccess: async (note) => {
      setLastNoteId(note.id);
      setSelectedText("");
      setToolbarPosition(null);
      setPickerOpen(false);
      await utils.researchTarget.listNotes.invalidate();
    },
  });
  const formatNoteMutation = api.researchTarget.formatNote.useMutation({
    onSuccess: async () => {
      await utils.researchTarget.listNotes.invalidate();
    },
  });

  function saveToTarget(nextTargetRef: ResearchTargetRef) {
    setTargetRef(nextTargetRef);
    props.onLastTargetRefChange?.(nextTargetRef);
    createNoteMutation.mutate({
      targetRef: nextTargetRef,
      kind: "highlight",
      contentMarkdown: selectedText,
      rawContent: selectedText,
      source: props.source ?? null,
      tags: ["高亮"],
    });
  }

  function captureSelection() {
    const selection = window.getSelection();
    const text = selection?.toString().trim() ?? "";
    if (text.length >= 2) {
      const range = selection?.rangeCount ? selection.getRangeAt(0) : null;
      const owner = range?.commonAncestorContainer;
      if (
        props.floatingToolbar &&
        owner &&
        containerRef.current &&
        !containerRef.current.contains(owner)
      ) {
        return;
      }

      const rect = range?.getBoundingClientRect();
      setSelectedText(text.slice(0, 4000));
      setPickerOpen(false);
      if (props.floatingToolbar && rect) {
        const maxLeft = Math.max(10, window.innerWidth - 370);
        setToolbarPosition({
          top: clamp(rect.top - 52, 10, window.innerHeight - 168),
          left: clamp(rect.left + rect.width / 2 - 114, 10, maxLeft),
        });
      }
      return;
    }

    if (props.floatingToolbar) {
      setSelectedText("");
      setToolbarPosition(null);
      setPickerOpen(false);
    }
  }

  const activeTargetRef = targetRef ?? props.lastTargetRef ?? null;

  if (props.floatingToolbar) {
    return (
      // biome-ignore lint/a11y/noStaticElementInteractions: 这里只捕获用户文本选择，不提供独立控件行为。
      <div
        ref={containerRef}
        className="grid gap-3"
        onMouseUp={captureSelection}
      >
        {props.children}
        {selectedText && toolbarPosition ? (
          <div
            className="fixed z-50"
            style={{
              top: toolbarPosition.top,
              left: toolbarPosition.left,
            }}
          >
            <div className="flex items-center gap-2 rounded-full border border-[var(--app-border)] bg-[var(--app-bg-floating)] p-1 shadow-[var(--app-shadow-lg)]">
              <button
                type="button"
                className="inline-flex h-9 items-center justify-center rounded-full px-3 text-xs font-medium text-[var(--app-text-strong)] transition-colors hover:bg-[rgba(255,255,255,0.08)] disabled:cursor-not-allowed disabled:opacity-60"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => {
                  if (!pickerOpen && activeTargetRef) {
                    setTargetRef(activeTargetRef);
                  }
                  setPickerOpen((current) => !current);
                }}
              >
                选择对象
              </button>
              <button
                type="button"
                className="inline-flex h-9 items-center justify-center rounded-full bg-white px-3 text-xs font-medium text-black transition-colors hover:bg-[rgba(255,255,255,0.86)] disabled:cursor-not-allowed disabled:bg-[var(--app-bg-raised)] disabled:text-[var(--app-text-soft)]"
                disabled={!activeTargetRef || createNoteMutation.isPending}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => {
                  if (activeTargetRef) {
                    saveToTarget(activeTargetRef);
                  }
                }}
              >
                上次对象
              </button>
            </div>
            {pickerOpen ? (
              <div className="mt-2 w-[min(360px,calc(100vw-20px))] rounded-[18px] border border-[var(--app-border)] bg-[var(--app-bg-floating)] p-3 shadow-[var(--app-shadow-lg)]">
                <ResearchTargetPicker
                  value={targetRef}
                  onChange={(value) => setTargetRef(value)}
                  compact
                />
                <div className="mt-3 flex items-center justify-end gap-2">
                  <button
                    type="button"
                    className="app-button"
                    onClick={() => {
                      setSelectedText("");
                      setToolbarPosition(null);
                      setPickerOpen(false);
                    }}
                  >
                    取消
                  </button>
                  <button
                    type="button"
                    className="app-button app-button-primary"
                    disabled={!targetRef || createNoteMutation.isPending}
                    onClick={() => {
                      if (targetRef) {
                        saveToTarget(targetRef);
                      }
                    }}
                  >
                    {createNoteMutation.isPending ? "绑定中" : "绑定"}
                  </button>
                </div>
                {createNoteMutation.error ? (
                  <div className="mt-2 text-sm text-[var(--app-danger)]">
                    {createNoteMutation.error.message}
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>
        ) : null}
        {lastNoteId ? (
          <div className="flex flex-wrap items-center gap-2 text-sm text-[var(--app-text-muted)]">
            <span>已绑定到投研对象。</span>
            <button
              type="button"
              className="app-button"
              disabled={formatNoteMutation.isPending}
              onClick={() =>
                formatNoteMutation.mutate({ id: lastNoteId, mode: "bullets" })
              }
            >
              {formatNoteMutation.isPending ? "格式化中" : "AI 格式化"}
            </button>
            {formatNoteMutation.error ? (
              <span className="text-[var(--app-danger)]">
                {formatNoteMutation.error.message}
              </span>
            ) : null}
          </div>
        ) : null}
      </div>
    );
  }

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: 这里只捕获用户文本选择，不提供独立控件行为。
    <div className="grid gap-3" onMouseUp={captureSelection}>
      {props.children}
      {selectedText ? (
        <div className="rounded-[12px] border border-[var(--app-border-soft)] bg-[var(--app-panel-soft)] p-3">
          <div className="text-sm font-medium text-[var(--app-text-strong)]">
            保存选中文本
          </div>
          <p className="mt-2 line-clamp-3 text-sm leading-6 text-[var(--app-text-muted)]">
            {selectedText}
          </p>
          <div className="mt-3">
            <ResearchTargetPicker
              value={targetRef}
              onChange={setTargetRef}
              compact
            />
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              className="app-button app-button-primary"
              disabled={!targetRef || createNoteMutation.isPending}
              onClick={() => {
                if (!targetRef) {
                  return;
                }
                saveToTarget(targetRef);
              }}
            >
              {createNoteMutation.isPending ? "保存中" : "保存到笔记"}
            </button>
            <button
              type="button"
              className="app-button"
              onClick={() => setSelectedText("")}
            >
              取消
            </button>
          </div>
          {createNoteMutation.error ? (
            <div className="mt-2 text-sm text-[var(--app-danger)]">
              {createNoteMutation.error.message}
            </div>
          ) : null}
        </div>
      ) : null}
      {lastNoteId ? (
        <div className="flex flex-wrap items-center gap-2 text-sm text-[var(--app-text-muted)]">
          <span>笔记已保存。</span>
          <button
            type="button"
            className="app-button"
            disabled={formatNoteMutation.isPending}
            onClick={() =>
              formatNoteMutation.mutate({ id: lastNoteId, mode: "bullets" })
            }
          >
            {formatNoteMutation.isPending ? "格式化中" : "AI 格式化"}
          </button>
          {formatNoteMutation.error ? (
            <span className="text-[var(--app-danger)]">
              {formatNoteMutation.error.message}
            </span>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
