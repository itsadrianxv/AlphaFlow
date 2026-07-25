"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { EvidenceCitation } from "~/server/domain/evidence-context/types";
import { api } from "~/trpc/react";

void React;

const CIRCLED_NUMBERS = [
  "①",
  "②",
  "③",
  "④",
  "⑤",
  "⑥",
  "⑦",
  "⑧",
  "⑨",
  "⑩",
  "⑪",
  "⑫",
  "⑬",
  "⑭",
  "⑮",
  "⑯",
  "⑰",
  "⑱",
  "⑲",
  "⑳",
] as const;

function formatValue(value: unknown): string {
  if (value === null || value === undefined) return "-";
  if (typeof value === "string") return value;
  return JSON.stringify(value, null, 2);
}

function ValueTable({ value }: { value: unknown }) {
  if (!value || typeof value !== "object") {
    return (
      <pre className="max-h-48 overflow-auto whitespace-pre-wrap text-xs leading-5 text-[var(--app-text-muted)]">
        {formatValue(value)}
      </pre>
    );
  }

  const entries = Array.isArray(value)
    ? value.map((item, index) => [String(index + 1), item] as const)
    : Object.entries(value);

  return (
    <div className="max-h-56 overflow-auto border border-[var(--app-border-soft)] bg-[var(--app-bg-inset)]">
      <table className="w-full border-collapse text-left text-xs">
        <tbody>
          {entries.map(([key, item]) => (
            <tr
              key={key}
              className="border-b border-[var(--app-border-soft)] last:border-b-0"
            >
              <th className="w-32 px-2 py-1.5 align-top font-medium text-[var(--app-text-subtle)]">
                {key}
              </th>
              <td className="whitespace-pre-wrap px-2 py-1.5 text-[var(--app-text-muted)]">
                {formatValue(item)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function citationLabel(
  citation: EvidenceCitation,
  index: number,
  variant: "default" | "circled",
  ordinalByEvidenceId?: Record<string, number>,
) {
  const ordinal = ordinalByEvidenceId?.[citation.evidenceItemId] ?? index + 1;
  if (variant === "circled") {
    return CIRCLED_NUMBERS[ordinal - 1] ?? String(ordinal);
  }
  return `[${citation.label ?? `证据 ${ordinal}`}]`;
}

export function EvidenceContextCitations({
  citations,
  evidenceItemIds,
  ordinalByEvidenceId,
  variant = "default",
}: {
  citations?: EvidenceCitation[];
  evidenceItemIds?: string[];
  ordinalByEvidenceId?: Record<string, number>;
  variant?: "default" | "circled";
}) {
  const normalizedCitations =
    citations ??
    [...new Set(evidenceItemIds ?? [])].map((evidenceItemId) => ({
      evidenceItemId,
    }));
  const [activeId, setActiveId] = useState<string>();
  const [pinnedId, setPinnedId] = useState<string>();
  const [anchor, setAnchor] = useState<HTMLElement>();
  const [position, setPosition] = useState({ left: 16, top: 16 });
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  const cardRef = useRef<HTMLDivElement>(null);
  const detailQuery = api.evidenceContext.getItem.useQuery(
    { itemId: activeId ?? "" },
    { enabled: Boolean(activeId) },
  );
  const lineageQuery = api.evidenceContext.lineage.useQuery(
    { itemId: activeId ?? "" },
    { enabled: Boolean(activeId) },
  );

  const cancelClose = useCallback(() => {
    if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
  }, []);
  const close = useCallback(() => {
    cancelClose();
    setActiveId(undefined);
    setPinnedId(undefined);
    setAnchor(undefined);
  }, [cancelClose]);
  const scheduleClose = useCallback(() => {
    cancelClose();
    closeTimerRef.current = setTimeout(() => {
      if (!pinnedId) {
        setActiveId(undefined);
        setAnchor(undefined);
      }
    }, 120);
  }, [cancelClose, pinnedId]);
  const open = useCallback(
    (evidenceItemId: string, element: HTMLElement) => {
      cancelClose();
      setActiveId(evidenceItemId);
      setAnchor(element);
    },
    [cancelClose],
  );

  useEffect(() => {
    if (!activeId || !anchor) return;
    const updatePosition = () => {
      const rect = anchor.getBoundingClientRect();
      const width = Math.min(420, window.innerWidth - 32);
      const cardHeight = cardRef.current?.offsetHeight ?? 260;
      const left = Math.min(
        Math.max(16, rect.left),
        Math.max(16, window.innerWidth - width - 16),
      );
      const below = rect.bottom + 8;
      const top =
        below + cardHeight <= window.innerHeight - 16
          ? below
          : Math.max(16, rect.top - cardHeight - 8);
      setPosition({ left, top });
    };
    updatePosition();
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    return () => {
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };
  }, [activeId, anchor]);

  useEffect(() => {
    if (!activeId) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    const onPointerDown = (event: PointerEvent) => {
      if (!pinnedId) return;
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (!cardRef.current?.contains(target) && !anchor?.contains(target))
        close();
    };
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("pointerdown", onPointerDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("pointerdown", onPointerDown);
    };
  }, [activeId, anchor, close, pinnedId]);

  useEffect(() => () => cancelClose(), [cancelClose]);

  if (normalizedCitations.length === 0) return null;

  const popover = activeId ? (
    <div
      ref={cardRef}
      role="dialog"
      aria-label="证据详情"
      onMouseEnter={cancelClose}
      onMouseLeave={scheduleClose}
      style={{ left: position.left, top: position.top }}
      className="fixed z-[100] w-[min(420px,calc(100vw-32px))] border border-[var(--app-border-strong)] bg-[var(--app-bg-floating)] p-3 text-left shadow-[0_2px_8px_var(--app-shadow-tooltip)]"
    >
      {detailQuery.isLoading ? (
        <div className="text-xs text-[var(--app-text-subtle)]">
          正在读取证据...
        </div>
      ) : detailQuery.data ? (
        <div className="grid gap-2">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 text-sm font-medium text-[var(--app-text-strong)]">
              {detailQuery.data.item.sourceName ??
                detailQuery.data.item.sourceType}
            </div>
            <button
              type="button"
              aria-label="关闭证据详情"
              onClick={close}
              className="h-6 w-6 shrink-0 cursor-pointer text-base leading-5 text-[var(--app-text-subtle)] hover:text-[var(--app-text-strong)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--app-accent-strong)]"
            >
              ×
            </button>
          </div>
          <div className="text-xs leading-5 text-[var(--app-text-muted)]">
            {detailQuery.data.item.extractedFact ??
              detailQuery.data.item.snippet ??
              "暂无事实摘要"}
          </div>
          <div className="text-[11px] text-[var(--app-text-subtle)]">
            {detailQuery.data.item.publishedAt ??
              detailQuery.data.item.observedAt ??
              "时间未知"}
          </div>
          {detailQuery.data.item.rawValueJson !== undefined ? (
            <ValueTable value={detailQuery.data.item.rawValueJson} />
          ) : null}
          {lineageQuery.data && lineageQuery.data.length > 1 ? (
            <div className="border-t border-[var(--app-border-soft)] pt-2 text-[11px] text-[var(--app-text-subtle)]">
              血缘记录 {lineageQuery.data.length} 条；当前版本为
              {detailQuery.data.item.recordKind === "correction"
                ? "修正"
                : detailQuery.data.item.recordKind === "derived" ||
                    detailQuery.data.item.recordKind === "model_derived"
                  ? "派生"
                  : "原始观测"}
              。
            </div>
          ) : null}
          {detailQuery.data.item.url ? (
            <a
              href={detailQuery.data.item.url}
              target="_blank"
              rel="noreferrer"
              className="text-xs text-[var(--app-brand)] underline decoration-dotted underline-offset-2"
            >
              打开来源网页
            </a>
          ) : null}
        </div>
      ) : (
        <div className="text-xs text-[var(--app-text-subtle)]">
          证据不可用或已被移除。
        </div>
      )}
    </div>
  ) : null;

  return (
    <span className="inline-flex flex-wrap items-center gap-1 align-baseline">
      {normalizedCitations.map((citation, index) => {
        const active = activeId === citation.evidenceItemId;
        return (
          <button
            key={citation.evidenceItemId}
            type="button"
            className="cursor-pointer border-b border-dotted border-[var(--app-brand)] px-0.5 text-[12px] text-[var(--app-brand)] transition-colors hover:bg-[var(--app-bg-raised)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--app-accent-strong)]"
            aria-label={`查看证据 ${ordinalByEvidenceId?.[citation.evidenceItemId] ?? index + 1}`}
            aria-expanded={active}
            onMouseEnter={(event) =>
              open(citation.evidenceItemId, event.currentTarget)
            }
            onMouseLeave={scheduleClose}
            onFocus={(event) =>
              open(citation.evidenceItemId, event.currentTarget)
            }
            onClick={(event) => {
              if (pinnedId === citation.evidenceItemId) {
                close();
              } else {
                open(citation.evidenceItemId, event.currentTarget);
                setPinnedId(citation.evidenceItemId);
              }
            }}
          >
            {citationLabel(citation, index, variant, ordinalByEvidenceId)}
          </button>
        );
      })}
      {popover && typeof document !== "undefined"
        ? createPortal(popover, document.body)
        : null}
    </span>
  );
}
