"use client";

import type { ReactNode } from "react";
/* biome-ignore lint/correctness/noUnusedImports: React stays in scope for the test JSX runtime. */
import React from "react";

import { cn } from "~/app/_components/ui";
import type { WorkflowStageTab } from "~/app/_components/workflow-stage-config";

export function WorkflowStageSwitcher(props: {
  tabs: WorkflowStageTab[];
  activeTabId: string;
  panels: Record<string, ReactNode>;
  onChange?: (tabId: string) => void;
  className?: string;
  panelClassName?: string;
}) {
  const { tabs, activeTabId, panels, onChange, className, panelClassName } =
    props;
  const activeTab =
    tabs.find((tab) => tab.id === activeTabId) ?? tabs[0] ?? null;
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
                "rounded-[16px] border px-4 py-4 text-left transition-colors",
                active
                  ? "border-[var(--app-border-strong)] bg-[var(--app-panel-strong)] text-[var(--app-text-strong)]"
                  : "border-[var(--app-border-soft)] bg-[var(--app-surface)] text-[var(--app-text-muted)] hover:border-[var(--app-flame)] hover:text-[var(--app-text-strong)]",
              )}
            >
              <div className="flex items-center justify-between gap-3">
                <span className="font-[family-name:var(--font-heading)] text-[11px] tracking-[0.14em] text-[var(--app-text-subtle)]">
                  步骤 {index + 1}
                </span>
                <span className="app-workflow-index">
                  {String(index + 1).padStart(2, "0")}
                </span>
              </div>
              <div className="mt-3 font-[family-name:var(--font-heading)] text-xl leading-none text-[var(--app-text-strong)]">
                {tab.label}
              </div>
              <div className="mt-3 text-sm leading-6">{tab.summary}</div>
            </button>
          );
        })}
      </div>

      {activePanel ? (
        <div className={cn("grid gap-6", panelClassName)}>{activePanel}</div>
      ) : null}
    </section>
  );
}
