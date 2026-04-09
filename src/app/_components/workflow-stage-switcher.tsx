"use client";

import React, { type ReactNode } from "react";

import { cn } from "~/app/_components/ui";
import type { WorkflowStageTab } from "~/app/_components/workflow-stage-config";

export function WorkflowStageSwitcher(props: {
  tabs: WorkflowStageTab[];
  activeTabId: string;
  panels: Record<string, ReactNode>;
  onChange?: (tabId: string) => void;
  className?: string;
}) {
  const { tabs, activeTabId, panels, onChange, className } = props;
  const activeTab = tabs.find((tab) => tab.id === activeTabId) ?? tabs[0] ?? null;
  const activePanel = activeTab ? panels[activeTab.id] : null;

  return (
    <section
      className={cn("grid gap-4", className)}
      data-stage-switcher="true"
      data-active-tab={activeTab?.id ?? ""}
    >
      <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-[repeat(auto-fit,minmax(0,1fr))]">
        {tabs.map((tab, index) => {
          const active = tab.id === activeTab?.id;

          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => onChange?.(tab.id)}
              className={cn(
                "border px-4 py-4 text-left transition-colors",
                active
                  ? "border-[var(--app-brand)] bg-[var(--app-surface-strong)] text-[var(--app-text-strong)]"
                  : "border-[var(--app-border-soft)] bg-[var(--app-surface)] text-[var(--app-text-muted)] hover:border-[var(--app-flame)] hover:text-[var(--app-text-strong)]",
              )}
            >
              <div className="flex items-center justify-between gap-3">
                <span className="text-[11px] uppercase tracking-[0.18em] text-[var(--app-text-subtle)]">
                  Step {index + 1}
                </span>
                <span className="app-workflow-index">
                  {String(index + 1).padStart(2, "0")}
                </span>
              </div>
              <div className="mt-3 text-xl leading-none text-[var(--app-text-strong)]">
                {tab.label}
              </div>
              <div className="mt-3 text-sm leading-6">{tab.summary}</div>
            </button>
          );
        })}
      </div>

      <div className="grid gap-6">{activePanel}</div>
    </section>
  );
}
