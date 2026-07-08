"use client";

import { useState } from "react";
import { MarkdownContent } from "~/app/_components/markdown-content";
import {
  EmptyState,
  Panel,
  StatusPill,
  WorkspaceShell,
} from "~/app/_components/ui";
import { api } from "~/trpc/react";

function splitTags(value: string) {
  return value
    .split(/[,，、\n]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function formatDate(value?: string | null) {
  if (!value) {
    return "-";
  }

  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function targetTypeLabel(type: string) {
  switch (type) {
    case "company":
      return "公司";
    case "industry":
      return "行业";
    case "watchlist":
      return "自选股";
    case "space":
      return "Space";
    case "workflow_run":
      return "Run";
    default:
      return type;
  }
}

export function ResearchTargetsClient() {
  const utils = api.useUtils();
  const [stockCode, setStockCode] = useState("");
  const [companyName, setCompanyName] = useState("");
  const [companyReason, setCompanyReason] = useState("");
  const [companyTags, setCompanyTags] = useState("");
  const [industryName, setIndustryName] = useState("");
  const [industrySource, setIndustrySource] = useState("自定义主题");
  const [industryReason, setIndustryReason] = useState("");
  const [industryTags, setIndustryTags] = useState("");

  const companiesQuery = api.researchTarget.listCompanies.useQuery();
  const industriesQuery = api.researchTarget.listIndustries.useQuery();
  const notesQuery = api.researchTarget.listNotes.useQuery({
    limit: 12,
    offset: 0,
  });
  const snapshotsQuery = api.researchTarget.listFinancialSnapshots.useQuery({
    limit: 8,
    offset: 0,
  });
  const artifactsQuery = api.researchTarget.listArtifacts.useQuery({
    limit: 8,
    offset: 0,
  });

  const createCompanyMutation = api.researchTarget.createCompany.useMutation({
    onSuccess: async () => {
      setStockCode("");
      setCompanyName("");
      setCompanyReason("");
      setCompanyTags("");
      await Promise.all([
        utils.researchTarget.listCompanies.invalidate(),
        utils.researchTarget.listTargets.invalidate(),
      ]);
    },
  });
  const createIndustryMutation = api.researchTarget.createIndustry.useMutation({
    onSuccess: async () => {
      setIndustryName("");
      setIndustryReason("");
      setIndustryTags("");
      await Promise.all([
        utils.researchTarget.listIndustries.invalidate(),
        utils.researchTarget.listTargets.invalidate(),
      ]);
    },
  });
  const archiveCompanyMutation = api.researchTarget.archiveCompany.useMutation({
    onSuccess: async () => {
      await Promise.all([
        utils.researchTarget.listCompanies.invalidate(),
        utils.researchTarget.listTargets.invalidate(),
      ]);
    },
  });
  const archiveIndustryMutation =
    api.researchTarget.archiveIndustry.useMutation({
      onSuccess: async () => {
        await Promise.all([
          utils.researchTarget.listIndustries.invalidate(),
          utils.researchTarget.listTargets.invalidate(),
        ]);
      },
    });

  return (
    <WorkspaceShell
      section="researchTargets"
      title="投研收藏"
      description="统一管理收藏公司、收藏行业，以及从筛选、Agent 和研究结果沉淀下来的笔记与报告。"
      contentWidth="wide"
      titleSize="compact"
      actions={null}
    >
      <div className="grid gap-6 xl:grid-cols-2">
        <Panel title="收藏公司">
          <div className="grid gap-3">
            <div className="grid gap-2 md:grid-cols-[120px_minmax(0,1fr)]">
              <input
                value={stockCode}
                onChange={(event) =>
                  setStockCode(
                    event.target.value.replace(/\D/g, "").slice(0, 6),
                  )
                }
                placeholder="股票代码"
                className="app-input"
              />
              <input
                value={companyName}
                onChange={(event) => setCompanyName(event.target.value)}
                placeholder="公司名称"
                className="app-input"
              />
            </div>
            <textarea
              value={companyReason}
              onChange={(event) => setCompanyReason(event.target.value)}
              placeholder="关注理由"
              className="app-textarea min-h-[80px]"
            />
            <input
              value={companyTags}
              onChange={(event) => setCompanyTags(event.target.value)}
              placeholder="标签，用逗号分隔"
              className="app-input"
            />
            <button
              type="button"
              className="app-button app-button-primary justify-self-start"
              disabled={
                stockCode.length !== 6 ||
                !companyName.trim() ||
                createCompanyMutation.isPending
              }
              onClick={() =>
                createCompanyMutation.mutate({
                  stockCode,
                  companyName: companyName.trim(),
                  reason: companyReason.trim() || undefined,
                  tags: splitTags(companyTags),
                })
              }
            >
              保存公司
            </button>
          </div>

          <div className="mt-5 grid gap-3">
            {(companiesQuery.data ?? []).length === 0 ? (
              <EmptyState title="还没有收藏公司" />
            ) : (
              (companiesQuery.data ?? []).map((company) => (
                <article
                  key={company.id}
                  className="rounded-[12px] border border-[var(--app-border-soft)] bg-[var(--app-panel)] p-4"
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <div className="text-sm font-medium text-[var(--app-text-strong)]">
                        {company.companyName} ({company.stockCode})
                      </div>
                      <p className="mt-2 text-sm leading-6 text-[var(--app-text-muted)]">
                        {company.reason || "暂无关注理由"}
                      </p>
                    </div>
                    {company.archivedAt ? (
                      <StatusPill label="已归档" tone="warning" />
                    ) : (
                      <button
                        type="button"
                        className="app-button"
                        onClick={() =>
                          archiveCompanyMutation.mutate({ id: company.id })
                        }
                      >
                        归档
                      </button>
                    )}
                  </div>
                </article>
              ))
            )}
          </div>
        </Panel>

        <Panel title="收藏行业">
          <div className="grid gap-3">
            <div className="grid gap-2 md:grid-cols-[minmax(0,1fr)_160px]">
              <input
                value={industryName}
                onChange={(event) => setIndustryName(event.target.value)}
                placeholder="行业或主题"
                className="app-input"
              />
              <input
                value={industrySource}
                onChange={(event) => setIndustrySource(event.target.value)}
                placeholder="来源"
                className="app-input"
              />
            </div>
            <textarea
              value={industryReason}
              onChange={(event) => setIndustryReason(event.target.value)}
              placeholder="关注理由"
              className="app-textarea min-h-[80px]"
            />
            <input
              value={industryTags}
              onChange={(event) => setIndustryTags(event.target.value)}
              placeholder="标签，用逗号分隔"
              className="app-input"
            />
            <button
              type="button"
              className="app-button app-button-primary justify-self-start"
              disabled={
                !industryName.trim() || createIndustryMutation.isPending
              }
              onClick={() =>
                createIndustryMutation.mutate({
                  name: industryName.trim(),
                  source: industrySource.trim() || "自定义主题",
                  reason: industryReason.trim() || undefined,
                  tags: splitTags(industryTags),
                })
              }
            >
              保存行业
            </button>
          </div>

          <div className="mt-5 grid gap-3">
            {(industriesQuery.data ?? []).length === 0 ? (
              <EmptyState title="还没有收藏行业" />
            ) : (
              (industriesQuery.data ?? []).map((industry) => (
                <article
                  key={industry.id}
                  className="rounded-[12px] border border-[var(--app-border-soft)] bg-[var(--app-panel)] p-4"
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <div className="text-sm font-medium text-[var(--app-text-strong)]">
                        {industry.name}
                      </div>
                      <p className="mt-1 text-xs text-[var(--app-text-soft)]">
                        {industry.source}
                      </p>
                      <p className="mt-2 text-sm leading-6 text-[var(--app-text-muted)]">
                        {industry.reason || "暂无关注理由"}
                      </p>
                    </div>
                    {industry.archivedAt ? (
                      <StatusPill label="已归档" tone="warning" />
                    ) : (
                      <button
                        type="button"
                        className="app-button"
                        onClick={() =>
                          archiveIndustryMutation.mutate({ id: industry.id })
                        }
                      >
                        归档
                      </button>
                    )}
                  </div>
                </article>
              ))
            )}
          </div>
        </Panel>
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-3">
        <Panel title="最近笔记">
          <div className="grid gap-3">
            {(notesQuery.data ?? []).length === 0 ? (
              <EmptyState title="还没有笔记" />
            ) : (
              (notesQuery.data ?? []).map((note) => (
                <article
                  key={note.id}
                  className="rounded-[12px] border border-[var(--app-border-soft)] bg-[var(--app-panel)] p-4"
                >
                  <div className="mb-2 flex flex-wrap gap-2">
                    <StatusPill
                      label={targetTypeLabel(note.targetRef.type)}
                      tone="info"
                    />
                    <StatusPill
                      label={formatDate(note.updatedAt)}
                      tone="neutral"
                    />
                  </div>
                  <MarkdownContent content={note.contentMarkdown} compact />
                </article>
              ))
            )}
          </div>
        </Panel>

        <Panel title="财务快照">
          <div className="grid gap-3">
            {(snapshotsQuery.data ?? []).length === 0 ? (
              <EmptyState title="还没有财务快照" />
            ) : (
              (snapshotsQuery.data ?? []).map((snapshot) => (
                <article
                  key={snapshot.id}
                  className="rounded-[12px] border border-[var(--app-border-soft)] bg-[var(--app-panel)] p-4"
                >
                  <StatusPill
                    label={targetTypeLabel(snapshot.targetRef.type)}
                    tone="info"
                  />
                  <p className="mt-3 text-sm text-[var(--app-text-strong)]">
                    {snapshot.companyRefs
                      .map((item) => item.stockName)
                      .join("、")}
                  </p>
                  <p className="mt-2 text-xs text-[var(--app-text-soft)]">
                    {formatDate(snapshot.createdAt)}
                  </p>
                </article>
              ))
            )}
          </div>
        </Panel>

        <Panel title="研究报告">
          <div className="grid gap-3">
            {(artifactsQuery.data ?? []).length === 0 ? (
              <EmptyState title="还没有研究报告" />
            ) : (
              (artifactsQuery.data ?? []).map((artifact) => (
                <article
                  key={artifact.id}
                  className="rounded-[12px] border border-[var(--app-border-soft)] bg-[var(--app-panel)] p-4"
                >
                  <div className="text-sm font-medium text-[var(--app-text-strong)]">
                    {artifact.title}
                  </div>
                  <p className="mt-2 text-xs text-[var(--app-text-soft)]">
                    {artifact.artifactType} · {formatDate(artifact.updatedAt)}
                  </p>
                </article>
              ))
            )}
          </div>
        </Panel>
      </div>
    </WorkspaceShell>
  );
}
