"use client";

import { useState } from "react";
import { ImpactMappingWorkspace } from "~/app/_components/impact-mapping-workspace";
import { MarketHeatmapClient } from "~/app/heatmap/market-heatmap-client";

type OverviewView = "heatmap" | "news";

const views: Array<{ id: OverviewView; label: string }> = [
  { id: "heatmap", label: "热力图" },
  { id: "news", label: "新闻雷达" },
];

export function OverviewWorkspace({ signedIn }: { signedIn: boolean }) {
  const [activeView, setActiveView] = useState<OverviewView>("heatmap");

  return (
    <div className="pb-[144px]">
      <div
        aria-label="概览视图"
        role="tablist"
        className="flex min-h-11 border-b border-[var(--app-border-soft)] px-4 md:px-6"
      >
        {views.map((view) => (
          <button
            key={view.id}
            type="button"
            role="tab"
            aria-selected={view.id === activeView}
            aria-controls={`overview-panel-${view.id}`}
            onClick={() => setActiveView(view.id)}
            className={`min-w-24 border-b-2 px-4 text-sm transition-colors duration-150 ${
              view.id === activeView
                ? "border-[var(--app-brand)] text-[var(--app-text-strong)]"
                : "border-transparent text-[var(--app-text-muted)] hover:text-[var(--app-text-strong)]"
            }`}
          >
            {view.label}
          </button>
        ))}
      </div>

      <div
        id={`overview-panel-${activeView}`}
        role="tabpanel"
        className="min-w-0"
      >
        {activeView === "heatmap" ? (
          <MarketHeatmapClient />
        ) : (
          <ImpactMappingWorkspace signedIn={signedIn} />
        )}
      </div>
    </div>
  );
}
