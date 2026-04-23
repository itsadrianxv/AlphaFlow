"use client";

/* biome-ignore lint/correctness/noUnusedImports: React is required for server-side JSX rendering in tests. */
import React from "react";
import type { RunView } from "~/modules/research/server/application/workflow/run-view";
import { StatusPill } from "~/shared/ui/primitives/ui";

type GraphView = RunView["user"] | RunView["debug"];

const stateToneMap: Record<
  GraphView["nodes"][number]["state"],
  "neutral" | "info" | "success" | "warning" | "danger"
> = {
  idle: "neutral",
  active: "info",
  paused: "warning",
  done: "success",
  failed: "danger",
  skipped: "neutral",
};

const stateLabelMap: Record<GraphView["nodes"][number]["state"], string> = {
  idle: "未开始",
  active: "进行中",
  paused: "已暂停",
  done: "已完成",
  failed: "失败",
  skipped: "已跳过",
};

function formatStatValue(value: unknown) {
  if (value === null || value === undefined) {
    return "-";
  }

  if (typeof value === "string" || typeof value === "number") {
    return String(value);
  }

  if (typeof value === "boolean") {
    return value ? "是" : "否";
  }

  return JSON.stringify(value);
}

export function FlowGraph(props: { graph: GraphView; mode: "user" | "debug" }) {
  const { graph, mode } = props;

  return (
    <div className="grid gap-4">
      <div className="grid gap-4 xl:grid-cols-[repeat(auto-fit,minmax(220px,1fr))]">
        {graph.stages.map((stage) => {
          const nodes = graph.nodes.filter((node) => node.stage === stage.key);

          if (nodes.length === 0) {
            return null;
          }

          return (
            <section
              key={stage.key}
              className="rounded-[18px] border border-[var(--app-border)] bg-[var(--app-panel)] p-4"
            >
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-xs uppercase tracking-[0.16em] text-[var(--app-text-soft)]">
                    {stage.key}
                  </p>
                  <h3 className="mt-1 text-base font-semibold text-[var(--app-text)]">
                    {stage.name}
                  </h3>
                </div>
                <StatusPill label={`${nodes.length} 个步骤`} tone="neutral" />
              </div>

              <div className="mt-4 grid gap-3">
                {nodes.map((node) => {
                  const active =
                    graph.activePath.includes(node.key) ||
                    node.state === "paused";
                  const statEntries = Object.entries(node.stats).slice(0, 3);

                  return (
                    <article
                      key={node.key}
                      className={`rounded-[14px] border px-4 py-3 ${
                        active
                          ? "border-[var(--app-accent-border)] bg-[var(--app-panel-soft)]"
                          : "border-[var(--app-border)] bg-[var(--app-panel)]"
                      }`}
                    >
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-[var(--app-text)]">
                            {node.name}
                          </p>
                          <p className="mt-1 text-xs leading-5 text-[var(--app-text-soft)]">
                            {node.goal}
                          </p>
                          {mode === "debug" ? (
                            <p className="mt-2 text-[11px] text-[var(--app-text-soft)]">
                              {node.key}
                            </p>
                          ) : null}
                        </div>
                        <StatusPill
                          label={stateLabelMap[node.state]}
                          tone={stateToneMap[node.state]}
                        />
                      </div>

                      {node.note ? (
                        <p className="mt-3 text-sm leading-6 text-[var(--app-text-muted)]">
                          {node.note}
                        </p>
                      ) : null}

                      {statEntries.length > 0 ? (
                        <div className="mt-3 flex flex-wrap gap-2">
                          {statEntries.map(([key, value]) => (
                            <span
                              key={`${node.key}-${key}`}
                              className="rounded-[999px] border border-[var(--app-border)] px-2 py-1 text-[11px] text-[var(--app-text-soft)]"
                            >
                              {key}: {formatStatValue(value)}
                            </span>
                          ))}
                        </div>
                      ) : null}
                    </article>
                  );
                })}
              </div>
            </section>
          );
        })}
      </div>

      {graph.edges.length > 0 ? (
        <div className="rounded-[14px] border border-[var(--app-border)] bg-[var(--app-panel)] p-4">
          <p className="text-xs uppercase tracking-[0.16em] text-[var(--app-text-soft)]">
            路径
          </p>
          <div className="mt-3 flex flex-wrap gap-2 text-xs text-[var(--app-text-muted)]">
            {graph.edges.map((edge) => (
              <span
                key={`${edge.from}-${edge.to}-${edge.when}`}
                className="rounded-[999px] border border-[var(--app-border)] px-2 py-1"
              >
                {edge.from} → {edge.to}
                {edge.when !== "ok" ? ` (${edge.when})` : ""}
              </span>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
