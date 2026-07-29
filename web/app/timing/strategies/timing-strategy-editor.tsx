"use client";

import Link from "next/link";
import { CheckCircle2, Copy, Plus, Save } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { EmptyState, InlineNotice, StatusPill, WorkspaceShell } from "~/app/_components/ui";
import type { TimingResearchRuleConfig } from "~/server/domain/timing/types";
import { api } from "~/trpc/react";

export function TimingStrategyEditor() {
  const utils = api.useUtils();
  const strategiesQuery = api.timing.listResearchStrategies.useQuery(undefined, { refetchOnWindowFocus: false });
  const [selectedRevisionId, setSelectedRevisionId] = useState("");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [configText, setConfigText] = useState("");
  const [sampleCodes, setSampleCodes] = useState("000001,600519");
  const [notice, setNotice] = useState<{ tone: "info" | "danger" | "success"; text: string } | null>(null);

  const revisions = useMemo(() => (strategiesQuery.data ?? []).flatMap((strategy) => strategy.revisions.map((revision) => ({ ...revision, strategyName: strategy.name, strategyDescription: strategy.description ?? "" }))), [strategiesQuery.data]);
  const selected = revisions.find((item) => item.id === selectedRevisionId) ?? revisions[0];

  useEffect(() => {
    if (!selected) return;
    setSelectedRevisionId(selected.id);
    setName(selected.strategyName);
    setDescription(selected.strategyDescription);
    setConfigText(JSON.stringify(selected.config, null, 2));
  }, [selected?.id]);

  const createMutation = api.timing.createResearchStrategy.useMutation({ onSuccess: async () => { await utils.timing.listResearchStrategies.invalidate(); setNotice({ tone: "success", text: "已创建研究规则草稿。" }); } });
  const updateMutation = api.timing.updateResearchStrategyDraft.useMutation({ onSuccess: async () => { await utils.timing.listResearchStrategies.invalidate(); setNotice({ tone: "success", text: "草稿已保存。" }); } });
  const cloneMutation = api.timing.cloneResearchStrategyRevision.useMutation({ onSuccess: async (revision) => { await utils.timing.listResearchStrategies.invalidate(); if (revision) setSelectedRevisionId(revision.id); setNotice({ tone: "success", text: "已创建新的草稿修订。" }); } });
  const validateMutation = api.timing.validateResearchRuleRevision.useMutation({ onSuccess: async (result) => { await utils.timing.listResearchStrategies.invalidate(); const metrics = result.qualityMetrics as { coveragePct?: number; gatePassed?: boolean; failures?: string[] }; setNotice({ tone: metrics.gatePassed ? "success" : "danger", text: metrics.gatePassed ? `校验通过，证据覆盖率 ${(metrics.coveragePct ?? 0).toFixed(1)}%。` : `校验未通过：${metrics.failures?.join("；") || "请检查规则证据。"}` }); } });
  const publishMutation = api.timing.publishResearchRuleRevision.useMutation({ onSuccess: async () => { await utils.timing.listResearchStrategies.invalidate(); setNotice({ tone: "success", text: "规则修订已发布。" }); } });

  function parseConfig(): TimingResearchRuleConfig | null {
    try { return JSON.parse(configText) as TimingResearchRuleConfig; }
    catch { setNotice({ tone: "danger", text: "规则配置不是有效 JSON。" }); return null; }
  }

  return <WorkspaceShell section="timing" contentWidth="wide" title="研究规则" titleSize="compact" description="编辑技术指标、阈值、确认根数与必选条件" actions={<Link className="app-button" href="/timing">返回择时研究</Link>}>
    <div className="grid gap-8 lg:grid-cols-[280px_minmax(0,1fr)]">
      <aside className="grid content-start gap-3 border-r border-[var(--app-border-soft)] pr-5">
        <button type="button" className="app-button app-button-primary" onClick={() => createMutation.mutate({ name: `研究规则 ${new Date().toLocaleDateString("zh-CN")}`, description: "", setup: "TREND_CONTINUATION", horizon: "SWING" })}><Plus className="h-4 w-4" />新建规则</button>
        {(strategiesQuery.data ?? []).map((strategy) => <div key={strategy.id} className="grid gap-1"><div className="px-2 py-2 text-xs font-semibold text-[var(--app-text-muted)]">{strategy.name}</div>{strategy.revisions.map((revision) => <button key={revision.id} type="button" onClick={() => setSelectedRevisionId(revision.id)} className={`flex items-center justify-between gap-2 border-l-2 px-3 py-2 text-left text-sm ${selected?.id === revision.id ? "border-[var(--app-text-strong)] bg-[var(--app-surface-quiet)]" : "border-transparent text-[var(--app-text-muted)]"}`}><span>修订 {revision.revisionNumber}</span><StatusPill label={revision.status === "DRAFT" ? "草稿" : revision.status === "VALIDATING" ? "待发布" : revision.status === "PUBLISHED" ? "已发布" : "已归档"} tone={revision.status === "PUBLISHED" ? "success" : "neutral"} /></button>)}</div>)}
      </aside>

      {!selected ? <EmptyState title="暂无研究规则" /> : <main className="grid min-w-0 gap-6">
        {notice ? <InlineNotice tone={notice.tone} description={notice.text} /> : null}
        <div className="grid gap-4 md:grid-cols-2"><label className="grid gap-2 text-sm text-[var(--app-text-muted)]">规则名称<input className="app-input" value={name} onChange={(event) => setName(event.target.value)} disabled={selected.status !== "DRAFT"} /></label><label className="grid gap-2 text-sm text-[var(--app-text-muted)]">说明<input className="app-input" value={description} onChange={(event) => setDescription(event.target.value)} disabled={selected.status !== "DRAFT"} /></label></div>
        <label className="grid gap-2 text-sm text-[var(--app-text-muted)]">规则配置<textarea className="app-input min-h-[520px] resize-y font-mono text-xs leading-6" spellCheck={false} value={configText} onChange={(event) => setConfigText(event.target.value)} disabled={selected.status !== "DRAFT"} /></label>
        <div className="flex flex-wrap gap-2">{selected.status === "DRAFT" ? <button type="button" className="app-button" onClick={() => { const config = parseConfig(); if (config) updateMutation.mutate({ revisionId: selected.id, name, description, config }); }}><Save className="h-4 w-4" />保存草稿</button> : <button type="button" className="app-button" onClick={() => cloneMutation.mutate({ revisionId: selected.id })}><Copy className="h-4 w-4" />复制为草稿</button>}</div>
        <section className="grid gap-4 border-t border-[var(--app-border-soft)] pt-6"><div><h2 className="text-base font-semibold">校验发布</h2><p className="mt-1 text-sm leading-6 text-[var(--app-text-muted)]">校验静态规则、指标可用性、样本覆盖和数据日期。校验结果绑定当前配置哈希。</p></div><label className="grid gap-2 text-sm text-[var(--app-text-muted)]">样本股票代码<input className="app-input" value={sampleCodes} onChange={(event) => setSampleCodes(event.target.value)} placeholder="逗号分隔" /></label><div className="flex flex-wrap gap-2"><button type="button" className="app-button" disabled={!['DRAFT','VALIDATING'].includes(selected.status)} onClick={() => validateMutation.mutate({ revisionId: selected.id, stockCodes: sampleCodes.split(/[，,]/).map((item) => item.trim()).filter((item) => /^\d{6}$/.test(item)) })}><CheckCircle2 className="h-4 w-4" />运行校验</button><button type="button" className="app-button app-button-primary" disabled={selected.status !== "VALIDATING"} onClick={() => publishMutation.mutate({ revisionId: selected.id })}>发布修订</button></div></section>
      </main>}
    </div>
  </WorkspaceShell>;
}
