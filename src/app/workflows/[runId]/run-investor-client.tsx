"use client";

import Link from "next/link";

import {
  ActionBanner,
  EmptyState,
  KeyPointList,
  KpiCard,
  Panel,
  StatusPill,
  statusTone,
  WorkspaceShell,
} from "~/app/_components/ui";
import {
  buildResearchDigest,
  extractConfidenceAnalysis,
} from "~/app/workflows/research-view-models";
import {
  COMPANY_RESEARCH_TEMPLATE_CODE,
  QUICK_RESEARCH_TEMPLATE_CODE,
  SCREENING_INSIGHT_PIPELINE_TEMPLATE_CODE,
  SCREENING_TO_TIMING_TEMPLATE_CODE,
  TIMING_REVIEW_LOOP_TEMPLATE_CODE,
  TIMING_SIGNAL_PIPELINE_TEMPLATE_CODE,
  WATCHLIST_TIMING_CARDS_PIPELINE_TEMPLATE_CODE,
  WATCHLIST_TIMING_PIPELINE_TEMPLATE_CODE,
} from "~/server/domain/workflow/types";
import { api } from "~/trpc/react";

type RunInvestorClientProps = {
  runId: string;
};

function formatDate(value?: Date | null) {
  if (!value) {
    return "-";
  }

  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(value);
}

function formatConfidenceLevel(level?: string) {
  switch (level) {
    case "high":
      return "HIGH";
    case "medium":
      return "MEDIUM";
    case "low":
      return "LOW";
    default:
      return "UNKNOWN";
  }
}

const statusLabels: Record<string, string> = {
  PENDING: "Waiting",
  RUNNING: "Running",
  SUCCEEDED: "Succeeded",
  FAILED: "Failed",
  CANCELLED: "Cancelled",
};

function getBackLink(templateCode?: string) {
  if (templateCode === COMPANY_RESEARCH_TEMPLATE_CODE) {
    return "/company-research";
  }

  if (
    templateCode === TIMING_SIGNAL_PIPELINE_TEMPLATE_CODE ||
    templateCode === WATCHLIST_TIMING_CARDS_PIPELINE_TEMPLATE_CODE ||
    templateCode === WATCHLIST_TIMING_PIPELINE_TEMPLATE_CODE ||
    templateCode === TIMING_REVIEW_LOOP_TEMPLATE_CODE
  ) {
    return "/timing";
  }

  if (
    templateCode === SCREENING_INSIGHT_PIPELINE_TEMPLATE_CODE ||
    templateCode === SCREENING_TO_TIMING_TEMPLATE_CODE
  ) {
    return "/screening";
  }

  return "/workflows";
}

function getSection(templateCode?: string) {
  if (templateCode === COMPANY_RESEARCH_TEMPLATE_CODE) {
    return "companyResearch" as const;
  }

  if (
    templateCode === TIMING_SIGNAL_PIPELINE_TEMPLATE_CODE ||
    templateCode === WATCHLIST_TIMING_CARDS_PIPELINE_TEMPLATE_CODE ||
    templateCode === WATCHLIST_TIMING_PIPELINE_TEMPLATE_CODE ||
    templateCode === TIMING_REVIEW_LOOP_TEMPLATE_CODE
  ) {
    return "timing" as const;
  }

  if (
    templateCode === SCREENING_INSIGHT_PIPELINE_TEMPLATE_CODE ||
    templateCode === SCREENING_TO_TIMING_TEMPLATE_CODE
  ) {
    return "screening" as const;
  }

  return "workflows" as const;
}

function getTitle(templateCode?: string) {
  if (templateCode === COMPANY_RESEARCH_TEMPLATE_CODE) {
    return "Company Conclusion";
  }

  if (templateCode === QUICK_RESEARCH_TEMPLATE_CODE) {
    return "Industry Conclusion";
  }

  if (
    templateCode === TIMING_SIGNAL_PIPELINE_TEMPLATE_CODE ||
    templateCode === WATCHLIST_TIMING_CARDS_PIPELINE_TEMPLATE_CODE ||
    templateCode === WATCHLIST_TIMING_PIPELINE_TEMPLATE_CODE ||
    templateCode === TIMING_REVIEW_LOOP_TEMPLATE_CODE
  ) {
    return "Timing Conclusion";
  }

  return "Research Conclusion";
}

export function RunInvestorClient({ runId }: RunInvestorClientProps) {
  const utils = api.useUtils();

  const runQuery = api.workflow.getRun.useQuery(
    { runId },
    {
      refetchInterval: (query) => {
        const status = query.state.data?.status;

        if (
          status === "SUCCEEDED" ||
          status === "FAILED" ||
          status === "CANCELLED"
        ) {
          return false;
        }

        return 10_000;
      },
    },
  );

  const cancelMutation = api.workflow.cancelRun.useMutation({
    onSuccess: async () => {
      await utils.workflow.getRun.invalidate({ runId });
    },
  });

  const run = runQuery.data;
  const digest = buildResearchDigest({
    templateCode: run?.template.code,
    query: run?.query,
    status: run?.status,
    progressPercent: run?.progressPercent,
    currentNodeKey: run?.currentNodeKey,
    result: run?.result,
  });
  const confidenceAnalysis = extractConfidenceAnalysis(run?.result);
  const nextSectionItems =
    digest.gaps.length > 0 ? digest.gaps : digest.nextActions;

  return (
    <WorkspaceShell
      section={getSection(run?.template.code)}
      eyebrow="Investment Conclusion"
      title={getTitle(run?.template.code)}
      description="Keep the main investment conclusion, evidence summary, risks, next actions, and confidence analysis in one place."
      actions={
        <>
          <Link href={getBackLink(run?.template.code)} className="app-button">
            Back
          </Link>
          <Link href={`/workflows/${runId}/debug`} className="app-button">
            Debug View
          </Link>
          {run && (run.status === "RUNNING" || run.status === "PENDING") ? (
            <button
              type="button"
              onClick={() => cancelMutation.mutate({ runId })}
              className="app-button app-button-danger"
            >
              Cancel
            </button>
          ) : null}
        </>
      }
      summary={
        <>
          <KpiCard
            label="Status"
            value={run ? (statusLabels[run.status] ?? run.status) : "-"}
            hint={run?.currentNodeKey ?? "No active node"}
            tone={statusTone(run?.status)}
          />
          <KpiCard
            label="Created"
            value={formatDate(run?.createdAt)}
            hint="Run creation time"
            tone="neutral"
          />
          <KpiCard
            label="Completed"
            value={formatDate(run?.completedAt)}
            hint="Refreshes while the run is active"
            tone="info"
          />
          <KpiCard
            label="Primary Metric"
            value={digest.metrics[0]?.value ?? "-"}
            hint={digest.metrics[0]?.label ?? "No metric"}
            tone={digest.verdictTone}
          />
        </>
      }
    >
      {runQuery.isLoading ? (
        <EmptyState
          title="Loading conclusion details"
          description="The result summary will appear after the run data is loaded."
        />
      ) : !run ? (
        <EmptyState
          title="Run not found"
          description="The run may have been removed, or the current account may not have access to it."
        />
      ) : (
        <>
          <ActionBanner
            title={digest.headline}
            description={digest.summary}
            tone={digest.verdictTone}
            actions={
              <StatusPill
                label={digest.verdictLabel}
                tone={digest.verdictTone}
              />
            }
          />

          {run.errorMessage ? (
            <div className="rounded-[16px] border border-[rgba(201,119,132,0.34)] bg-[rgba(81,33,43,0.22)] px-4 py-3 text-sm text-[var(--app-danger)]">
              {run.errorCode ? `${run.errorCode}: ` : ""}
              {run.errorMessage}
            </div>
          ) : null}

          <Panel
            title="Confidence Analysis"
            description="Adds support, insufficient-evidence, and contradiction signals without rewriting the original conclusion."
          >
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
              <div className="rounded-[12px] border border-[var(--app-border)] bg-[rgba(16,21,29,0.84)] px-4 py-3">
                <div className="text-xs text-[var(--app-text-soft)]">
                  Confidence Score
                </div>
                <div className="app-data mt-2 text-lg text-[var(--app-text)]">
                  {confidenceAnalysis?.finalScore ?? "N/A"}
                </div>
              </div>
              <div className="rounded-[12px] border border-[var(--app-border)] bg-[rgba(16,21,29,0.84)] px-4 py-3">
                <div className="text-xs text-[var(--app-text-soft)]">Level</div>
                <div className="app-data mt-2 text-lg text-[var(--app-text)]">
                  {formatConfidenceLevel(confidenceAnalysis?.level)}
                </div>
              </div>
              <div className="rounded-[12px] border border-[var(--app-border)] bg-[rgba(16,21,29,0.84)] px-4 py-3">
                <div className="text-xs text-[var(--app-text-soft)]">
                  Supported/Insufficient/Contradicted
                </div>
                <div className="app-data mt-2 text-lg text-[var(--app-text)]">
                  {confidenceAnalysis
                    ? `${confidenceAnalysis.supportedCount}/${confidenceAnalysis.insufficientCount}/${confidenceAnalysis.contradictedCount}`
                    : "0/0/0"}
                </div>
              </div>
              <div className="rounded-[12px] border border-[var(--app-border)] bg-[rgba(16,21,29,0.84)] px-4 py-3">
                <div className="text-xs text-[var(--app-text-soft)]">
                  Evidence Coverage
                </div>
                <div className="app-data mt-2 text-lg text-[var(--app-text)]">
                  {confidenceAnalysis
                    ? `${confidenceAnalysis.evidenceCoverageScore}%`
                    : "N/A"}
                </div>
              </div>
            </div>

            {confidenceAnalysis?.notes.length ? (
              <div className="mt-4 grid gap-2">
                {confidenceAnalysis.notes.map((note) => (
                  <div
                    key={note}
                    className="rounded-[12px] border border-[var(--app-border)] bg-[rgba(12,16,22,0.84)] px-3 py-2 text-sm leading-6 text-[var(--app-text-muted)]"
                  >
                    {note}
                  </div>
                ))}
              </div>
            ) : null}

            {confidenceAnalysis?.claims.length ? (
              <div className="mt-4 grid gap-3">
                {confidenceAnalysis.claims.map((claim) => (
                  <details
                    key={claim.claimId}
                    className="rounded-[12px] border border-[var(--app-border)] bg-[rgba(12,16,22,0.84)] px-4 py-3"
                  >
                    <summary className="cursor-pointer text-sm text-[var(--app-text)]">
                      {claim.claimText}
                    </summary>
                    <div className="mt-3 space-y-2 text-sm text-[var(--app-text-muted)]">
                      <p>Label: {claim.label}</p>
                      <p>{claim.explanation}</p>
                      {claim.matchedReferenceIds.length > 0 ? (
                        <p>
                          Matched references:{" "}
                          {claim.matchedReferenceIds.join(", ")}
                        </p>
                      ) : null}
                    </div>
                  </details>
                ))}
              </div>
            ) : null}
          </Panel>

          <Panel
            title="Key Metrics"
            description="These metrics help judge whether the run is worth reading further."
          >
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
              {digest.metrics.length === 0 ? (
                <div className="rounded-[12px] border border-[var(--app-border)] bg-[rgba(16,21,29,0.84)] px-4 py-3 text-sm text-[var(--app-text-muted)]">
                  No structured metrics are available yet.
                </div>
              ) : (
                digest.metrics.map((metric) => (
                  <div
                    key={`${metric.label}-${metric.value}`}
                    className="rounded-[12px] border border-[var(--app-border)] bg-[rgba(16,21,29,0.84)] px-4 py-3"
                  >
                    <div className="text-xs text-[var(--app-text-soft)]">
                      {metric.label}
                    </div>
                    <div className="app-data mt-2 text-lg text-[var(--app-text)]">
                      {metric.value}
                    </div>
                  </div>
                ))
              )}
            </div>
          </Panel>

          <div className="grid gap-4 xl:grid-cols-2">
            <KeyPointList
              title="Bull Case"
              items={digest.bullPoints}
              emptyText="No bull case has been extracted."
              tone="success"
            />
            <KeyPointList
              title="Risks"
              items={digest.bearPoints}
              emptyText="No explicit risks have been extracted."
              tone="warning"
            />
            <KeyPointList
              title="Evidence Summary"
              items={digest.evidence}
              emptyText="No structured evidence summary is available."
              tone="info"
            />
            <KeyPointList
              title={digest.gaps.length > 0 ? "Open Gaps" : "Next Actions"}
              items={nextSectionItems}
              emptyText="No follow-up action is listed."
              tone="neutral"
            />
          </div>
        </>
      )}
    </WorkspaceShell>
  );
}
