"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { KpiCard, WorkspaceShell } from "~/app/_components/ui";
import {
  type CreateStrategyInput,
  type FilterGroupInput,
  filterGroupInputSchema,
  scoringConfigInputSchema,
} from "~/contracts/screening";
import type { NormalizationMethod } from "~/server/domain/screening/value-objects/scoring-config";
import { api, type RouterOutputs } from "~/trpc/react";
import { FilterGroupEditor } from "./filter-group-editor";
import { ScoringRulesEditor } from "./scoring-rules-editor";
import {
  countConditions,
  createDefaultStrategyForm,
  formatDate,
  formatDuration,
  isLiveSession,
  normalizeRuleWeights,
  type ParsedTopStock,
  type ParsedWatchedStock,
  parseTags,
  parseTopStocks,
  parseWatchedStocks,
  type StrategyFormState,
  scoringConfigToRules,
  scoringRulesToConfig,
  sessionStatusClassMap,
  sessionStatusLabelMap,
} from "./screening-ui";

type StrategyListItem = RouterOutputs["screening"]["listStrategies"][number];
type SessionListItem = RouterOutputs["screening"]["listRecentSessions"][number];
type WatchListItem = RouterOutputs["watchlist"]["list"][number];

type OpportunityRow = {
  stockCode: string;
  stockName: string;
  source: "筛选" | "清单" | "筛选+清单";
  score?: number;
  indicatorPreview?: string;
  rationale?: string;
  note?: string;
  tags?: string[];
  addedAt?: string;
};

type NoticeState = {
  tone: "success" | "error" | "info";
  text: string;
};

function Notice({ notice }: { notice: NoticeState | null }) {
  if (!notice) {
    return null;
  }

  const className =
    notice.tone === "success"
      ? "border-[rgba(120,211,173,0.34)] bg-[rgba(26,68,54,0.2)] text-[var(--app-success)]"
      : notice.tone === "error"
        ? "border-[rgba(239,142,157,0.34)] bg-[rgba(97,39,50,0.2)] text-[var(--app-danger)]"
        : "border-[rgba(226,181,111,0.34)] bg-[rgba(86,60,23,0.2)] text-[var(--app-warning)]";

  return (
    <p
      className={`studio-rise rounded-[12px] border px-4 py-3 text-sm ${className}`}
    >
      {notice.text}
    </p>
  );
}

export function ScreeningStudioClient() {
  const utils = api.useUtils();
  const [notice, setNotice] = useState<NoticeState | null>(null);
  const [strategyMode, setStrategyMode] = useState<"create" | "update">(
    "create",
  );
  const [strategyForm, setStrategyForm] = useState<StrategyFormState>(
    createDefaultStrategyForm(),
  );
  const [selectedStrategyId, setSelectedStrategyId] = useState<string | null>(
    null,
  );
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(
    null,
  );
  const [selectedWatchListId, setSelectedWatchListId] = useState<string | null>(
    null,
  );

  const [newWatchListName, setNewWatchListName] = useState("长期跟踪");
  const [newWatchListDescription, setNewWatchListDescription] = useState("");
  const [watchMetaName, setWatchMetaName] = useState("");
  const [watchMetaDescription, setWatchMetaDescription] = useState("");
  const [_newStockCode, setNewStockCode] = useState("");
  const [_newStockName, setNewStockName] = useState("");
  const [_newStockNote, setNewStockNote] = useState("");
  const [_newStockTags, _setNewStockTags] = useState("跟踪, 命中");
  const [selectedStockCode, setSelectedStockCode] = useState("");

  const strategiesQuery = api.screening.listStrategies.useQuery(
    { limit: 50, offset: 0 },
    { refetchOnWindowFocus: false },
  );
  const sessionsQuery = api.screening.listRecentSessions.useQuery(
    { limit: 20, offset: 0 },
    { refetchInterval: 2500, refetchOnWindowFocus: false },
  );
  const watchListsQuery = api.watchlist.list.useQuery({
    limit: 30,
    offset: 0,
    sortBy: "updatedAt",
    sortDirection: "desc",
  });

  const strategyDetailQuery = api.screening.getStrategy.useQuery(
    { id: selectedStrategyId ?? "" },
    { enabled: selectedStrategyId !== null, refetchOnWindowFocus: false },
  );

  const selectedSessionSummary = useMemo(
    () =>
      (sessionsQuery.data ?? []).find(
        (session) => session.id === selectedSessionId,
      ) ?? null,
    [selectedSessionId, sessionsQuery.data],
  );

  const sessionDetailQuery = api.screening.getSessionDetail.useQuery(
    { sessionId: selectedSessionId ?? "" },
    {
      enabled: selectedSessionId !== null,
      refetchInterval: isLiveSession(selectedSessionSummary?.status)
        ? 2000
        : false,
      refetchOnWindowFocus: false,
    },
  );

  const watchListDetailQuery = api.watchlist.getDetail.useQuery(
    { id: selectedWatchListId ?? "" },
    { enabled: selectedWatchListId !== null },
  );

  const createStrategyMutation = api.screening.createStrategy.useMutation({
    onSuccess: async (created) => {
      setStrategyMode("update");
      setSelectedStrategyId(created.id);
      setNotice({ tone: "success", text: `策略「${created.name}」已创建` });
      await utils.screening.listStrategies.invalidate();
    },
    onError: (error) => {
      setNotice({ tone: "error", text: `创建失败：${error.message}` });
    },
  });

  const updateStrategyMutation = api.screening.updateStrategy.useMutation({
    onSuccess: async (updated) => {
      setNotice({ tone: "success", text: `策略「${updated.name}」已更新` });
      await Promise.all([
        utils.screening.listStrategies.invalidate(),
        utils.screening.getStrategy.invalidate({ id: updated.id }),
      ]);
    },
    onError: (error) => {
      setNotice({ tone: "error", text: `更新失败：${error.message}` });
    },
  });

  const deleteStrategyMutation = api.screening.deleteStrategy.useMutation({
    onSuccess: async () => {
      setNotice({ tone: "success", text: "策略已删除" });
      await Promise.all([
        utils.screening.listStrategies.invalidate(),
        utils.screening.listRecentSessions.invalidate(),
      ]);
    },
    onError: (error) => {
      setNotice({ tone: "error", text: `删除失败：${error.message}` });
    },
  });

  const executeStrategyMutation = api.screening.executeStrategy.useMutation({
    onSuccess: async (result) => {
      setSelectedSessionId(result.sessionId);
      setNotice({
        tone: "success",
        text: "策略已加入执行队列。",
      });
      await Promise.all([
        utils.screening.listRecentSessions.invalidate(),
        utils.screening.getSessionDetail.invalidate({
          sessionId: result.sessionId,
        }),
      ]);
    },
    onError: (error) => {
      setNotice({ tone: "error", text: `入队失败：${error.message}` });
    },
  });

  const cancelSessionMutation = api.screening.cancelSession.useMutation({
    onSuccess: async (result) => {
      setNotice({
        tone: "info",
        text:
          result.status === "CANCELLED"
            ? "任务已取消"
            : "已提交取消请求，等待 worker 响应。",
      });
      await Promise.all([
        utils.screening.listRecentSessions.invalidate(),
        utils.screening.getSessionDetail.invalidate({
          sessionId: result.sessionId,
        }),
      ]);
    },
    onError: (error) => {
      setNotice({ tone: "error", text: `取消失败：${error.message}` });
    },
  });

  const retrySessionMutation = api.screening.retrySession.useMutation({
    onSuccess: async (result) => {
      setSelectedSessionId(result.sessionId);
      setNotice({ tone: "success", text: "已重新提交筛选任务" });
      await Promise.all([
        utils.screening.listRecentSessions.invalidate(),
        utils.screening.getSessionDetail.invalidate({
          sessionId: result.sessionId,
        }),
      ]);
    },
    onError: (error) => {
      setNotice({ tone: "error", text: `重试失败：${error.message}` });
    },
  });

  const deleteSessionMutation = api.screening.deleteSession.useMutation({
    onSuccess: async () => {
      setNotice({ tone: "success", text: "会话已删除" });
      await Promise.all([
        utils.screening.listRecentSessions.invalidate(),
        utils.screening.getSessionDetail.invalidate(),
      ]);
    },
    onError: (error) => {
      setNotice({ tone: "error", text: `删除失败：${error.message}` });
    },
  });

  const createWatchListMutation = api.watchlist.create.useMutation({
    onSuccess: async (created) => {
      setSelectedWatchListId(created.id);
      setNotice({ tone: "success", text: `清单「${created.name}」已创建` });
      await Promise.all([
        utils.watchlist.list.invalidate(),
        utils.watchlist.getDetail.invalidate({ id: created.id }),
      ]);
    },
    onError: (error) => {
      setNotice({ tone: "error", text: `创建清单失败：${error.message}` });
    },
  });

  const updateWatchMetaMutation = api.watchlist.updateMeta.useMutation({
    onSuccess: async (updated) => {
      setNotice({ tone: "success", text: `清单「${updated.name}」已更新` });
      await Promise.all([
        utils.watchlist.list.invalidate(),
        utils.watchlist.getDetail.invalidate({ id: updated.id }),
      ]);
    },
  });

  const _deleteWatchListMutation = api.watchlist.delete.useMutation({
    onSuccess: async () => {
      setNotice({ tone: "success", text: "自选股清单已删除" });
      await Promise.all([
        utils.watchlist.list.invalidate(),
        utils.watchlist.getDetail.invalidate(),
      ]);
    },
  });

  const addStockMutation = api.watchlist.addStock.useMutation({
    onSuccess: async () => {
      if (selectedWatchListId) {
        await utils.watchlist.getDetail.invalidate({ id: selectedWatchListId });
      }
      await utils.watchlist.list.invalidate();
      setNotice({ tone: "success", text: "股票已加入自选股清单" });
      setNewStockCode("");
      setNewStockName("");
      setNewStockNote("");
    },
    onError: (error) => {
      setNotice({ tone: "error", text: `加入清单失败：${error.message}` });
    },
  });

  const removeStockMutation = api.watchlist.removeStock.useMutation({
    onSuccess: async () => {
      if (selectedWatchListId) {
        await utils.watchlist.getDetail.invalidate({ id: selectedWatchListId });
      }
      await utils.watchlist.list.invalidate();
      setNotice({ tone: "success", text: "股票已移出清单" });
    },
  });

  const strategies = strategiesQuery.data ?? [];
  const sessions = sessionsQuery.data ?? [];
  const watchLists = watchListsQuery.data ?? [];
  const parsedTopStocks = useMemo(
    () => parseTopStocks(sessionDetailQuery.data?.topStocks),
    [sessionDetailQuery.data?.topStocks],
  );
  const parsedWatchStocks = useMemo(
    () => parseWatchedStocks(watchListDetailQuery.data?.stocks),
    [watchListDetailQuery.data?.stocks],
  );
  const watchStockSet = useMemo(
    () => new Set(parsedWatchStocks.map((stock) => stock.stockCode)),
    [parsedWatchStocks],
  );
  const opportunityRows = useMemo<OpportunityRow[]>(() => {
    const map = new Map<string, OpportunityRow>();

    parsedTopStocks.forEach((stock) => {
      map.set(stock.stockCode, {
        stockCode: stock.stockCode,
        stockName: stock.stockName,
        source: "筛选",
        score: stock.score,
        indicatorPreview: stock.indicatorPreview,
        rationale: stock.explanations[0] ?? stock.indicatorPreview,
      });
    });

    parsedWatchStocks.forEach((stock) => {
      const existing = map.get(stock.stockCode);
      if (existing) {
        map.set(stock.stockCode, {
          ...existing,
          source: "筛选+清单",
          note: stock.note,
          tags: stock.tags,
          addedAt: stock.addedAt,
        });
        return;
      }

      map.set(stock.stockCode, {
        stockCode: stock.stockCode,
        stockName: stock.stockName,
        source: "清单",
        note: stock.note,
        tags: stock.tags,
        addedAt: stock.addedAt,
      });
    });

    const rows = Array.from(map.values());
    const sourcePriority = (source: OpportunityRow["source"]) =>
      source === "筛选+清单" ? 0 : source === "筛选" ? 1 : 2;

    rows.sort((left, right) => {
      const priority =
        sourcePriority(left.source) - sourcePriority(right.source);
      if (priority !== 0) {
        return priority;
      }

      const leftScore =
        typeof left.score === "number" ? left.score : Number.NEGATIVE_INFINITY;
      const rightScore =
        typeof right.score === "number"
          ? right.score
          : Number.NEGATIVE_INFINITY;
      if (leftScore !== rightScore) {
        return rightScore - leftScore;
      }

      return left.stockCode.localeCompare(right.stockCode);
    });

    return rows;
  }, [parsedTopStocks, parsedWatchStocks]);

  useEffect(() => {
    if (!notice) {
      return;
    }

    const timer = window.setTimeout(() => setNotice(null), 3800);
    return () => window.clearTimeout(timer);
  }, [notice]);

  useEffect(() => {
    if (strategies.length > 0 && !selectedStrategyId) {
      setSelectedStrategyId(strategies[0]?.id ?? null);
    }
  }, [selectedStrategyId, strategies]);

  useEffect(() => {
    if (sessions.length > 0 && !selectedSessionId) {
      setSelectedSessionId(sessions[0]?.id ?? null);
    }
  }, [selectedSessionId, sessions]);

  useEffect(() => {
    if (watchLists.length > 0 && !selectedWatchListId) {
      setSelectedWatchListId(watchLists[0]?.id ?? null);
    }
  }, [selectedWatchListId, watchLists]);

  useEffect(() => {
    if (strategyMode !== "update" || !strategyDetailQuery.data) {
      return;
    }

    const parsedFilters = filterGroupInputSchema.safeParse(
      strategyDetailQuery.data.filters,
    );
    const parsedScoring = scoringConfigInputSchema.safeParse(
      strategyDetailQuery.data.scoringConfig,
    );

    if (!parsedFilters.success || !parsedScoring.success) {
      setNotice({
        tone: "error",
        text: "策略详情解析失败，请检查存量配置格式。",
      });
      return;
    }

    setStrategyForm({
      name: strategyDetailQuery.data.name,
      description: strategyDetailQuery.data.description ?? "",
      tagsText: strategyDetailQuery.data.tags.join(", "),
      isTemplate: strategyDetailQuery.data.isTemplate,
      filters: parsedFilters.data,
      scoringRules: scoringConfigToRules(parsedScoring.data),
      normalizationMethod: parsedScoring.data.normalizationMethod,
    });
  }, [strategyDetailQuery.data, strategyMode]);

  useEffect(() => {
    if (!watchListDetailQuery.data) {
      return;
    }

    setWatchMetaName(watchListDetailQuery.data.name);
    setWatchMetaDescription(watchListDetailQuery.data.description ?? "");
  }, [watchListDetailQuery.data]);

  useEffect(() => {
    if (parsedWatchStocks.length === 0) {
      setSelectedStockCode("");
      return;
    }

    if (!selectedStockCode) {
      setSelectedStockCode(parsedWatchStocks[0]?.stockCode ?? "");
    }
  }, [parsedWatchStocks, selectedStockCode]);

  const scoringWeightSum = strategyForm.scoringRules.reduce(
    (sum, rule) => sum + rule.weight,
    0,
  );
  const liveSessionCount = sessions.filter((session) =>
    isLiveSession(session.status),
  ).length;

  const resetStrategyForm = () => {
    setStrategyMode("create");
    setStrategyForm(createDefaultStrategyForm());
  };

  const handleSubmitStrategy = async () => {
    const normalizedRules = normalizeRuleWeights(strategyForm.scoringRules);
    const scoringConfig = scoringRulesToConfig(
      normalizedRules,
      strategyForm.normalizationMethod,
    );
    const validatedFilters = filterGroupInputSchema.safeParse(
      strategyForm.filters,
    );
    const validatedScoring = scoringConfigInputSchema.safeParse(scoringConfig);

    if (!validatedFilters.success) {
      setNotice({
        tone: "error",
        text: validatedFilters.error.issues[0]?.message ?? "筛选条件配置无效",
      });
      return;
    }

    if (!validatedScoring.success) {
      setNotice({
        tone: "error",
        text: validatedScoring.error.issues[0]?.message ?? "评分配置无效",
      });
      return;
    }

    const payload: CreateStrategyInput = {
      name: strategyForm.name.trim(),
      description: strategyForm.description.trim() || undefined,
      tags: parseTags(strategyForm.tagsText),
      isTemplate: strategyForm.isTemplate,
      filters: validatedFilters.data,
      scoringConfig: validatedScoring.data,
    };

    if (strategyMode === "create") {
      await createStrategyMutation.mutateAsync(payload);
      return;
    }

    if (!selectedStrategyId) {
      return;
    }

    await updateStrategyMutation.mutateAsync({
      id: selectedStrategyId,
      ...payload,
    });
  };

  return (
    <WorkspaceShell
      section="screening"
      eyebrow="Opportunity Pool"
      title="机会池"
      actions={
        <>
          <Link href="/" className="app-button">
            返回看板
          </Link>
          <Link href="/timing" className="app-button app-button-primary">
            打开择时组合
          </Link>
        </>
      }
      summary={
        <>
          <KpiCard label="筛选器" value={strategies.length} tone="info" />
          <KpiCard label="刷新中" value={liveSessionCount} tone="warning" />
          <KpiCard label="自选清单" value={watchLists.length} tone="success" />
        </>
      }
    >
      <div className="grid gap-6">
        <section className="app-panel p-4 sm:p-5">
          <div className="flex flex-wrap items-end gap-4">
            <div className="min-w-[220px] flex-1">
              <label
                htmlFor="screening-strategy"
                className="text-xs text-[var(--app-text-soft)]"
              >
                筛选器
              </label>
              <select
                id="screening-strategy"
                value={selectedStrategyId ?? ""}
                onChange={(event) => {
                  const nextId = event.target.value;
                  setSelectedStrategyId(nextId || null);
                  setStrategyMode(nextId ? "update" : "create");
                }}
                className="app-select mt-2"
              >
                {strategies.length === 0 ? (
                  <option value="">暂无筛选器</option>
                ) : (
                  strategies.map((strategy: StrategyListItem) => (
                    <option key={strategy.id} value={strategy.id}>
                      {strategy.name}
                    </option>
                  ))
                )}
              </select>
            </div>
            <div className="min-w-[220px] flex-1">
              <label
                htmlFor="screening-session"
                className="text-xs text-[var(--app-text-soft)]"
              >
                会话
              </label>
              <select
                id="screening-session"
                value={selectedSessionId ?? ""}
                onChange={(event) =>
                  setSelectedSessionId(event.target.value || null)
                }
                className="app-select mt-2"
              >
                {sessions.length === 0 ? (
                  <option value="">暂无会话</option>
                ) : (
                  sessions.map((session: SessionListItem) => (
                    <option key={session.id} value={session.id}>
                      {session.strategyName} ·{" "}
                      {sessionStatusLabelMap[session.status] ?? session.status}
                    </option>
                  ))
                )}
              </select>
            </div>
            <div className="min-w-[220px] flex-1">
              <label
                htmlFor="screening-watchlist"
                className="text-xs text-[var(--app-text-soft)]"
              >
                观察清单
              </label>
              <select
                id="screening-watchlist"
                value={selectedWatchListId ?? ""}
                onChange={(event) =>
                  setSelectedWatchListId(event.target.value || null)
                }
                className="app-select mt-2"
              >
                {watchLists.length === 0 ? (
                  <option value="">暂无清单</option>
                ) : (
                  watchLists.map((item: WatchListItem) => (
                    <option key={item.id} value={item.id}>
                      {item.name} · {item.stockCount} 支
                    </option>
                  ))
                )}
              </select>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => {
                  if (selectedStrategyId) {
                    executeStrategyMutation.mutate({
                      strategyId: selectedStrategyId,
                    });
                  }
                }}
                disabled={!selectedStrategyId}
                className="app-button app-button-primary"
              >
                执行筛选
              </button>
              <button
                type="button"
                onClick={() => {
                  const panel = document.getElementById("sessions-panel");
                  if (panel) {
                    panel.scrollIntoView({
                      behavior: "smooth",
                      block: "start",
                    });
                  }
                }}
                disabled={!selectedSessionId}
                className="app-button"
              >
                查看会话
              </button>
            </div>
          </div>
        </section>

        <Notice notice={notice} />

        <section className="app-panel p-4 sm:p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="text-lg font-medium text-[var(--app-text)]">
                机会池总览
              </h2>
              <p className="mt-2 text-xs text-[var(--app-text-soft)]">
                筛选命中 {parsedTopStocks.length} · 清单{" "}
                {parsedWatchStocks.length} · 合并 {opportunityRows.length}
              </p>
            </div>
            {selectedSessionSummary ? (
              <p className="text-xs text-[var(--app-text-muted)]">
                当前会话：{selectedSessionSummary.strategyName} ·{" "}
                {sessionStatusLabelMap[selectedSessionSummary.status] ??
                  selectedSessionSummary.status}
              </p>
            ) : null}
          </div>
          <div className="mt-4 overflow-auto rounded-2xl border border-[var(--app-border)]">
            <table className="app-table min-w-[980px]">
              <thead>
                <tr>
                  <th className="sticky top-0 z-10 bg-[rgba(12,17,23,0.98)]">
                    股票
                  </th>
                  <th className="sticky top-0 z-10 bg-[rgba(12,17,23,0.98)]">
                    来源
                  </th>
                  <th className="sticky top-0 z-10 bg-[rgba(12,17,23,0.98)]">
                    评分
                  </th>
                  <th className="sticky top-0 z-10 bg-[rgba(12,17,23,0.98)]">
                    命中理由 / 指标摘要
                  </th>
                  <th className="sticky top-0 z-10 bg-[rgba(12,17,23,0.98)]">
                    清单备注 / 标签
                  </th>
                  <th className="sticky top-0 z-10 bg-[rgba(12,17,23,0.98)]">
                    加入时间
                  </th>
                  <th className="sticky top-0 z-10 bg-[rgba(12,17,23,0.98)]">
                    操作
                  </th>
                </tr>
              </thead>
              <tbody>
                {opportunityRows.length === 0 ? (
                  <tr>
                    <td
                      colSpan={7}
                      className="px-4 py-8 text-center text-sm text-[var(--app-text-soft)]"
                    >
                      暂无机会池数据。
                    </td>
                  </tr>
                ) : (
                  opportunityRows.map((row) => {
                    const sourceTone =
                      row.source === "筛选+清单"
                        ? "text-[var(--app-success)]"
                        : row.source === "筛选"
                          ? "text-[var(--app-accent-strong)]"
                          : "text-[var(--app-text-muted)]";
                    const rationale =
                      row.rationale ?? row.indicatorPreview ?? "-";
                    const note = row.note?.trim() ?? "";
                    const tags =
                      row.tags && row.tags.length > 0
                        ? row.tags.join(" · ")
                        : "";
                    const score =
                      typeof row.score === "number"
                        ? row.score.toFixed(4)
                        : "-";

                    return (
                      <tr
                        key={row.stockCode}
                        className="hover:bg-[rgba(15,20,27,0.7)]"
                      >
                        <td className="px-4 py-3 text-sm text-[var(--app-text)]">
                          <div className="font-medium">{row.stockName}</div>
                          <div className="mt-1 text-xs text-[var(--app-text-soft)]">
                            {row.stockCode}
                          </div>
                        </td>
                        <td className={`px-4 py-3 text-sm ${sourceTone}`}>
                          {row.source}
                        </td>
                        <td className="px-4 py-3 text-sm text-[var(--app-text)]">
                          {score}
                        </td>
                        <td className="px-4 py-3 text-sm text-[var(--app-text-muted)]">
                          <p className="line-clamp-2">{rationale}</p>
                        </td>
                        <td className="px-4 py-3 text-sm text-[var(--app-text-muted)]">
                          <p className="line-clamp-2">{note || "-"}</p>
                          {tags ? (
                            <p className="mt-1 text-xs text-[var(--app-text-soft)]">
                              {tags}
                            </p>
                          ) : null}
                        </td>
                        <td className="px-4 py-3 text-sm text-[var(--app-text-muted)]">
                          {row.addedAt ? formatDate(row.addedAt) : "-"}
                        </td>
                        <td className="px-4 py-3">
                          {watchStockSet.has(row.stockCode) ? (
                            <button
                              type="button"
                              onClick={() => {
                                if (!selectedWatchListId) {
                                  return;
                                }
                                removeStockMutation.mutate({
                                  watchListId: selectedWatchListId,
                                  stockCode: row.stockCode,
                                });
                              }}
                              disabled={!selectedWatchListId}
                              className="app-button app-button-danger"
                            >
                              移除
                            </button>
                          ) : (
                            <button
                              type="button"
                              onClick={() => {
                                if (!selectedWatchListId) {
                                  return;
                                }
                                addStockMutation.mutate({
                                  watchListId: selectedWatchListId,
                                  stockCode: row.stockCode,
                                  stockName: row.stockName,
                                  note: row.rationale ?? row.indicatorPreview,
                                  tags: parseTags("跟踪, 命中"),
                                });
                              }}
                              disabled={!selectedWatchListId}
                              className="app-button app-button-success"
                            >
                              加入清单
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </section>

        <details className="app-panel p-4 sm:p-5" id="filters-panel">
          <summary className="cursor-pointer text-sm font-medium text-[var(--app-text)]">
            筛选器设置
            <span className="ml-2 text-xs text-[var(--app-text-soft)]">
              {strategies.length} 个筛选器 ·{" "}
              {countConditions(strategyForm.filters)} 条条件
            </span>
          </summary>
          <div className="mt-4">
            <section className="grid gap-6 xl:grid-cols-[0.9fr_1.1fr]">
              <section className="rounded-[26px] border border-[#35526f]/35 bg-[#0d1e33]/95 p-5 sm:p-6">
                <div className="flex items-center justify-between gap-3">
                  <h2 className="font-[family-name:var(--font-display)] text-2xl text-[#e9f4ff]">
                    筛选器库
                  </h2>
                  <button
                    type="button"
                    onClick={resetStrategyForm}
                    className="rounded-full border border-[#d2e5f9]/20 bg-[#0f2137]/88 px-3 py-1.5 text-xs font-medium text-[#d2e5f9]"
                  >
                    新建筛选器
                  </button>
                </div>
                <div className="mt-4 grid gap-3">
                  {strategies.map((strategy: StrategyListItem) => (
                    <article
                      key={strategy.id}
                      className={`rounded-2xl border p-4 ${strategy.id === selectedStrategyId ? "border-[#49ddb8] bg-[#123f35]" : "border-[#35526f]/35 bg-[#10253c]/90"}`}
                    >
                      <button
                        type="button"
                        onClick={() => {
                          setSelectedStrategyId(strategy.id);
                          setStrategyMode("update");
                        }}
                        className="w-full text-left"
                      >
                        <p className="truncate text-sm font-semibold text-[#eff8ff]">
                          {strategy.name}
                        </p>
                        <p className="mt-1 line-clamp-2 text-xs text-[#97afc7]">
                          {strategy.description ?? "未填写"}
                        </p>
                      </button>
                      <div className="mt-4 flex flex-wrap gap-2 text-xs">
                        <button
                          type="button"
                          onClick={() =>
                            executeStrategyMutation.mutate({
                              strategyId: strategy.id,
                            })
                          }
                          className="rounded-full border border-[#2fa889]/25 bg-[#103830] px-3 py-1 text-[#5cefc4]"
                        >
                          加入执行队列
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            deleteStrategyMutation.mutate({ id: strategy.id })
                          }
                          className="rounded-full border border-[#ff8d9b]/25 bg-[#4b2331] px-3 py-1 text-[#ff8d9b]"
                        >
                          删除
                        </button>
                      </div>
                    </article>
                  ))}
                </div>
              </section>
              <section className="rounded-[26px] border border-[#35526f]/35 bg-[#0d1e33]/95 p-5 sm:p-6">
                <h2 className="font-[family-name:var(--font-display)] text-2xl text-[#e9f4ff]">
                  筛选器设置
                </h2>
                <div className="mt-4 grid gap-3 lg:grid-cols-2">
                  <input
                    value={strategyForm.name}
                    onChange={(event) =>
                      setStrategyForm((current) => ({
                        ...current,
                        name: event.target.value,
                      }))
                    }
                    className="rounded-xl border border-[#e1eeff]/28 bg-[#0a1a2d] px-3 py-2 text-sm text-[#e1eeff]"
                    placeholder="筛选器名称"
                  />
                  <input
                    value={strategyForm.tagsText}
                    onChange={(event) =>
                      setStrategyForm((current) => ({
                        ...current,
                        tagsText: event.target.value,
                      }))
                    }
                    className="rounded-xl border border-[#e1eeff]/28 bg-[#0a1a2d] px-3 py-2 text-sm text-[#e1eeff]"
                    placeholder="标签"
                  />
                  <textarea
                    value={strategyForm.description}
                    onChange={(event) =>
                      setStrategyForm((current) => ({
                        ...current,
                        description: event.target.value,
                      }))
                    }
                    rows={3}
                    className="rounded-xl border border-[#e1eeff]/28 bg-[#0a1a2d] px-3 py-2 text-sm text-[#e1eeff] lg:col-span-2"
                    placeholder="备注"
                  />
                </div>
                <label className="mt-3 flex items-center gap-2 text-xs text-[#97b0c9]">
                  <input
                    type="checkbox"
                    checked={strategyForm.isTemplate}
                    onChange={(event) =>
                      setStrategyForm((current) => ({
                        ...current,
                        isTemplate: event.target.checked,
                      }))
                    }
                    className="h-4 w-4"
                  />
                  设为模板
                </label>
                <section className="mt-5">
                  <div className="flex items-center justify-between gap-3">
                    <h3 className="text-sm font-semibold text-[#eef6ff]">
                      筛选规则
                    </h3>
                    <span className="rounded-full border border-[#e1eeff]/20 px-3 py-1 text-[11px] text-[#8fb0cc]">
                      {countConditions(strategyForm.filters)} 个条件
                    </span>
                  </div>
                  <div className="mt-3">
                    <FilterGroupEditor
                      group={strategyForm.filters}
                      isRoot
                      onChange={(group: FilterGroupInput) =>
                        setStrategyForm((current) => ({
                          ...current,
                          filters: group,
                        }))
                      }
                      onRemove={() => undefined}
                    />
                  </div>
                </section>
                <ScoringRulesEditor
                  rules={strategyForm.scoringRules}
                  normalizationMethod={strategyForm.normalizationMethod}
                  onRulesChange={(rules) =>
                    setStrategyForm((current) => ({
                      ...current,
                      scoringRules: rules,
                    }))
                  }
                  onNormalizationMethodChange={(method) =>
                    setStrategyForm((current) => ({
                      ...current,
                      normalizationMethod: method as NormalizationMethod,
                    }))
                  }
                  onNormalize={() =>
                    setStrategyForm((current) => ({
                      ...current,
                      scoringRules: normalizeRuleWeights(current.scoringRules),
                    }))
                  }
                  weightSum={scoringWeightSum}
                />
                <button
                  type="button"
                  onClick={handleSubmitStrategy}
                  className="mt-5 rounded-xl border border-[#e1eeff]/34 bg-[#0f8468] px-4 py-2 text-sm font-semibold text-[#eefef8]"
                >
                  {strategyMode === "create" ? "保存筛选器" : "保存更新"}
                </button>
              </section>
            </section>
          </div>
        </details>

        <details className="app-panel p-4 sm:p-5" id="sessions-panel">
          <summary className="cursor-pointer text-sm font-medium text-[var(--app-text)]">
            会话历史与详情
            <span className="ml-2 text-xs text-[var(--app-text-soft)]">
              {sessions.length} 条会话 · {liveSessionCount} 进行中
            </span>
          </summary>
          <div className="mt-4">
            <section className="rounded-[26px] border border-[#35526f]/35 bg-[#0d1e33]/95 p-5 sm:p-6">
              <h2 className="font-[family-name:var(--font-display)] text-2xl text-[#e9f4ff]">
                最近结果与候选机会
              </h2>
              <div className="mt-4 grid gap-4 xl:grid-cols-[0.9fr_1.1fr]">
                <div className="space-y-3">
                  {sessions.map((session: SessionListItem) => (
                    <article
                      key={session.id}
                      className={`rounded-2xl border p-4 ${session.id === selectedSessionId ? "border-[#3dd3b5] bg-[#113d37]" : "border-[#35526f]/35 bg-[#10253c]/90"}`}
                    >
                      <button
                        type="button"
                        onClick={() => setSelectedSessionId(session.id)}
                        className="w-full text-left"
                      >
                        <div className="flex items-center justify-between gap-3">
                          <p className="truncate text-sm font-medium text-[#e1eeff]">
                            {session.strategyName}
                          </p>
                          <span
                            className={`text-xs font-semibold ${sessionStatusClassMap[session.status] ?? "text-[#cde0f4]"}`}
                          >
                            {sessionStatusLabelMap[session.status] ??
                              session.status}
                          </span>
                        </div>
                        <p className="mt-1 text-xs text-[#92abc3]">
                          {session.currentStep ?? "等待状态更新"} ·{" "}
                          {session.progressPercent}%
                        </p>
                      </button>
                      <div className="mt-3 flex flex-wrap gap-2 text-xs">
                        {isLiveSession(session.status) ? (
                          <button
                            type="button"
                            onClick={() =>
                              cancelSessionMutation.mutate({
                                sessionId: session.id,
                              })
                            }
                            className="rounded-full border border-[#f6bf63]/70 px-3 py-1 text-[#ffd695]"
                          >
                            取消
                          </button>
                        ) : (
                          <button
                            type="button"
                            onClick={() =>
                              retrySessionMutation.mutate({
                                sessionId: session.id,
                              })
                            }
                            className="rounded-full border border-[#5cd5b8]/28 bg-[#12382f] px-3 py-1 text-[#9cf3d9]"
                          >
                            重试
                          </button>
                        )}
                        {!isLiveSession(session.status) ? (
                          <button
                            type="button"
                            onClick={() =>
                              deleteSessionMutation.mutate({ id: session.id })
                            }
                            className="rounded-full border border-[#ff8d9b]/25 bg-[#4b2331] px-3 py-1 text-[#ff8d9b]"
                          >
                            删除
                          </button>
                        ) : null}
                      </div>
                    </article>
                  ))}
                </div>
                <div className="rounded-2xl border border-[#35526f]/35 bg-[#10263d]/94 p-4">
                  {sessionDetailQuery.data ? (
                    <>
                      <div className="grid gap-3 md:grid-cols-2">
                        <article className="rounded-xl border border-[#e1eeff]/18 bg-[#11253b] px-3 py-3 text-xs text-[#a1b8ce]">
                          <p>状态</p>
                          <p
                            className={`mt-2 text-sm font-semibold ${sessionStatusClassMap[sessionDetailQuery.data.status] ?? "text-[#d6e8f7]"}`}
                          >
                            {sessionStatusLabelMap[
                              sessionDetailQuery.data.status
                            ] ?? sessionDetailQuery.data.status}
                          </p>
                          <p className="mt-2 text-[11px] text-[#7d9ab4]">
                            {sessionDetailQuery.data.currentStep ?? "等待执行"}
                          </p>
                        </article>
                        <article className="rounded-xl border border-[#e1eeff]/18 bg-[#11253b] px-3 py-3 text-xs text-[#a1b8ce]">
                          <p>执行耗时</p>
                          <p className="mt-2 text-sm font-semibold text-[#eef6ff]">
                            {formatDuration(
                              sessionDetailQuery.data.executionTime,
                            )}
                          </p>
                          <p className="mt-2 text-[11px] text-[#7d9ab4]">
                            {formatDate(sessionDetailQuery.data.executedAt)}
                          </p>
                        </article>
                      </div>
                      {sessionDetailQuery.data.status === "SUCCEEDED" ? (
                        <div className="mt-5 overflow-hidden rounded-2xl border border-[#35526f]/35">
                          <table className="min-w-full border-collapse text-left text-xs">
                            <thead className="bg-[#122b42] text-[#b7cee5]">
                              <tr>
                                <th className="px-3 py-2 font-medium">代码</th>
                                <th className="px-3 py-2 font-medium">名称</th>
                                <th className="px-3 py-2 font-medium">评分</th>
                                <th className="px-3 py-2 font-medium">动作</th>
                              </tr>
                            </thead>
                            <tbody>
                              {parsedTopStocks.map((stock: ParsedTopStock) => (
                                <tr
                                  key={stock.stockCode}
                                  className="border-t border-[#35526f]/35"
                                >
                                  <td className="px-3 py-3 text-[#e1eeff]">
                                    {stock.stockCode}
                                  </td>
                                  <td className="px-3 py-3 text-[#e1eeff]">
                                    {stock.stockName}
                                  </td>
                                  <td className="px-3 py-3 text-[#58e8bf]">
                                    {stock.score.toFixed(4)}
                                  </td>
                                  <td className="px-3 py-3">
                                    <button
                                      type="button"
                                      onClick={() =>
                                        addStockMutation.mutate({
                                          watchListId:
                                            selectedWatchListId ?? "",
                                          stockCode: stock.stockCode,
                                          stockName: stock.stockName,
                                          note: stock.explanations[0],
                                          tags: parseTags("跟踪, 命中"),
                                        })
                                      }
                                      disabled={!selectedWatchListId}
                                      className="rounded-full border border-[#5cd5b8]/28 bg-[#12382f] px-3 py-1 text-[11px] text-[#9cf3d9] disabled:opacity-45"
                                    >
                                      加入当前清单
                                    </button>
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      ) : (
                        <p className="mt-4 rounded-xl border border-[#e1eeff]/14 bg-[#10243a] px-3 py-3 text-sm text-[#97afc7]">
                          暂无最终结果。
                        </p>
                      )}
                    </>
                  ) : (
                    <p className="text-sm text-[#8ea8c1]">
                      请选择一个会话查看详情。
                    </p>
                  )}
                </div>
              </div>
            </section>
          </div>
        </details>

        <details className="app-panel p-4 sm:p-5" id="watchlist-panel">
          <summary className="cursor-pointer text-sm font-medium text-[var(--app-text)]">
            观察清单管理
            <span className="ml-2 text-xs text-[var(--app-text-soft)]">
              {watchLists.length} 个清单 · {parsedWatchStocks.length} 支股票
            </span>
          </summary>
          <div className="mt-4">
            <section className="rounded-[26px] border border-[#35526f]/35 bg-[#0d1e33]/95 p-5 sm:p-6">
              <h2 className="font-[family-name:var(--font-display)] text-2xl text-[#e9f4ff]">
                跟踪清单
              </h2>
              <div className="mt-4 grid gap-4 xl:grid-cols-[0.85fr_1.15fr]">
                <div className="grid gap-4">
                  <section className="rounded-2xl border border-[#35526f]/35 bg-[#10253c]/90 p-4">
                    <input
                      value={newWatchListName}
                      onChange={(event) =>
                        setNewWatchListName(event.target.value)
                      }
                      className="w-full rounded-xl border border-[#e1eeff]/34 bg-[#0a1a2d] px-3 py-2 text-sm"
                      placeholder="清单名称"
                    />
                    <input
                      value={newWatchListDescription}
                      onChange={(event) =>
                        setNewWatchListDescription(event.target.value)
                      }
                      className="mt-2 w-full rounded-xl border border-[#e1eeff]/34 bg-[#0a1a2d] px-3 py-2 text-sm"
                      placeholder="备注"
                    />
                    <button
                      type="button"
                      onClick={() =>
                        createWatchListMutation.mutate({
                          name: newWatchListName,
                          description: newWatchListDescription,
                        })
                      }
                      className="mt-2 rounded-xl border border-[#e1eeff]/34 bg-[#2582b5] px-4 py-2 text-sm font-medium text-[#e8f6ff]"
                    >
                      创建清单
                    </button>
                  </section>
                  <section className="rounded-2xl border border-[#35526f]/35 bg-[#10253c]/90 p-4">
                    {watchLists.map((item: WatchListItem) => (
                      <article
                        key={item.id}
                        className={`mb-2 rounded-xl border p-3 ${item.id === selectedWatchListId ? "border-[#37a8df] bg-[#123346]" : "border-[#35526f]/35 bg-[#0a1a2d]"}`}
                      >
                        <button
                          type="button"
                          onClick={() => setSelectedWatchListId(item.id)}
                          className="w-full text-left"
                        >
                          <p className="truncate text-sm font-medium text-[#e1eeff]">
                            {item.name}
                          </p>
                          <p className="mt-1 text-xs text-[#92abc3]">
                            {item.stockCount} 支 · {formatDate(item.updatedAt)}
                          </p>
                        </button>
                      </article>
                    ))}
                  </section>
                </div>
                <div className="rounded-2xl border border-[#35526f]/35 bg-[#10253c]/90 p-4">
                  {watchListDetailQuery.data ? (
                    <>
                      <div className="grid gap-2">
                        <input
                          value={watchMetaName}
                          onChange={(event) =>
                            setWatchMetaName(event.target.value)
                          }
                          className="rounded-xl border border-[#e1eeff]/34 bg-[#0a1a2d] px-3 py-2 text-sm"
                        />
                        <input
                          value={watchMetaDescription}
                          onChange={(event) =>
                            setWatchMetaDescription(event.target.value)
                          }
                          className="rounded-xl border border-[#e1eeff]/34 bg-[#0a1a2d] px-3 py-2 text-sm"
                        />
                        <button
                          type="button"
                          onClick={() =>
                            updateWatchMetaMutation.mutate({
                              id: selectedWatchListId ?? "",
                              name: watchMetaName,
                              description: watchMetaDescription,
                            })
                          }
                          className="rounded-xl border border-[#e1eeff]/34 bg-[#11916f] px-4 py-2 text-sm font-medium text-[#ecfff8]"
                        >
                          更新清单信息
                        </button>
                      </div>
                      <div className="mt-4 max-h-[360px] overflow-auto rounded-lg border border-[#35526f]/35">
                        <table className="min-w-full border-collapse text-left text-xs">
                          <thead className="bg-[#122b42] text-[#b7cee5]">
                            <tr>
                              <th className="px-3 py-2 font-medium">代码</th>
                              <th className="px-3 py-2 font-medium">名称</th>
                              <th className="px-3 py-2 font-medium">备注</th>
                              <th className="px-3 py-2 font-medium">动作</th>
                            </tr>
                          </thead>
                          <tbody>
                            {parsedWatchStocks.map(
                              (stock: ParsedWatchedStock) => (
                                <tr
                                  key={stock.stockCode}
                                  className="border-t border-[#35526f]/35"
                                >
                                  <td className="px-3 py-2 text-[#e1eeff]">
                                    {stock.stockCode}
                                  </td>
                                  <td className="px-3 py-2 text-[#e1eeff]">
                                    {stock.stockName}
                                  </td>
                                  <td className="px-3 py-2 text-[#92abc3]">
                                    {stock.note || "-"}
                                  </td>
                                  <td className="px-3 py-2">
                                    <button
                                      type="button"
                                      onClick={() =>
                                        removeStockMutation.mutate({
                                          watchListId:
                                            selectedWatchListId ?? "",
                                          stockCode: stock.stockCode,
                                        })
                                      }
                                      className="rounded-full border border-[#ff8d9b]/25 bg-[#4b2331] px-2.5 py-1 text-[11px] text-[#ff8d9b]"
                                    >
                                      移除
                                    </button>
                                  </td>
                                </tr>
                              ),
                            )}
                          </tbody>
                        </table>
                      </div>
                    </>
                  ) : (
                    <p className="text-sm text-[#8ea8c1]">未选择清单。</p>
                  )}
                </div>
              </div>
            </section>
          </div>
        </details>
      </div>
    </WorkspaceShell>
  );
}
