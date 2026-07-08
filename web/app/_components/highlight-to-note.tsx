"use client";

import type { ReactNode } from "react";
import { useState } from "react";
import { ResearchTargetPicker } from "~/app/_components/research-target-picker";
import type { ResearchTargetRef } from "~/contracts/research-target";
import { api } from "~/trpc/react";

type HighlightToNoteProps = {
  targetRef?: ResearchTargetRef | null;
  source?: Record<string, unknown>;
  children: ReactNode;
};

export function HighlightToNote(props: HighlightToNoteProps) {
  const [selectedText, setSelectedText] = useState("");
  const [targetRef, setTargetRef] = useState<ResearchTargetRef | null>(
    props.targetRef ?? null,
  );
  const [lastNoteId, setLastNoteId] = useState("");
  const utils = api.useUtils();
  const createNoteMutation = api.researchTarget.createNote.useMutation({
    onSuccess: async (note) => {
      setLastNoteId(note.id);
      setSelectedText("");
      await utils.researchTarget.listNotes.invalidate();
    },
  });
  const formatNoteMutation = api.researchTarget.formatNote.useMutation({
    onSuccess: async () => {
      await utils.researchTarget.listNotes.invalidate();
    },
  });

  function captureSelection() {
    const text = window.getSelection()?.toString().trim() ?? "";
    if (text.length >= 2) {
      setSelectedText(text.slice(0, 4000));
    }
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
                createNoteMutation.mutate({
                  targetRef,
                  kind: "highlight",
                  contentMarkdown: selectedText,
                  rawContent: selectedText,
                  source: props.source ?? null,
                  tags: ["高亮"],
                });
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
