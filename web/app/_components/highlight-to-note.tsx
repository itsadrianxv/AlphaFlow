"use client";

import { useRouter } from "next/navigation";
import type { ReactNode } from "react";
import { useRef, useState } from "react";
import { ResearchTargetPicker } from "~/app/_components/research-target-picker";
import { writePiAgentSelectionDraft } from "~/app/agent-runtime/selection-draft";
import type { ResearchTargetRef } from "~/contracts/research-target";
import { api } from "~/trpc/react";

type HighlightToNoteProps = {
  targetRef?: ResearchTargetRef | null;
  lastTargetRef?: ResearchTargetRef | null;
  floatingToolbar?: boolean;
  onLastTargetRefChange?: (targetRef: ResearchTargetRef | null) => void;
  piAgentHref?: string;
  source?: Record<string, unknown>;
  children: ReactNode;
};

type ToolbarPosition = {
  top: number;
  left: number;
};

type FloatingPickerMode = "company" | "industry" | "workflow_run";

const floatingPickerConfig: Record<
  FloatingPickerMode,
  {
    buttonLabel: string;
    pickerLabel: string;
    allowedTypes: ResearchTargetRef["type"][];
  }
> = {
  company: {
    buttonLabel: "保存到公司收藏",
    pickerLabel: "选择公司收藏",
    allowedTypes: ["company"],
  },
  industry: {
    buttonLabel: "保存到行业收藏",
    pickerLabel: "选择行业收藏",
    allowedTypes: ["industry"],
  },
  workflow_run: {
    buttonLabel: "保存到运行实例",
    pickerLabel: "选择运行实例",
    allowedTypes: ["workflow_run"],
  },
};

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

export function HighlightToNote(props: HighlightToNoteProps) {
  const router = useRouter();
  const [selectedText, setSelectedText] = useState("");
  const [toolbarPosition, setToolbarPosition] =
    useState<ToolbarPosition | null>(null);
  const [pickerMode, setPickerMode] = useState<FloatingPickerMode | null>(null);
  const [targetRef, setTargetRef] = useState<ResearchTargetRef | null>(
    props.lastTargetRef ?? props.targetRef ?? null,
  );
  const [lastNoteId, setLastNoteId] = useState("");
  const [piAgentDraftError, setPiAgentDraftError] = useState("");
  const containerRef = useRef<HTMLDivElement | null>(null);
  const utils = api.useUtils();
  const targetsQuery = api.researchTarget.listTargets.useQuery(
    { limit: 100 },
    { enabled: props.floatingToolbar && Boolean(selectedText) },
  );
  const createNoteMutation = api.researchTarget.createNote.useMutation({
    onSuccess: async (note) => {
      setLastNoteId(note.id);
      setSelectedText("");
      setToolbarPosition(null);
      setPickerMode(null);
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
      setPickerMode(null);
      setPiAgentDraftError("");
      if (props.floatingToolbar && rect) {
        const maxLeft = Math.max(10, window.innerWidth - 430);
        setToolbarPosition({
          top: clamp(rect.top - 52, 10, window.innerHeight - 168),
          left: clamp(rect.left + rect.width / 2 - 160, 10, maxLeft),
        });
      }
      return;
    }

    if (props.floatingToolbar) {
      setSelectedText("");
      setToolbarPosition(null);
      setPickerMode(null);
      setPiAgentDraftError("");
    }
  }

  function askPiAgent() {
    const saved = writePiAgentSelectionDraft({
      text: selectedText,
      createdAt: new Date().toISOString(),
      source: props.source ?? null,
    });

    if (!saved) {
      setPiAgentDraftError("无法暂存选中文本，请确认浏览器允许本地会话存储。");
      return;
    }

    router.push(props.piAgentHref ?? "/agent-runtime?draft=selection");
  }

  const activeTargetRef = targetRef ?? props.lastTargetRef ?? null;
  const activeTargetLabel = activeTargetRef
    ? targetsQuery.data?.find(
        (target) =>
          target.ref.type === activeTargetRef.type &&
          target.ref.id === activeTargetRef.id,
      )?.label
    : null;
  const activePickerConfig = pickerMode
    ? floatingPickerConfig[pickerMode]
    : null;

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
          // biome-ignore lint/a11y/noStaticElementInteractions: 这里只阻断浮层内部点击冒泡，交互控件由内部按钮和选择器提供。
          <div
            className="fixed z-50"
            onMouseDown={(event) => event.stopPropagation()}
            onMouseUp={(event) => event.stopPropagation()}
            style={{
              top: toolbarPosition.top,
              left: toolbarPosition.left,
            }}
          >
            <div className="flex flex-wrap items-center gap-2 rounded-[22px] border border-[var(--app-border)] bg-[var(--app-bg-floating)] p-1 shadow-[var(--app-shadow-lg)]">
              {(Object.keys(floatingPickerConfig) as FloatingPickerMode[]).map(
                (mode) => {
                  const config = floatingPickerConfig[mode];
                  const active = pickerMode === mode;

                  return (
                    <button
                      key={mode}
                      type="button"
                      className={[
                        "inline-flex h-9 items-center justify-center rounded-full px-3 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-60",
                        active
                          ? "bg-white text-black"
                          : "text-[var(--app-text-strong)] hover:bg-[rgba(255,255,255,0.08)]",
                      ].join(" ")}
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={() => {
                        setTargetRef((current) =>
                          current && config.allowedTypes.includes(current.type)
                            ? current
                            : null,
                        );
                        setPickerMode((current) =>
                          current === mode ? null : mode,
                        );
                      }}
                    >
                      {config.buttonLabel}
                    </button>
                  );
                },
              )}
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
                {activeTargetLabel
                  ? `保存到${activeTargetLabel}`
                  : "保存到上次对象"}
              </button>
              <button
                type="button"
                className="inline-flex h-9 items-center justify-center rounded-full border border-[var(--app-border-soft)] px-3 text-xs font-medium text-[var(--app-text-strong)] transition-colors hover:bg-[rgba(255,255,255,0.08)]"
                onMouseDown={(event) => event.preventDefault()}
                onClick={askPiAgent}
              >
                询问 Pi Agent
              </button>
            </div>
            {piAgentDraftError ? (
              <div className="mt-2 max-w-[390px] rounded-[12px] border border-[var(--app-danger-border)] bg-[var(--app-danger-surface)] px-3 py-2 text-xs text-[var(--app-danger)]">
                {piAgentDraftError}
              </div>
            ) : null}
            {activePickerConfig ? (
              <div className="mt-2 w-[min(390px,calc(100vw-20px))] rounded-[18px] border border-[var(--app-border)] bg-[var(--app-bg-floating)] p-3 shadow-[var(--app-shadow-lg)]">
                <ResearchTargetPicker
                  value={targetRef}
                  onChange={(value) => setTargetRef(value)}
                  allowedTypes={activePickerConfig.allowedTypes}
                  label={activePickerConfig.pickerLabel}
                  compact
                />
                <div className="mt-3 flex items-center justify-end gap-2">
                  <button
                    type="button"
                    className="app-button"
                    onClick={() => {
                      setSelectedText("");
                      setToolbarPosition(null);
                      setPickerMode(null);
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
