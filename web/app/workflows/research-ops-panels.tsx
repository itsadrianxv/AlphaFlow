"use client";

/* biome-ignore lint/correctness/noUnusedImports: React is required for server-side JSX rendering in tests. */
import React from "react";

import { MarkdownContent } from "~/app/_components/markdown-content";
import { Panel, StatusPill } from "~/app/_components/ui";
import {
  formatReflectionStatusLabel,
  formatReplanActionLabel,
  formatResearchArtifactLabel,
  formatResearchCapabilityLabel,
  formatResearchPriorityLabel,
  formatResearchRoleLabel,
  formatResearchStatusLabel,
  formatRuntimeIssueLabel,
  formatWorkflowNodeLabel,
} from "~/app/workflows/detail-labels";

type PlanUnit = {
  id: string;
  title: string;
  capability: string;
  role: string;
  priority: string;
  expectedArtifact: string;
  dependsOn: string[];
  fallbackCapabilities: string[];
  acceptanceCriteria: string[];
};

type UnitRun = {
  unitId: string;
  status: string;
  attempt?: number;
  repairCount?: number;
  qualityFlags?: string[];
  fallbackUsed?: string;
};

type ReflectionSummary = {
  status: string;
  summary: string;
  contractScore?: number;
  citationCoverage?: number;
  firstPartyRatio?: number;
  answeredQuestionCoverage?: number;
  missingRequirements: string[];
  unansweredQuestions: string[];
  qualityFlags: string[];
  suggestedFixes: string[];
};

type ReplanRecord = {
  replanId: string;
  iteration: number;
  triggerNodeKey: string;
  reason: string;
  action: string;
  resultSummary: string;
  fallbackProvider?: string;
  fallbackCapability?: string;
  missingAreas: string[];
};

type ResearchOpsPanelsProps = {
  result: unknown;
  className?: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function toStringList(value: unknown, limit = 12) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, limit);
}

function toNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

function parsePlan(result: unknown): PlanUnit[] {
  if (!isRecord(result) || !Array.isArray(result.researchPlan)) {
    return [];
  }

  return result.researchPlan.filter(isRecord).map((item) => ({
    id: typeof item.id === "string" ? item.id : "unit",
    title: typeof item.title === "string" ? item.title : "研究单元",
    capability:
      typeof item.capability === "string" ? item.capability : "unknown",
    role: typeof item.role === "string" ? item.role : "research_analyst",
    priority: typeof item.priority === "string" ? item.priority : "medium",
    expectedArtifact:
      typeof item.expectedArtifact === "string"
        ? item.expectedArtifact
        : "artifact",
    dependsOn: toStringList(item.dependsOn, 8),
    fallbackCapabilities: toStringList(item.fallbackCapabilities, 6),
    acceptanceCriteria: toStringList(item.acceptanceCriteria, 8),
  }));
}

function parseUnitRuns(result: unknown): UnitRun[] {
  if (!isRecord(result) || !Array.isArray(result.researchUnitRuns)) {
    return [];
  }

  return result.researchUnitRuns.filter(isRecord).map((item) => ({
    unitId: typeof item.unitId === "string" ? item.unitId : "unit",
    status: typeof item.status === "string" ? item.status : "planned",
    attempt: toNumber(item.attempt),
    repairCount: toNumber(item.repairCount),
    qualityFlags: toStringList(item.qualityFlags, 8),
    fallbackUsed:
      typeof item.fallbackUsed === "string" ? item.fallbackUsed : undefined,
  }));
}

function parseReflection(result: unknown): ReflectionSummary | null {
  if (!isRecord(result) || !isRecord(result.reflection)) {
    return null;
  }

  return {
    status:
      typeof result.reflection.status === "string"
        ? result.reflection.status
        : "warn",
    summary:
      typeof result.reflection.summary === "string"
        ? result.reflection.summary
        : "",
    contractScore: toNumber(result.reflection.contractScore),
    citationCoverage: toNumber(result.reflection.citationCoverage),
    firstPartyRatio: toNumber(result.reflection.firstPartyRatio),
    answeredQuestionCoverage: toNumber(
      result.reflection.answeredQuestionCoverage,
    ),
    missingRequirements: toStringList(
      result.reflection.missingRequirements,
      12,
    ),
    unansweredQuestions: toStringList(
      result.reflection.unansweredQuestions,
      12,
    ),
    qualityFlags: toStringList(result.reflection.qualityFlags, 12),
    suggestedFixes: toStringList(result.reflection.suggestedFixes, 12),
  };
}

function parseReplans(result: unknown): ReplanRecord[] {
  if (!isRecord(result) || !Array.isArray(result.replanRecords)) {
    return [];
  }

  return result.replanRecords.filter(isRecord).map((item, index) => ({
    replanId:
      typeof item.replanId === "string" ? item.replanId : `replan_${index + 1}`,
    iteration: toNumber(item.iteration) ?? index + 1,
    triggerNodeKey:
      typeof item.triggerNodeKey === "string" ? item.triggerNodeKey : "unknown",
    reason: typeof item.reason === "string" ? item.reason : "unknown",
    action: typeof item.action === "string" ? item.action : "unknown",
    resultSummary:
      typeof item.resultSummary === "string" ? item.resultSummary : "",
    fallbackProvider:
      typeof item.fallbackProvider === "string"
        ? item.fallbackProvider
        : undefined,
    fallbackCapability:
      typeof item.fallbackCapability === "string"
        ? item.fallbackCapability
        : undefined,
    missingAreas: toStringList(item.missingAreas, 8),
  }));
}

function buildPlanLevels(plan: PlanUnit[]) {
  const byId = new Map(plan.map((unit) => [unit.id, unit] as const));
  const depthCache = new Map<string, number>();

  const getDepth = (unit: PlanUnit): number => {
    const cached = depthCache.get(unit.id);
    if (cached !== undefined) {
      return cached;
    }

    if (unit.dependsOn.length === 0) {
      depthCache.set(unit.id, 0);
      return 0;
    }

    const depth =
      Math.max(
        ...unit.dependsOn.map((dependencyId) => {
          const dependency = byId.get(dependencyId);
          return dependency ? getDepth(dependency) : 0;
        }),
      ) + 1;
    depthCache.set(unit.id, depth);
    return depth;
  };

  const groups = new Map<number, PlanUnit[]>();
  for (const unit of plan) {
    const depth = getDepth(unit);
    groups.set(depth, [...(groups.get(depth) ?? []), unit]);
  }

  return [...groups.entries()]
    .sort((left, right) => left[0] - right[0])
    .map(([depth, units]) => ({
      depth,
      units,
    }));
}

function statusTone(status: string) {
  if (status === "completed") {
    return "success" as const;
  }
  if (status === "failed") {
    return "danger" as const;
  }
  if (status === "running") {
    return "info" as const;
  }
  if (status === "skipped") {
    return "warning" as const;
  }
  return "neutral" as const;
}

function statusLabel(status: string) {
  return formatResearchStatusLabel(status);
}

function formatPercent(value?: number) {
  if (value === undefined) {
    return "-";
  }

  return `${Math.round(value * 100)}%`;
}

export function ResearchOpsPanels(props: ResearchOpsPanelsProps) {
  const plan = parsePlan(props.result);
  const planLevels = buildPlanLevels(plan);
  const runs = parseUnitRuns(props.result);
  const reflection = parseReflection(props.result);
  const replans = parseReplans(props.result);
  const runByUnitId = new Map(runs.map((run) => [run.unitId, run] as const));

  if (plan.length === 0 && !reflection && replans.length === 0) {
    return null;
  }

  return (
    <div className={props.className}>
      {plan.length > 0 ? (
        <Panel
          title="研究计划图谱"
          description="按依赖深度展示研究单元、角色分工、交付物和回退能力。"
        >
          <div className="grid gap-4">
            {planLevels.map((level) => (
              <section
                key={`plan-depth-${level.depth}`}
                className="rounded-[12px] border border-[var(--app-border)] bg-[var(--app-panel-soft)] p-4"
              >
                <div className="mb-4 flex items-center justify-between gap-3">
                  <div className="text-sm font-medium text-[var(--app-text)]">
                    第 {level.depth + 1} 层
                  </div>
                  <StatusPill
                    label={`${level.units.length} 个单元`}
                    tone="neutral"
                  />
                </div>

                <div className="grid gap-3 lg:grid-cols-2">
                  {level.units.map((unit) => {
                    const run = runByUnitId.get(unit.id);
                    return (
                      <article
                        key={unit.id}
                        className="rounded-[10px] border border-[var(--app-border)] bg-[var(--app-panel)] p-4"
                      >
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div>
                            <div className="text-sm font-medium text-[var(--app-text)]">
                              {unit.title}
                            </div>
                            <div className="mt-1 text-xs text-[var(--app-text-soft)]">
                              {formatResearchCapabilityLabel(unit.capability)} ·{" "}
                              {formatResearchRoleLabel(unit.role)}
                            </div>
                          </div>
                          <div className="flex flex-wrap gap-2">
                            <StatusPill
                              label={formatResearchPriorityLabel(unit.priority)}
                              tone="info"
                            />
                            <StatusPill
                              label={statusLabel(run?.status ?? "planned")}
                              tone={statusTone(run?.status ?? "planned")}
                            />
                          </div>
                        </div>

                        <div className="mt-3 grid gap-2 text-xs text-[var(--app-text-muted)]">
                          <div>
                            交付物：
                            {formatResearchArtifactLabel(unit.expectedArtifact)}
                          </div>
                          <div>
                            依赖：
                            {unit.dependsOn.length > 0
                              ? unit.dependsOn
                                  .map((item) => formatWorkflowNodeLabel(item))
                                  .join("，")
                              : "无"}
                          </div>
                          <div>
                            回退能力：
                            {unit.fallbackCapabilities.length > 0
                              ? unit.fallbackCapabilities
                                  .map((item) =>
                                    formatResearchCapabilityLabel(item),
                                  )
                                  .join("，")
                              : "无"}
                          </div>
                          {run ? (
                            <div>
                              尝试 {run.attempt ?? 1} 次 · 修复{" "}
                              {run.repairCount ?? 0} 次
                              {run.fallbackUsed
                                ? ` · 回退至 ${formatResearchCapabilityLabel(run.fallbackUsed)}`
                                : ""}
                            </div>
                          ) : null}
                        </div>

                        {unit.acceptanceCriteria.length > 0 ? (
                          <div className="mt-3 space-y-1 text-xs text-[var(--app-text-muted)]">
                            {unit.acceptanceCriteria
                              .slice(0, 3)
                              .map((criterion) => (
                                <p key={criterion}>- {criterion}</p>
                              ))}
                          </div>
                        ) : null}

                        {run?.qualityFlags && run.qualityFlags.length > 0 ? (
                          <div className="mt-3 flex flex-wrap gap-2">
                            {run.qualityFlags.map((flag) => (
                              <StatusPill
                                key={flag}
                                label={formatRuntimeIssueLabel(flag)}
                                tone="warning"
                              />
                            ))}
                          </div>
                        ) : null}
                      </article>
                    );
                  })}
                </div>
              </section>
            ))}
          </div>
        </Panel>
      ) : null}

      {replans.length > 0 ? (
        <Panel
          title="重规划历史"
          description="记录执行过程中因缺口、数据源异常或回退策略触发的后续动作。"
        >
          <div className="grid gap-3">
            {replans.map((record) => (
              <article
                key={record.replanId}
                className="rounded-[10px] border border-[var(--app-border)] bg-[var(--app-panel)] p-4"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <StatusPill
                    label={`第 ${record.iteration} 次重规划`}
                    tone="info"
                  />
                  <StatusPill
                    label={formatRuntimeIssueLabel(record.reason)}
                    tone="warning"
                  />
                  <StatusPill
                    label={formatReplanActionLabel(record.action)}
                    tone="neutral"
                  />
                  {record.fallbackCapability ? (
                    <StatusPill
                      label={`回退 ${formatResearchCapabilityLabel(record.fallbackCapability)}`}
                      tone="warning"
                    />
                  ) : null}
                </div>
                <MarkdownContent
                  content={record.resultSummary}
                  compact
                  className="mt-3"
                />
                <p className="mt-2 text-xs text-[var(--app-text-soft)]">
                  触发节点：{formatWorkflowNodeLabel(record.triggerNodeKey)}
                </p>
                {record.missingAreas.length > 0 ? (
                  <div className="mt-3 space-y-1 text-xs text-[var(--app-text-muted)]">
                    {record.missingAreas.map((item) => (
                      <p key={item}>- {formatRuntimeIssueLabel(item)}</p>
                    ))}
                  </div>
                ) : null}
              </article>
            ))}
          </div>
        </Panel>
      ) : null}

      {reflection ? (
        <Panel
          title="反思摘要"
          description="软门禁评审结果会保留合同得分、覆盖率和修复建议，但不阻塞最终交付。"
        >
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            <div className="rounded-[10px] border border-[var(--app-border)] bg-[var(--app-panel)] px-4 py-3">
              <div className="text-xs text-[var(--app-text-soft)]">状态</div>
              <div className="mt-2">
                <StatusPill
                  label={formatReflectionStatusLabel(reflection.status)}
                  tone={statusTone(
                    reflection.status === "pass"
                      ? "completed"
                      : reflection.status === "fail"
                        ? "failed"
                        : "skipped",
                  )}
                />
              </div>
            </div>
            <div className="rounded-[10px] border border-[var(--app-border)] bg-[var(--app-panel)] px-4 py-3">
              <div className="text-xs text-[var(--app-text-soft)]">
                合同得分
              </div>
              <div className="app-data mt-2 text-lg text-[var(--app-text)]">
                {reflection.contractScore ?? "-"}
              </div>
            </div>
            <div className="rounded-[10px] border border-[var(--app-border)] bg-[var(--app-panel)] px-4 py-3">
              <div className="text-xs text-[var(--app-text-soft)]">
                引用覆盖
              </div>
              <div className="app-data mt-2 text-lg text-[var(--app-text)]">
                {formatPercent(reflection.citationCoverage)}
              </div>
            </div>
            <div className="rounded-[10px] border border-[var(--app-border)] bg-[var(--app-panel)] px-4 py-3">
              <div className="text-xs text-[var(--app-text-soft)]">
                一手占比
              </div>
              <div className="app-data mt-2 text-lg text-[var(--app-text)]">
                {formatPercent(reflection.firstPartyRatio)}
              </div>
            </div>
          </div>

          <div className="mt-4 rounded-[10px] border border-[var(--app-border)] bg-[var(--app-panel)] p-4 text-sm leading-6 text-[var(--app-text)]">
            {reflection.summary ? (
              <MarkdownContent content={reflection.summary} compact />
            ) : (
              "暂无反思摘要。"
            )}
          </div>

          <div className="mt-4 grid gap-4 xl:grid-cols-3">
            <div className="rounded-[10px] border border-[var(--app-border)] bg-[var(--app-panel)] p-4">
              <div className="text-sm font-medium text-[var(--app-text)]">
                质量标记
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                {reflection.qualityFlags.length > 0 ? (
                  reflection.qualityFlags.map((flag) => (
                    <StatusPill
                      key={flag}
                      label={formatRuntimeIssueLabel(flag)}
                      tone="warning"
                    />
                  ))
                ) : (
                  <StatusPill label="无" tone="success" />
                )}
              </div>
            </div>

            <div className="rounded-[10px] border border-[var(--app-border)] bg-[var(--app-panel)] p-4">
              <div className="text-sm font-medium text-[var(--app-text)]">
                待补要求
              </div>
              <div className="mt-3 space-y-1 text-xs text-[var(--app-text-muted)]">
                {reflection.missingRequirements.length > 0 ? (
                  reflection.missingRequirements.map((item) => (
                    <p key={item}>- {formatRuntimeIssueLabel(item)}</p>
                  ))
                ) : (
                  <p>- 无</p>
                )}
              </div>
            </div>

            <div className="rounded-[10px] border border-[var(--app-border)] bg-[var(--app-panel)] p-4">
              <div className="text-sm font-medium text-[var(--app-text)]">
                修复建议
              </div>
              <div className="mt-3 space-y-1 text-xs text-[var(--app-text-muted)]">
                {reflection.suggestedFixes.length > 0 ? (
                  reflection.suggestedFixes.map((item) => (
                    <p key={item}>- {item}</p>
                  ))
                ) : (
                  <p>- 无</p>
                )}
              </div>
            </div>
          </div>
        </Panel>
      ) : null}
    </div>
  );
}
