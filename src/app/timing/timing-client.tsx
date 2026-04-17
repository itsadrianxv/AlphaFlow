"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import type React from "react";
import { useEffect, useMemo, useState } from "react";
import { StockSearchPicker } from "~/app/_components/stock-search-picker";
import {
  cn,
  EmptyState,
  InlineNotice,
  Panel,
  StatusPill,
  WorkspaceShell,
} from "~/app/_components/ui";
import { WorkflowStageSwitcher } from "~/app/_components/workflow-stage-switcher";
import { buildTimingReportHistoryItems } from "~/app/_components/workspace-history";
import { TimingSignalCardList } from "~/app/timing/timing-signal-card-list";
import { timingStageTabs } from "~/app/timing/timing-stage-tabs";
import {
  buildPortfolioPositionDraft,
  buildRiskSummary,
  createEmptyPortfolioPositionDraft,
  createPresetConfigForStyle,
  inferStrategyStyleKey,
  type PortfolioFormErrors,
  type PortfolioPositionDraft,
  parsePortfolioForm,
  strategyStyleCards,
} from "~/app/timing/timing-wizard-view-models";
import {
  DEFAULT_TIMING_PRESET_CONFIG,
  resolveTimingPresetConfig,
} from "~/server/domain/timing/preset";
import { api } from "~/trpc/react";

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
  }).format(value);
}

function formatPct(value?: number | null) {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return "-";
  }

  return `${value.toFixed(2)}%`;
}

function clonePresetConfig() {
  return resolveTimingPresetConfig(DEFAULT_TIMING_PRESET_CONFIG);
}

const actionToneMap: Record<
  string,
  "neutral" | "info" | "success" | "warning"
> = {
  WATCH: "neutral",
  PROBE: "warning",
  ADD: "success",
  HOLD: "info",
  TRIM: "warning",
  EXIT: "warning",
};

const actionLabelMap: Record<string, string> = {
  WATCH: "观察",
  PROBE: "试仓",
  ADD: "加仓",
  HOLD: "持有",
  TRIM: "减仓",
  EXIT: "退出",
};

const marketRegimeToneMap: Record<
  string,
  "neutral" | "info" | "success" | "warning"
> = {
  RISK_ON: "success",
  NEUTRAL: "info",
  RISK_OFF: "warning",
};

const marketRegimeLabelMap: Record<string, string> = {
  RISK_ON: "风险偏好修复",
  NEUTRAL: "中性环境",
  RISK_OFF: "防守环境",
};

const reviewVerdictLabelMap: Record<string, string> = {
  SUCCESS: "验证通过",
  MIXED: "表现一般",
  FAILURE: "验证失败",
};

const reviewVerdictToneMap: Record<
  string,
  "neutral" | "info" | "success" | "warning"
> = {
  SUCCESS: "success",
  MIXED: "info",
  FAILURE: "warning",
};

const resultActionStartedMessageMap = {
  single: "单股信号流程已启动，结果区会自动刷新约 3 分钟。",
  watchlistCards: "候选信号刷新已启动，结果区会自动刷新约 3 分钟。",
  watchlistTiming: "组合建议流程已启动，结果区会自动刷新约 3 分钟。",
} as const;

const defaultPortfolioFormErrors: PortfolioFormErrors = { rows: {} };

export function TimingClient() {
  const searchParams = useSearchParams();
  const utils = api.useUtils();

  const [activeTabId, setActiveTabId] = useState(
    timingStageTabs[0]?.id ?? "source",
  );
  const [sourceMode, setSourceMode] = useState<"single" | "watchlist">(
    "watchlist",
  );
  const [singleStocks, setSingleStocks] = useState<
    Array<{ stockCode: string; stockName: string; market: string }>
  >([]);
  const [singleSearchKeyword, setSingleSearchKeyword] = useState("");
  const [watchListId, setWatchListId] = useState("");
  const [selectedPortfolioId, setSelectedPortfolioId] = useState("");
  const [portfolioSelectionInitialized, setPortfolioSelectionInitialized] =
    useState(false);
  const [portfolioName, setPortfolioName] = useState("核心组合");
  const [baseCurrency, setBaseCurrency] = useState("CNY");
  const [cash, setCash] = useState("30000");
  const [totalCapital, setTotalCapital] = useState("100000");
  const [maxSingleNamePct, setMaxSingleNamePct] = useState("12");
  const [maxThemeExposurePct, setMaxThemeExposurePct] = useState("28");
  const [defaultProbePct, setDefaultProbePct] = useState("3");
  const [maxPortfolioRiskBudgetPct, setMaxPortfolioRiskBudgetPct] =
    useState("20");
  const [positionDrafts, setPositionDrafts] = useState<
    PortfolioPositionDraft[]
  >([]);
  const [positionSearchKeyword, setPositionSearchKeyword] = useState("");
  const [portfolioFormErrors, setPortfolioFormErrors] =
    useState<PortfolioFormErrors>(defaultPortfolioFormErrors);
  const [portfolioDirty, setPortfolioDirty] = useState(false);
  const [selectedPresetId, setSelectedPresetId] = useState("");
  const [presetSelectionInitialized, setPresetSelectionInitialized] =
    useState(false);
  const [presetDraftId, setPresetDraftId] = useState("");
  const [presetName, setPresetName] = useState("均衡策略");
  const [presetDescription, setPresetDescription] = useState(
    "在确认和灵活之间取平衡。",
  );
  const [presetConfig, setPresetConfig] = useState(() => clonePresetConfig());
  const [presetFormError, setPresetFormError] = useState<string | null>(null);
  const [presetDirty, setPresetDirty] = useState(false);
  const [advancedSettingsOpen, setAdvancedSettingsOpen] = useState(false);
  const [autoRefreshUntil, setAutoRefreshUntil] = useState<number | null>(null);

  const singleStock = singleStocks[0] ?? null;

  const watchListsQuery = api.watchlist.list.useQuery({
    limit: 50,
    offset: 0,
    sortBy: "updatedAt",
    sortDirection: "desc",
  });
  const portfolioSnapshotsQuery = api.timing.listPortfolioSnapshots.useQuery();
  const cardsQuery = api.timing.listTimingCards.useQuery(
    {
      limit: 24,
      stockCode:
        sourceMode === "single"
          ? (singleStock?.stockCode ?? undefined)
          : undefined,
      sourceType:
        sourceMode === "single"
          ? "single"
          : watchListId
            ? "watchlist"
            : undefined,
      watchListId:
        sourceMode === "watchlist" && watchListId ? watchListId : undefined,
    },
    {
      refetchInterval: () =>
        autoRefreshUntil && autoRefreshUntil > Date.now() ? 5_000 : false,
    },
  );
  const recommendationsQuery = api.timing.listRecommendations.useQuery(
    {
      limit: 48,
      watchListId:
        sourceMode === "watchlist" && watchListId ? watchListId : undefined,
      portfolioSnapshotId:
        sourceMode === "watchlist" && selectedPortfolioId
          ? selectedPortfolioId
          : undefined,
    },
    {
      enabled:
        sourceMode === "watchlist" &&
        Boolean(watchListId) &&
        Boolean(selectedPortfolioId),
      refetchInterval: () =>
        autoRefreshUntil && autoRefreshUntil > Date.now() ? 5_000 : false,
    },
  );
  const reviewRecordsQuery = api.timing.listReviewRecords.useQuery(
    { limit: 12, completedOnly: false },
    {
      refetchInterval: () =>
        autoRefreshUntil && autoRefreshUntil > Date.now() ? 5_000 : false,
    },
  );
  const presetsQuery = api.timing.listTimingPresets.useQuery();
  const historyCardsQuery = api.timing.listTimingCards.useQuery(
    { limit: 20 },
    {
      refetchOnWindowFocus: false,
      refetchInterval: () =>
        autoRefreshUntil && autoRefreshUntil > Date.now() ? 5_000 : false,
    },
  );

  const startSingleMutation =
    api.workflow.startTimingSignalPipeline.useMutation({
      onSuccess: async () => {
        setAutoRefreshUntil(Date.now() + 3 * 60_000);
        setActiveTabId("results");
        await Promise.all([
          utils.timing.listTimingCards.invalidate(),
          utils.timing.listRecommendations.invalidate(),
          utils.timing.listReviewRecords.invalidate(),
        ]);
      },
    });
  const startWatchlistCardsMutation =
    api.workflow.startWatchlistTimingCardsPipeline.useMutation({
      onSuccess: async () => {
        setAutoRefreshUntil(Date.now() + 3 * 60_000);
        setActiveTabId("results");
        await Promise.all([
          utils.timing.listTimingCards.invalidate(),
          utils.timing.listRecommendations.invalidate(),
          utils.timing.listReviewRecords.invalidate(),
        ]);
      },
    });
  const startWatchlistTimingMutation =
    api.workflow.startWatchlistTimingPipeline.useMutation({
      onSuccess: async () => {
        setAutoRefreshUntil(Date.now() + 3 * 60_000);
        setActiveTabId("results");
        await Promise.all([
          utils.timing.listTimingCards.invalidate(),
          utils.timing.listRecommendations.invalidate(),
          utils.timing.listReviewRecords.invalidate(),
        ]);
      },
    });
  const startTimingReviewLoopMutation =
    api.workflow.startTimingReviewLoop.useMutation({
      onSuccess: async () => {
        setAutoRefreshUntil(Date.now() + 3 * 60_000);
        await Promise.all([
          utils.timing.listTimingCards.invalidate(),
          utils.timing.listRecommendations.invalidate(),
          utils.timing.listReviewRecords.invalidate(),
        ]);
      },
    });
  const createPortfolioSnapshotMutation =
    api.timing.createPortfolioSnapshot.useMutation({
      onSuccess: async (snapshot) => {
        setSelectedPortfolioId(snapshot.id);
        setPortfolioDirty(false);
        setPortfolioFormErrors(defaultPortfolioFormErrors);
        await Promise.all([
          utils.timing.listPortfolioSnapshots.invalidate(),
          utils.timing.listRecommendations.invalidate(),
        ]);
      },
    });
  const updatePortfolioSnapshotMutation =
    api.timing.updatePortfolioSnapshot.useMutation({
      onSuccess: async () => {
        setPortfolioDirty(false);
        setPortfolioFormErrors(defaultPortfolioFormErrors);
        await Promise.all([
          utils.timing.listPortfolioSnapshots.invalidate(),
          utils.timing.listRecommendations.invalidate(),
        ]);
      },
    });
  const saveTimingPresetMutation = api.timing.saveTimingPreset.useMutation({
    onSuccess: async (preset) => {
      setSelectedPresetId(preset.id);
      setPresetDraftId(preset.id);
      setPresetDirty(false);
      setPresetFormError(null);
      await utils.timing.listTimingPresets.invalidate();
    },
  });

  useEffect(() => {
    const stockCodeFromUrl = searchParams.get("stockCode");
    const watchListIdFromUrl = searchParams.get("watchListId");

    if (stockCodeFromUrl) {
      setSourceMode("single");
      setSingleStocks([
        {
          stockCode: stockCodeFromUrl.replace(/\D/g, "").slice(0, 6),
          stockName: stockCodeFromUrl.replace(/\D/g, "").slice(0, 6),
          market: "",
        },
      ]);
      setActiveTabId("source");
    }

    if (watchListIdFromUrl) {
      setSourceMode("watchlist");
      setWatchListId(watchListIdFromUrl);
      setActiveTabId("source");
    }
  }, [searchParams]);

  useEffect(() => {
    if (
      !watchListId &&
      watchListsQuery.data?.[0]?.id &&
      sourceMode === "watchlist"
    ) {
      setWatchListId(watchListsQuery.data[0].id);
    }
  }, [sourceMode, watchListId, watchListsQuery.data]);

  useEffect(() => {
    if (
      !portfolioSelectionInitialized &&
      !selectedPortfolioId &&
      portfolioSnapshotsQuery.data?.[0]?.id
    ) {
      setSelectedPortfolioId(portfolioSnapshotsQuery.data[0].id);
      setPortfolioSelectionInitialized(true);
      return;
    }

    if (!portfolioSelectionInitialized && portfolioSnapshotsQuery.data) {
      setPortfolioSelectionInitialized(true);
    }
  }, [
    portfolioSelectionInitialized,
    portfolioSnapshotsQuery.data,
    selectedPortfolioId,
  ]);

  const presets = presetsQuery.data ?? [];

  useEffect(() => {
    if (!presetSelectionInitialized && !selectedPresetId && presets[0]?.id) {
      setSelectedPresetId(presets[0].id);
      setPresetSelectionInitialized(true);
      return;
    }

    if (!presetSelectionInitialized) {
      setPresetSelectionInitialized(true);
    }
  }, [presetSelectionInitialized, presets, selectedPresetId]);

  type RecommendationItem = NonNullable<
    typeof recommendationsQuery.data
  >[number];
  type PortfolioSnapshotItem = NonNullable<
    typeof portfolioSnapshotsQuery.data
  >[number];
  type PresetItem = NonNullable<typeof presetsQuery.data>[number];
  type WatchListItem = NonNullable<typeof watchListsQuery.data>[number];

  const cards = cardsQuery.data ?? [];
  const recommendations = recommendationsQuery.data ?? [];
  const latestRecommendationRunId = recommendations[0]?.workflowRunId;
  const latestRecommendations = latestRecommendationRunId
    ? recommendations.filter(
        (item: RecommendationItem) =>
          item.workflowRunId === latestRecommendationRunId,
      )
    : recommendations;
  const selectedSnapshot =
    portfolioSnapshotsQuery.data?.find(
      (snapshot: PortfolioSnapshotItem) => snapshot.id === selectedPortfolioId,
    ) ?? null;
  const selectedPreset =
    presets.find((item: PresetItem) => item.id === selectedPresetId) ?? null;
  const recommendationContext = latestRecommendations[0]?.reasoning ?? null;
  const reviewRecords = reviewRecordsQuery.data ?? [];

  useEffect(() => {
    if (selectedSnapshot) {
      setPortfolioName(selectedSnapshot.name);
      setBaseCurrency(selectedSnapshot.baseCurrency);
      setCash(String(selectedSnapshot.cash));
      setTotalCapital(String(selectedSnapshot.totalCapital));
      setMaxSingleNamePct(
        String(selectedSnapshot.riskPreferences.maxSingleNamePct),
      );
      setMaxThemeExposurePct(
        String(selectedSnapshot.riskPreferences.maxThemeExposurePct),
      );
      setDefaultProbePct(
        String(selectedSnapshot.riskPreferences.defaultProbePct),
      );
      setMaxPortfolioRiskBudgetPct(
        String(selectedSnapshot.riskPreferences.maxPortfolioRiskBudgetPct),
      );
      setPositionDrafts(
        selectedSnapshot.positions.map((position) =>
          buildPortfolioPositionDraft(position),
        ),
      );
      setPortfolioFormErrors(defaultPortfolioFormErrors);
      setPortfolioDirty(false);
      return;
    }

    if (!selectedPortfolioId) {
      setPortfolioName("核心组合");
      setBaseCurrency("CNY");
      setCash("30000");
      setTotalCapital("100000");
      setMaxSingleNamePct("12");
      setMaxThemeExposurePct("28");
      setDefaultProbePct("3");
      setMaxPortfolioRiskBudgetPct("20");
      setPositionDrafts([]);
      setPortfolioFormErrors(defaultPortfolioFormErrors);
      setPortfolioDirty(false);
    }
  }, [selectedPortfolioId, selectedSnapshot]);

  useEffect(() => {
    if (!selectedPreset) {
      return;
    }

    setPresetDraftId(selectedPreset.id);
    setPresetName(selectedPreset.name);
    setPresetDescription(selectedPreset.description ?? "");
    setPresetConfig(resolveTimingPresetConfig(selectedPreset.config));
    setPresetFormError(null);
    setPresetDirty(false);
  }, [selectedPreset]);

  const historyItems = useMemo(
    () => buildTimingReportHistoryItems(historyCardsQuery.data ?? []),
    [historyCardsQuery.data],
  );

  const selectedWatchList =
    watchListsQuery.data?.find(
      (item: WatchListItem) => item.id === watchListId,
    ) ?? null;
  const activeStyle = inferStrategyStyleKey({
    name: presetName,
    description: presetDescription,
    config: presetConfig,
  });
  const portfolioRiskSummary = useMemo(
    () =>
      buildRiskSummary({
        cash,
        totalCapital,
        maxSingleNamePct,
        maxThemeExposurePct,
        defaultProbePct,
        maxPortfolioRiskBudgetPct,
        positions: positionDrafts,
        reasoning: recommendationContext,
      }),
    [
      cash,
      defaultProbePct,
      maxPortfolioRiskBudgetPct,
      maxSingleNamePct,
      maxThemeExposurePct,
      positionDrafts,
      recommendationContext,
      totalCapital,
    ],
  );
  const resultActionDisabledReason = useMemo(() => {
    if (sourceMode === "single") {
      if (!singleStock) {
        return "先在步骤 1 选择一只股票。";
      }
      if (presetDirty) {
        return "策略草稿还没有保存，先在步骤 3 保存并设为当前策略。";
      }
      return null;
    }

    if (!watchListId) {
      return "先在步骤 1 选择一个自选股列表。";
    }
    if (!selectedPortfolioId) {
      return "先在步骤 2 保存一个组合快照。";
    }
    if (portfolioDirty) {
      return "组合盘点有未保存内容，先保存当前快照。";
    }
    if (presetDirty) {
      return "策略草稿还没有保存，先在步骤 3 保存并设为当前策略。";
    }
    return null;
  }, [
    portfolioDirty,
    presetDirty,
    selectedPortfolioId,
    singleStock,
    sourceMode,
    watchListId,
  ]);
  const resultActionErrorMessage = useMemo(() => {
    if (sourceMode === "single") {
      return startSingleMutation.error?.message ?? null;
    }

    return (
      startWatchlistTimingMutation.error?.message ??
      startWatchlistCardsMutation.error?.message ??
      null
    );
  }, [
    sourceMode,
    startSingleMutation.error?.message,
    startWatchlistCardsMutation.error?.message,
    startWatchlistTimingMutation.error?.message,
  ]);
  const resultActionSuccessMessage = useMemo(() => {
    if (sourceMode === "single") {
      return startSingleMutation.data
        ? resultActionStartedMessageMap.single
        : null;
    }

    if (startWatchlistTimingMutation.data) {
      return resultActionStartedMessageMap.watchlistTiming;
    }

    if (startWatchlistCardsMutation.data) {
      return resultActionStartedMessageMap.watchlistCards;
    }

    return null;
  }, [
    sourceMode,
    startSingleMutation.data,
    startWatchlistCardsMutation.data,
    startWatchlistTimingMutation.data,
  ]);

  async function handleStartSingle() {
    if (!singleStock) {
      return;
    }

    await startSingleMutation.mutateAsync({
      stockCode: singleStock.stockCode,
      presetId: selectedPresetId || undefined,
    });
  }

  async function handleStartWatchlistCards() {
    if (!watchListId) {
      return;
    }

    await startWatchlistCardsMutation.mutateAsync({
      watchListId,
      presetId: selectedPresetId || undefined,
    });
  }

  async function handleStartWatchlistTiming() {
    if (!watchListId || !selectedPortfolioId) {
      return;
    }

    await startWatchlistTimingMutation.mutateAsync({
      watchListId,
      portfolioSnapshotId: selectedPortfolioId,
      presetId: selectedPresetId || undefined,
    });
  }

  async function handleSavePortfolioSnapshot(saveMode: "create" | "update") {
    const result = parsePortfolioForm({
      name: portfolioName,
      baseCurrency,
      cash,
      totalCapital,
      maxSingleNamePct,
      maxThemeExposurePct,
      defaultProbePct,
      maxPortfolioRiskBudgetPct,
      positions: positionDrafts,
    });

    if (!result.ok) {
      setPortfolioFormErrors(result.errors);
      return;
    }

    if (saveMode === "update" && selectedPortfolioId) {
      await updatePortfolioSnapshotMutation.mutateAsync({
        id: selectedPortfolioId,
        ...result.payload,
      });
      return;
    }

    await createPortfolioSnapshotMutation.mutateAsync(result.payload);
  }

  async function handleSavePreset() {
    if (!presetName.trim()) {
      setPresetFormError("请输入策略名称。");
      return;
    }

    await saveTimingPresetMutation.mutateAsync({
      id: presetDraftId || undefined,
      name: presetName.trim(),
      description: presetDescription.trim() || undefined,
      config: presetConfig,
    });
  }

  function updatePortfolioRow(
    clientId: string,
    patch: Partial<PortfolioPositionDraft>,
  ) {
    setPositionDrafts((current) =>
      current.map((item) =>
        item.clientId === clientId ? { ...item, ...patch } : item,
      ),
    );
    setPortfolioDirty(true);
    setPortfolioFormErrors((current) => ({
      ...current,
      rows: {
        ...current.rows,
        [clientId]: {
          ...current.rows[clientId],
          ...Object.fromEntries(
            Object.keys(patch).map((key) => [key, undefined]),
          ),
        },
      },
    }));
  }

  function removePortfolioRow(clientId: string) {
    setPositionDrafts((current) =>
      current.filter((item) => item.clientId !== clientId),
    );
    setPortfolioDirty(true);
    setPortfolioFormErrors((current) => {
      const nextRows = { ...current.rows };
      delete nextRows[clientId];
      return {
        ...current,
        rows: nextRows,
      };
    });
  }

  function handleAddPositionFromSearch(stock: {
    stockCode: string;
    stockName: string;
    market: string;
  }) {
    setPositionSearchKeyword("");
    setPositionDrafts((current) => {
      if (current.some((item) => item.stockCode === stock.stockCode)) {
        return current;
      }

      return [...current, createEmptyPortfolioPositionDraft(stock)];
    });
    setPortfolioDirty(true);
  }

  function handleToggleSingleStock(stock: {
    stockCode: string;
    stockName: string;
    market: string;
  }) {
    setSourceMode("single");
    setSingleStocks((current) =>
      current[0]?.stockCode === stock.stockCode ? [] : [stock],
    );
  }

  function handleApplyStrategyStyle(
    styleKey: "steady" | "balanced" | "aggressive",
  ) {
    const styleCard = strategyStyleCards.find((item) => item.key === styleKey);
    setSelectedPresetId("");
    setPresetDraftId("");
    setPresetName(styleCard ? `${styleCard.title}策略` : "自定义策略");
    setPresetDescription(styleCard?.summary ?? "");
    setPresetConfig(createPresetConfigForStyle(styleKey));
    setPresetDirty(true);
    setPresetFormError(null);
  }

  function updatePresetConfigNumber(
    group:
      | "signalEngineWeights"
      | "actionThresholds"
      | "feedbackPolicy"
      | "contextWeights",
    key: string,
    value: string,
  ) {
    const nextValue = value === "" ? 0 : Number(value);
    setPresetConfig((current) => ({
      ...current,
      [group]: {
        ...(current[group] ?? {}),
        [key]: nextValue,
      },
    }));
    setPresetDirty(true);
  }

  function toggleReviewHorizon(value: "T5" | "T10" | "T20") {
    const currentHorizonSet = new Set(
      presetConfig.reviewSchedule?.horizons ?? [],
    );
    if (currentHorizonSet.has(value)) {
      currentHorizonSet.delete(value);
    } else {
      currentHorizonSet.add(value);
    }

    setPresetConfig((current) => ({
      ...current,
      reviewSchedule: {
        horizons: [...currentHorizonSet].sort((left, right) =>
          left.localeCompare(right, "zh-CN"),
        ) as Array<"T5" | "T10" | "T20">,
      },
    }));
    setPresetDirty(true);
  }

  return (
    <WorkspaceShell
      section="timing"
      historyItems={historyItems}
      historyHref="/timing/history"
      historyLoading={historyCardsQuery.isLoading}
      historyEmptyText="还没有择时报告"
      eyebrow="组合决策"
      title="择时组合"
      actions={
        <>
          <Link href="/workflows" className="app-button">
            查看研究详情
          </Link>
          <Link href="/screening" className="app-button app-button-success">
            返回机会池
          </Link>
        </>
      }
    >
      <WorkflowStageSwitcher
        tabs={timingStageTabs}
        activeTabId={activeTabId}
        onChange={setActiveTabId}
        panels={{
          source: null,
          portfolio: null,
          strategy: null,
          results: null,
        }}
      />

      {activeTabId === "source" ? (
        <div className="grid gap-6 xl:grid-cols-[1.15fr_0.85fr]">
          <Panel title="本轮信号来源">
            <div className="grid gap-5">
              <div className="grid gap-3 md:grid-cols-2">
                <button
                  type="button"
                  onClick={() => setSourceMode("single")}
                  className={cn(
                    "cursor-pointer rounded-[12px] border p-4 text-left transition-colors",
                    sourceMode === "single"
                      ? "border-[var(--app-border-strong)] bg-[var(--app-panel-soft)]"
                      : "border-[var(--app-border-soft)] bg-[var(--app-surface)] hover:border-[var(--app-border-strong)]",
                  )}
                >
                  <div className="text-base font-medium text-[var(--app-text)]">
                    单股判断
                  </div>
                  <div className="mt-2 text-sm leading-6 text-[var(--app-text-muted)]">
                    适合已经有明确目标，只想先看一只股票当前处在什么节奏。
                  </div>
                </button>
                <button
                  type="button"
                  onClick={() => setSourceMode("watchlist")}
                  className={cn(
                    "cursor-pointer rounded-[12px] border p-4 text-left transition-colors",
                    sourceMode === "watchlist"
                      ? "border-[var(--app-border-strong)] bg-[var(--app-panel-soft)]"
                      : "border-[var(--app-border-soft)] bg-[var(--app-surface)] hover:border-[var(--app-border-strong)]",
                  )}
                >
                  <div className="text-base font-medium text-[var(--app-text)]">
                    自选股列表
                  </div>
                  <div className="mt-2 text-sm leading-6 text-[var(--app-text-muted)]">
                    适合在一组候选里挑优先级，再结合组合约束生成建议。
                  </div>
                </button>
              </div>

              {sourceMode === "single" ? (
                <StockSearchPicker
                  label="搜索股票"
                  keyword={singleSearchKeyword}
                  onKeywordChange={setSingleSearchKeyword}
                  selectedStocks={singleStocks}
                  onToggleStock={handleToggleSingleStock}
                  maxSelection={1}
                  emptyHint="输入股票代码或名称，选择这一轮要重点判断的股票。"
                />
              ) : (
                <label className="grid gap-2 text-sm text-[var(--app-text-muted)]">
                  选择自选股列表
                  <select
                    value={watchListId}
                    onChange={(event) => {
                      setWatchListId(event.target.value);
                      setSourceMode("watchlist");
                    }}
                    className="app-input"
                  >
                    {watchListsQuery.data?.map((watchList) => (
                      <option key={watchList.id} value={watchList.id}>
                        {watchList.name} · {watchList.stockCount} 只
                      </option>
                    ))}
                  </select>
                </label>
              )}
            </div>
          </Panel>

          <Panel title="当前选择">
            {sourceMode === "single" ? (
              singleStock ? (
                <div className="grid gap-4">
                  <div className="rounded-[12px] border border-[var(--app-border)] bg-[var(--app-panel-soft)] p-4">
                    <div className="text-lg font-medium text-[var(--app-text)]">
                      {singleStock.stockName}
                    </div>
                    <div className="mt-2 text-sm text-[var(--app-text-muted)]">
                      {singleStock.stockCode}
                      {singleStock.market ? ` · ${singleStock.market}` : ""}
                    </div>
                  </div>
                  <p className="text-sm leading-6 text-[var(--app-text-muted)]">
                    下一步去盘点当前组合，系统会用你的持仓和风险边界解释这只股票是否适合试仓、持有还是暂时观察。
                  </p>
                </div>
              ) : (
                <EmptyState
                  title="还没有选中股票"
                  description="先搜索并选中一只股票，再继续盘点组合。"
                />
              )
            ) : selectedWatchList ? (
              <div className="grid gap-4">
                <div className="rounded-[12px] border border-[var(--app-border)] bg-[var(--app-panel-soft)] p-4">
                  <div className="text-lg font-medium text-[var(--app-text)]">
                    {selectedWatchList.name}
                  </div>
                  <div className="mt-2 text-sm text-[var(--app-text-muted)]">
                    共 {selectedWatchList.stockCount} 只股票，更新于{" "}
                    {formatDate(selectedWatchList.updatedAt)}
                  </div>
                </div>
                <p className="text-sm leading-6 text-[var(--app-text-muted)]">
                  下一步去盘点现金和当前持仓，结果页会把这份列表和组合约束一起用于生成建议。
                </p>
              </div>
            ) : (
              <EmptyState
                title="还没有选中自选股列表"
                description="先确定这轮要看的候选池，再继续下一步。"
              />
            )}

            <div className="mt-5 flex justify-end">
              <button
                type="button"
                onClick={() => setActiveTabId("portfolio")}
                className="app-button app-button-primary"
              >
                继续盘点组合
              </button>
            </div>
          </Panel>
        </div>
      ) : null}

      {activeTabId === "portfolio" ? (
        <div className="grid gap-6 xl:grid-cols-[1.05fr_0.95fr]">
          <Panel
            title="盘点组合"
            actions={
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  className="app-button"
                  onClick={() => void handleSavePortfolioSnapshot("create")}
                  disabled={createPortfolioSnapshotMutation.isPending}
                >
                  {createPortfolioSnapshotMutation.isPending
                    ? "保存中..."
                    : "另存为新快照"}
                </button>
                <button
                  type="button"
                  className="app-button app-button-success"
                  onClick={() => void handleSavePortfolioSnapshot("update")}
                  disabled={
                    updatePortfolioSnapshotMutation.isPending ||
                    !selectedPortfolioId
                  }
                >
                  {updatePortfolioSnapshotMutation.isPending
                    ? "更新中..."
                    : "保存到当前快照"}
                </button>
              </div>
            }
          >
            <div className="grid gap-5">
              <label className="grid gap-2 text-sm text-[var(--app-text-muted)]">
                选择已有快照
                <select
                  value={selectedPortfolioId}
                  onChange={(event) =>
                    setSelectedPortfolioId(event.target.value)
                  }
                  className="app-input"
                >
                  <option value="">新建一个快照</option>
                  {portfolioSnapshotsQuery.data?.map((snapshot) => (
                    <option key={snapshot.id} value={snapshot.id}>
                      {snapshot.name}
                    </option>
                  ))}
                </select>
              </label>

              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                <LabeledInput
                  label="组合名称"
                  required
                  value={portfolioName}
                  onChange={(value) => {
                    setPortfolioName(value);
                    setPortfolioDirty(true);
                    setPortfolioFormErrors((current) => ({
                      ...current,
                      name: undefined,
                    }));
                  }}
                  error={portfolioFormErrors.name}
                />
                <LabeledInput
                  label="计价货币"
                  value={baseCurrency}
                  onChange={(value) => {
                    setBaseCurrency(value);
                    setPortfolioDirty(true);
                  }}
                />
                <LabeledInput
                  label="现金"
                  required
                  value={cash}
                  onChange={(value) => {
                    setCash(value);
                    setPortfolioDirty(true);
                    setPortfolioFormErrors((current) => ({
                      ...current,
                      cash: undefined,
                    }));
                  }}
                  inputMode="decimal"
                  error={portfolioFormErrors.cash}
                />
                <LabeledInput
                  label="总资产"
                  required
                  value={totalCapital}
                  onChange={(value) => {
                    setTotalCapital(value);
                    setPortfolioDirty(true);
                    setPortfolioFormErrors((current) => ({
                      ...current,
                      totalCapital: undefined,
                    }));
                  }}
                  inputMode="decimal"
                  error={portfolioFormErrors.totalCapital}
                />
                <LabeledInput
                  label="单票上限 (%)"
                  required
                  value={maxSingleNamePct}
                  onChange={(value) => {
                    setMaxSingleNamePct(value);
                    setPortfolioDirty(true);
                    setPortfolioFormErrors((current) => ({
                      ...current,
                      maxSingleNamePct: undefined,
                    }));
                  }}
                  inputMode="decimal"
                  error={portfolioFormErrors.maxSingleNamePct}
                />
                <LabeledInput
                  label="主题暴露上限 (%)"
                  required
                  value={maxThemeExposurePct}
                  onChange={(value) => {
                    setMaxThemeExposurePct(value);
                    setPortfolioDirty(true);
                    setPortfolioFormErrors((current) => ({
                      ...current,
                      maxThemeExposurePct: undefined,
                    }));
                  }}
                  inputMode="decimal"
                  error={portfolioFormErrors.maxThemeExposurePct}
                />
                <LabeledInput
                  label="默认试仓比例 (%)"
                  required
                  value={defaultProbePct}
                  onChange={(value) => {
                    setDefaultProbePct(value);
                    setPortfolioDirty(true);
                    setPortfolioFormErrors((current) => ({
                      ...current,
                      defaultProbePct: undefined,
                    }));
                  }}
                  inputMode="decimal"
                  error={portfolioFormErrors.defaultProbePct}
                />
                <LabeledInput
                  label="风险预算上限 (%)"
                  required
                  value={maxPortfolioRiskBudgetPct}
                  onChange={(value) => {
                    setMaxPortfolioRiskBudgetPct(value);
                    setPortfolioDirty(true);
                    setPortfolioFormErrors((current) => ({
                      ...current,
                      maxPortfolioRiskBudgetPct: undefined,
                    }));
                  }}
                  inputMode="decimal"
                  error={portfolioFormErrors.maxPortfolioRiskBudgetPct}
                />
              </div>

              <div className="grid gap-3">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <div className="text-base font-medium text-[var(--app-text)]">
                      当前持仓
                    </div>
                    <div className="mt-1 text-sm text-[var(--app-text-muted)]">
                      通过股票搜索把已有持仓加入组合草稿，再补齐数量、成本和当前仓位。
                    </div>
                  </div>
                  <StatusPill
                    label={`${positionDrafts.length} 只持仓`}
                    tone={positionDrafts.length > 0 ? "success" : "neutral"}
                  />
                </div>

                <StockSearchPicker
                  label="新增持仓"
                  keyword={positionSearchKeyword}
                  onKeywordChange={setPositionSearchKeyword}
                  selectedStocks={[]}
                  onToggleStock={handleAddPositionFromSearch}
                  emptyHint="搜索股票后把它加入当前组合，再补齐数量、成本和仓位。"
                />

                {positionDrafts.length === 0 ? (
                  <EmptyState
                    title="还没有录入持仓"
                    description="如果当前组合是空仓，也可以只填写现金和风险边界后直接继续下一步。"
                  />
                ) : (
                  <div className="grid gap-4">
                    {positionDrafts.map((position) => (
                      <PortfolioPositionEditor
                        key={position.clientId}
                        position={position}
                        errors={portfolioFormErrors.rows[position.clientId]}
                        onChange={(patch) =>
                          updatePortfolioRow(position.clientId, patch)
                        }
                        onRemove={() => removePortfolioRow(position.clientId)}
                      />
                    ))}
                  </div>
                )}
              </div>
            </div>
          </Panel>

          <Panel title="风控解读">
            <div className="grid gap-4">
              <div className="grid gap-3 md:grid-cols-2">
                <SummaryMetric
                  label="可动用现金"
                  value={formatPct(portfolioRiskSummary.availableCashPct)}
                  hint="按现金 / 总资产粗略估算"
                />
                <SummaryMetric
                  label="当前单票上限"
                  value={formatPct(portfolioRiskSummary.maxSingleNamePct)}
                  hint="若已有市场状态，会按风险计划收紧"
                />
                <SummaryMetric
                  label="默认试仓"
                  value={formatPct(portfolioRiskSummary.defaultProbePct)}
                  hint="试仓区间会围绕这个比例给出"
                />
                <SummaryMetric
                  label="本轮风险预算"
                  value={formatPct(
                    portfolioRiskSummary.maxPortfolioRiskBudgetPct,
                  )}
                  hint="生成建议后会结合市场状态再次校准"
                />
              </div>

              {recommendationContext?.marketContext.summary ? (
                <InlineNotice
                  tone={
                    marketRegimeToneMap[
                      recommendationContext.marketContext.state ?? "NEUTRAL"
                    ]
                  }
                  title="最新市场语境"
                  description={recommendationContext.marketContext.summary}
                />
              ) : null}

              {portfolioRiskSummary.blockedActions.length > 0 ? (
                <InlineNotice
                  tone="warning"
                  title="当前动作限制"
                  description={`当前更适合限制 ${portfolioRiskSummary.blockedActions
                    .map((action) => actionLabelMap[action] ?? action)
                    .join("、")}。`}
                />
              ) : null}

              {portfolioRiskSummary.crowdedExposures.length > 0 ? (
                <div className="rounded-[12px] border border-[var(--app-border)] bg-[var(--app-panel-soft)] p-4">
                  <div className="text-sm font-medium text-[var(--app-text)]">
                    潜在拥挤暴露
                  </div>
                  <ul className="mt-3 grid gap-2 text-sm leading-6 text-[var(--app-text-muted)]">
                    {portfolioRiskSummary.crowdedExposures.map((item) => (
                      <li key={item}>- {item}</li>
                    ))}
                  </ul>
                </div>
              ) : null}

              <div className="rounded-[12px] border border-[var(--app-border)] bg-[var(--app-panel-soft)] p-4">
                <div className="text-sm font-medium text-[var(--app-text)]">
                  本轮解读
                </div>
                <ul className="mt-3 grid gap-2 text-sm leading-6 text-[var(--app-text-muted)]">
                  <li>
                    -{" "}
                    {portfolioDirty
                      ? "组合草稿还未保存，结果页不会使用最新修改。"
                      : "当前快照已经就绪，可以继续选择策略。"}
                  </li>
                  <li>
                    -{" "}
                    {positionDrafts.length > 0
                      ? "有持仓时，系统会优先判断继续持有、减仓还是退出。"
                      : "空仓时，系统会更关注试仓和新开仓信号。"}
                  </li>
                  {(portfolioRiskSummary.notes.length > 0
                    ? portfolioRiskSummary.notes
                    : ["生成建议后会在这里补充市场状态和风险计划笔记。"]
                  ).map((note) => (
                    <li key={note}>- {note}</li>
                  ))}
                </ul>
              </div>

              <div className="flex justify-between gap-2">
                <button
                  type="button"
                  onClick={() => setActiveTabId("source")}
                  className="app-button"
                >
                  返回来源
                </button>
                <button
                  type="button"
                  onClick={() => setActiveTabId("strategy")}
                  className="app-button app-button-primary"
                >
                  继续选择策略
                </button>
              </div>
            </div>
          </Panel>
        </div>
      ) : null}

      {activeTabId === "strategy" ? (
        <div className="grid gap-6 xl:grid-cols-[1fr_1fr]">
          <Panel title="策略风格">
            <div className="grid gap-5">
              <div className="grid gap-3 md:grid-cols-3">
                {strategyStyleCards.map((style) => (
                  <button
                    key={style.key}
                    type="button"
                    onClick={() => handleApplyStrategyStyle(style.key)}
                    className={cn(
                      "cursor-pointer rounded-[12px] border p-4 text-left transition-colors",
                      activeStyle === style.key
                        ? "border-[var(--app-border-strong)] bg-[var(--app-panel-soft)]"
                        : "border-[var(--app-border-soft)] bg-[var(--app-surface)] hover:border-[var(--app-border-strong)]",
                    )}
                  >
                    <div className="text-base font-medium text-[var(--app-text)]">
                      {style.title}
                    </div>
                    <div className="mt-2 text-sm leading-6 text-[var(--app-text-muted)]">
                      {style.summary}
                    </div>
                    <div className="mt-3 text-xs leading-5 text-[var(--app-text-soft)]">
                      {style.detail}
                    </div>
                  </button>
                ))}
              </div>

              <div className="grid gap-3">
                <div className="flex items-center justify-between gap-3">
                  <div className="text-base font-medium text-[var(--app-text)]">
                    已保存策略
                  </div>
                  <StatusPill
                    label={
                      selectedPreset
                        ? `当前使用 ${selectedPreset.name}`
                        : "使用内置默认策略"
                    }
                    tone={selectedPreset ? "success" : "info"}
                  />
                </div>
                {presets.length === 0 ? (
                  <EmptyState
                    title="还没有保存策略"
                    description="可以先选上面的风格卡，再保存成自己的常用策略。"
                  />
                ) : (
                  <div className="grid gap-2">
                    {presets.map((preset: PresetItem) => {
                      const presetStyle = inferStrategyStyleKey({
                        name: preset.name,
                        description: preset.description,
                        config: preset.config,
                      });
                      return (
                        <button
                          key={preset.id}
                          type="button"
                          onClick={() => setSelectedPresetId(preset.id)}
                          className={cn(
                            "cursor-pointer rounded-[10px] border px-4 py-3 text-left transition-colors",
                            selectedPresetId === preset.id
                              ? "border-[var(--app-border-strong)] bg-[var(--app-panel-soft)]"
                              : "border-[var(--app-border-soft)] bg-[var(--app-surface)] hover:border-[var(--app-border-strong)]",
                          )}
                        >
                          <div className="flex items-center justify-between gap-3">
                            <div className="min-w-0">
                              <div className="truncate text-sm font-medium text-[var(--app-text)]">
                                {preset.name}
                              </div>
                              <div className="mt-1 text-xs text-[var(--app-text-soft)]">
                                {preset.description || "未填写说明"}
                              </div>
                            </div>
                            <StatusPill
                              label={
                                strategyStyleCards.find(
                                  (item) => item.key === presetStyle,
                                )?.title ?? "均衡"
                              }
                              tone="neutral"
                            />
                          </div>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          </Panel>

          <Panel
            title="高级设置"
            actions={
              <button
                type="button"
                onClick={() => setAdvancedSettingsOpen((current) => !current)}
                className="app-button"
              >
                {advancedSettingsOpen ? "收起高级设置" : "展开高级设置"}
              </button>
            }
          >
            <div className="grid gap-5">
              <div className="grid gap-4 md:grid-cols-2">
                <LabeledInput
                  label="策略名称"
                  required
                  value={presetName}
                  onChange={(value) => {
                    setPresetName(value);
                    setPresetDirty(true);
                    setPresetFormError(null);
                  }}
                />
                <LabeledInput
                  label="策略说明"
                  value={presetDescription}
                  onChange={(value) => {
                    setPresetDescription(value);
                    setPresetDirty(true);
                  }}
                />
              </div>

              <InlineNotice
                tone={presetDirty ? "warning" : "info"}
                title="当前策略状态"
                description={
                  presetDirty
                    ? "策略草稿有未保存修改，保存后才会用于后续生成。"
                    : selectedPreset
                      ? `当前用于生成的是「${selectedPreset.name}」。`
                      : "当前使用内置默认策略，若想长期复用，先保存成自己的策略。"
                }
              />

              {advancedSettingsOpen ? (
                <div className="grid gap-5">
                  <div className="grid gap-3">
                    <div className="text-sm font-medium text-[var(--app-text)]">
                      信号权重
                    </div>
                    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                      <NumericConfigInput
                        label="多周期一致性"
                        value={
                          presetConfig.signalEngineWeights
                            ?.multiTimeframeAlignment
                        }
                        onChange={(value) =>
                          updatePresetConfigNumber(
                            "signalEngineWeights",
                            "multiTimeframeAlignment",
                            value,
                          )
                        }
                      />
                      <NumericConfigInput
                        label="相对强度"
                        value={
                          presetConfig.signalEngineWeights?.relativeStrength
                        }
                        onChange={(value) =>
                          updatePresetConfigNumber(
                            "signalEngineWeights",
                            "relativeStrength",
                            value,
                          )
                        }
                      />
                      <NumericConfigInput
                        label="波动分位"
                        value={
                          presetConfig.signalEngineWeights?.volatilityPercentile
                        }
                        onChange={(value) =>
                          updatePresetConfigNumber(
                            "signalEngineWeights",
                            "volatilityPercentile",
                            value,
                          )
                        }
                      />
                    </div>
                  </div>

                  <div className="grid gap-3">
                    <div className="text-sm font-medium text-[var(--app-text)]">
                      动作阈值
                    </div>
                    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                      <NumericConfigInput
                        label="加仓置信度"
                        value={presetConfig.actionThresholds?.addConfidence}
                        onChange={(value) =>
                          updatePresetConfigNumber(
                            "actionThresholds",
                            "addConfidence",
                            value,
                          )
                        }
                      />
                      <NumericConfigInput
                        label="试仓置信度"
                        value={presetConfig.actionThresholds?.probeConfidence}
                        onChange={(value) =>
                          updatePresetConfigNumber(
                            "actionThresholds",
                            "probeConfidence",
                            value,
                          )
                        }
                      />
                      <NumericConfigInput
                        label="减仓置信度"
                        value={presetConfig.actionThresholds?.trimConfidence}
                        onChange={(value) =>
                          updatePresetConfigNumber(
                            "actionThresholds",
                            "trimConfidence",
                            value,
                          )
                        }
                      />
                    </div>
                  </div>

                  <div className="grid gap-3">
                    <div className="text-sm font-medium text-[var(--app-text)]">
                      复盘节奏
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {(["T5", "T10", "T20"] as const).map((horizon) => {
                        const active =
                          presetConfig.reviewSchedule?.horizons?.includes(
                            horizon,
                          ) ?? false;
                        return (
                          <button
                            key={horizon}
                            type="button"
                            onClick={() => toggleReviewHorizon(horizon)}
                            className={cn(
                              "cursor-pointer rounded-[10px] border px-3 py-2 text-sm transition-colors",
                              active
                                ? "border-[var(--app-border-strong)] bg-[var(--app-panel-soft)] text-[var(--app-text)]"
                                : "border-[var(--app-border-soft)] bg-[var(--app-surface)] text-[var(--app-text-muted)] hover:border-[var(--app-border-strong)]",
                            )}
                          >
                            {horizon}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </div>
              ) : (
                <div className="rounded-[12px] border border-[var(--app-border)] bg-[var(--app-panel-soft)] p-4 text-sm leading-6 text-[var(--app-text-muted)]">
                  普通使用只需要选上面的风格卡。只有在你明确知道自己要调整哪些阈值时，再展开高级设置。
                </div>
              )}

              {presetFormError ? (
                <InlineNotice tone="danger" description={presetFormError} />
              ) : null}

              <div className="flex justify-between gap-2">
                <button
                  type="button"
                  onClick={() => setActiveTabId("portfolio")}
                  className="app-button"
                >
                  返回组合盘点
                </button>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => void handleSavePreset()}
                    className="app-button app-button-primary"
                    disabled={saveTimingPresetMutation.isPending}
                  >
                    {saveTimingPresetMutation.isPending
                      ? "保存中..."
                      : "保存并设为当前策略"}
                  </button>
                  <button
                    type="button"
                    onClick={() => setActiveTabId("results")}
                    className="app-button app-button-success"
                  >
                    查看建议
                  </button>
                </div>
              </div>
            </div>
          </Panel>
        </div>
      ) : null}

      {activeTabId === "results" ? (
        <Panel title="本轮执行摘要">
          <div className="grid gap-4">
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
              <SummaryMetric
                label="信号来源"
                value={
                  sourceMode === "single"
                    ? (singleStock?.stockName ?? "未选择股票")
                    : (selectedWatchList?.name ?? "未选择自选股列表")
                }
                hint={
                  sourceMode === "single"
                    ? singleStock?.stockCode
                    : selectedWatchList
                      ? `${selectedWatchList.stockCount} 只股票`
                      : "先回到步骤 1 选择"
                }
              />
              <SummaryMetric
                label="组合快照"
                value={selectedSnapshot?.name ?? "未保存组合快照"}
                hint={
                  selectedSnapshot
                    ? `现金 ${selectedSnapshot.cash.toFixed(0)} ${selectedSnapshot.baseCurrency}`
                    : "先回到步骤 2 保存"
                }
              />
              <SummaryMetric
                label="策略风格"
                value={
                  strategyStyleCards.find((item) => item.key === activeStyle)
                    ?.title ?? "均衡"
                }
                hint={selectedPreset?.name ?? "内置默认策略"}
              />
              <SummaryMetric
                label="最新市场状态"
                value={
                  latestRecommendations[0]?.marketState
                    ? (marketRegimeLabelMap[
                        latestRecommendations[0].marketState
                      ] ?? latestRecommendations[0].marketState)
                    : "等待生成"
                }
                hint={
                  recommendationContext?.marketContext.summary ??
                  "生成后会在这里同步市场语境。"
                }
              />
            </div>

            {resultActionDisabledReason ? (
              <InlineNotice
                tone="warning"
                description={resultActionDisabledReason}
              />
            ) : null}
            {!resultActionErrorMessage && resultActionSuccessMessage ? (
              <InlineNotice
                tone="success"
                description={resultActionSuccessMessage}
              />
            ) : null}
            {resultActionErrorMessage ? (
              <InlineNotice
                tone="danger"
                description={resultActionErrorMessage}
              />
            ) : null}

            <div className="flex flex-wrap gap-2">
              {sourceMode === "single" ? (
                <button
                  type="button"
                  onClick={() => void handleStartSingle()}
                  className="app-button app-button-primary"
                  disabled={
                    startSingleMutation.isPending ||
                    Boolean(resultActionDisabledReason)
                  }
                >
                  {startSingleMutation.isPending ? "生成中..." : "生成单股信号"}
                </button>
              ) : (
                <>
                  <button
                    type="button"
                    onClick={() => void handleStartWatchlistCards()}
                    className="app-button"
                    disabled={
                      startWatchlistCardsMutation.isPending || !watchListId
                    }
                  >
                    {startWatchlistCardsMutation.isPending
                      ? "刷新中..."
                      : "仅刷新候选信号"}
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleStartWatchlistTiming()}
                    className="app-button app-button-primary"
                    disabled={
                      startWatchlistTimingMutation.isPending ||
                      Boolean(resultActionDisabledReason)
                    }
                  >
                    {startWatchlistTimingMutation.isPending
                      ? "生成中..."
                      : "生成组合建议"}
                  </button>
                </>
              )}
            </div>
          </div>
        </Panel>
      ) : null}

      {activeTabId === "results" && sourceMode === "single" ? (
        <Panel title="单股信号结果">
          {cardsQuery.isLoading ? (
            <EmptyState title="正在加载单股信号" />
          ) : !singleStock ? (
            <EmptyState
              title="还没有选择股票"
              description="先回到步骤 1 选中股票，再回来生成信号。"
            />
          ) : cards.length === 0 ? (
            <EmptyState
              title="还没有单股信号"
              description="点击上方“生成单股信号”后，这里会出现最新的择时卡片。"
            />
          ) : (
            <TimingSignalCardList cards={cards} />
          )}
        </Panel>
      ) : null}

      {activeTabId === "results" && sourceMode === "watchlist" ? (
        <>
          <div className="grid gap-6 xl:grid-cols-[1.08fr_0.92fr]">
            <Panel title="本轮建议摘要">
              {latestRecommendations.length === 0 ? (
                <EmptyState
                  title="还没有组合建议"
                  description="确认快照和策略都已保存后，点击上方按钮生成本轮建议。"
                />
              ) : (
                <div className="grid gap-3">
                  {latestRecommendations.slice(0, 3).map((recommendation) => (
                    <article
                      key={recommendation.id}
                      className="rounded-[12px] border border-[var(--app-border)] bg-[var(--app-panel-soft)] p-4"
                    >
                      <div className="flex flex-wrap items-center gap-2">
                        <StatusPill
                          label={
                            actionLabelMap[recommendation.action] ??
                            recommendation.action
                          }
                          tone={
                            actionToneMap[recommendation.action] ?? "neutral"
                          }
                        />
                        <StatusPill
                          label={`预算 ${formatPct(recommendation.riskBudgetPct)}`}
                          tone="warning"
                        />
                        <StatusPill
                          label={`区间 ${formatPct(recommendation.suggestedMinPct)} - ${formatPct(recommendation.suggestedMaxPct)}`}
                          tone="info"
                        />
                      </div>
                      <div className="mt-3 text-base font-medium text-[var(--app-text)]">
                        {recommendation.stockName} · {recommendation.stockCode}
                      </div>
                      <p className="mt-2 text-sm leading-6 text-[var(--app-text-muted)]">
                        {recommendation.reasoning.actionRationale}
                      </p>
                    </article>
                  ))}
                </div>
              )}
            </Panel>

            <Panel title="市场与风控约束">
              {latestRecommendations.length === 0 || !recommendationContext ? (
                <EmptyState
                  title="等待结果生成"
                  description="生成建议后，这里会展示市场状态、风险预算和动作限制。"
                />
              ) : (
                <div className="grid gap-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <StatusPill
                      label={
                        marketRegimeLabelMap[
                          latestRecommendations[0]?.marketState ?? "NEUTRAL"
                        ] ??
                        latestRecommendations[0]?.marketState ??
                        "NEUTRAL"
                      }
                      tone={
                        marketRegimeToneMap[
                          latestRecommendations[0]?.marketState ?? "NEUTRAL"
                        ]
                      }
                    />
                    <StatusPill
                      label={`本轮预算 ${formatPct(
                        recommendationContext.riskPlan.portfolioRiskBudgetPct,
                      )}`}
                      tone="warning"
                    />
                    <StatusPill
                      label={`单票上限 ${formatPct(
                        recommendationContext.riskPlan.maxSingleNamePct,
                      )}`}
                      tone="neutral"
                    />
                  </div>
                  <p className="text-sm leading-6 text-[var(--app-text-muted)]">
                    {recommendationContext.marketContext.summary}
                  </p>
                  <ul className="grid gap-2 text-sm leading-6 text-[var(--app-text-muted)]">
                    {(recommendationContext.riskPlan.notes.length > 0
                      ? recommendationContext.riskPlan.notes
                      : recommendationContext.marketContext.constraints
                    ).map((item) => (
                      <li key={item}>- {item}</li>
                    ))}
                  </ul>
                </div>
              )}
            </Panel>
          </div>

          <Panel title="重点动作">
            {latestRecommendations.length === 0 ? (
              <EmptyState title="暂无动作建议" />
            ) : (
              <div className="grid gap-4">
                {latestRecommendations.map((recommendation) => (
                  <article
                    key={recommendation.id}
                    className="rounded-[12px] border border-[var(--app-border)] bg-[var(--app-panel)] p-5"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-4">
                      <div>
                        <div className="flex flex-wrap items-center gap-2">
                          <h3 className="text-lg font-semibold text-[var(--app-text)]">
                            {recommendation.stockName}
                          </h3>
                          <span className="text-sm text-[var(--app-text-soft)]">
                            {recommendation.stockCode}
                          </span>
                          <StatusPill
                            label={
                              actionLabelMap[recommendation.action] ??
                              recommendation.action
                            }
                            tone={
                              actionToneMap[recommendation.action] ?? "neutral"
                            }
                          />
                        </div>
                        <p className="mt-3 text-sm leading-6 text-[var(--app-text-muted)]">
                          {recommendation.reasoning.actionRationale}
                        </p>
                      </div>
                      <div className="text-right text-xs text-[var(--app-text-soft)]">
                        <p>
                          预算上限 {formatPct(recommendation.riskBudgetPct)}
                        </p>
                        <p>写入时间 {formatDate(recommendation.createdAt)}</p>
                      </div>
                    </div>
                  </article>
                ))}
              </div>
            )}
          </Panel>

          <Panel
            title="复盘记录"
            actions={
              <button
                type="button"
                onClick={() =>
                  void startTimingReviewLoopMutation.mutateAsync({})
                }
                className="app-button app-button-success"
                disabled={startTimingReviewLoopMutation.isPending}
              >
                {startTimingReviewLoopMutation.isPending
                  ? "运行中..."
                  : "运行今日复盘"}
              </button>
            }
          >
            {reviewRecords.length === 0 ? (
              <EmptyState title="暂无复盘记录" />
            ) : (
              <div className="grid gap-4 md:grid-cols-2">
                {reviewRecords.map((record) => (
                  <article
                    key={record.id}
                    className="rounded-[12px] border border-[var(--app-border)] bg-[var(--app-panel)] p-5"
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <div className="flex flex-wrap items-center gap-2">
                          <h3 className="text-base font-semibold text-[var(--app-text)]">
                            {record.stockName}
                          </h3>
                          <span className="text-sm text-[var(--app-text-soft)]">
                            {record.stockCode}
                          </span>
                          <StatusPill
                            label={record.reviewHorizon}
                            tone="info"
                          />
                          <StatusPill
                            label={
                              record.completedAt
                                ? (reviewVerdictLabelMap[
                                    record.verdict ?? "MIXED"
                                  ] ??
                                  record.verdict ??
                                  "已完成")
                                : "待复查"
                            }
                            tone={
                              record.completedAt
                                ? (reviewVerdictToneMap[
                                    record.verdict ?? "MIXED"
                                  ] ?? "info")
                                : "warning"
                            }
                          />
                        </div>
                        <p className="mt-3 text-sm leading-6 text-[var(--app-text-muted)]">
                          {record.reviewSummary ??
                            `计划于 ${formatDate(record.scheduledAt)} 复查，基准信号日 ${record.sourceAsOfDate}。`}
                        </p>
                      </div>
                    </div>
                  </article>
                ))}
              </div>
            )}
          </Panel>

          <Panel title="候选信号">
            {cardsQuery.isLoading ? (
              <EmptyState title="正在加载候选信号" />
            ) : cards.length === 0 ? (
              <EmptyState
                title="还没有候选信号"
                description="可以先点“仅刷新候选信号”，再决定是否直接生成组合建议。"
              />
            ) : (
              <TimingSignalCardList cards={cards} />
            )}
          </Panel>
        </>
      ) : null}
    </WorkspaceShell>
  );
}

function LabeledInput(props: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  error?: string;
  inputMode?: React.HTMLAttributes<HTMLInputElement>["inputMode"];
  required?: boolean;
}) {
  const { label, value, onChange, error, inputMode, required } = props;

  return (
    <label className="grid gap-2 text-sm text-[var(--app-text-muted)]">
      <span>
        {label}
        {required ? (
          <span className="ml-1 text-[var(--app-danger)]">*</span>
        ) : null}
      </span>
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        inputMode={inputMode}
        className={cn(
          "app-input",
          error ? "border-[var(--app-danger-border)]" : "",
        )}
      />
      {error ? (
        <span className="text-xs leading-5 text-[var(--app-danger)]">
          {error}
        </span>
      ) : null}
    </label>
  );
}

function NumericConfigInput(props: {
  label: string;
  value?: number;
  onChange: (value: string) => void;
}) {
  const { label, value, onChange } = props;

  return (
    <label className="grid gap-2 text-sm text-[var(--app-text-muted)]">
      <span>{label}</span>
      <input
        type="number"
        value={value ?? ""}
        onChange={(event) => onChange(event.target.value)}
        inputMode="decimal"
        className="app-input"
      />
    </label>
  );
}

function SummaryMetric(props: {
  label: string;
  value: React.ReactNode;
  hint?: React.ReactNode;
}) {
  const { label, value, hint } = props;

  return (
    <div className="rounded-[12px] border border-[var(--app-border)] bg-[var(--app-panel-soft)] p-4">
      <div className="text-xs text-[var(--app-text-soft)]">{label}</div>
      <div className="mt-2 text-lg font-medium text-[var(--app-text)]">
        {value}
      </div>
      {hint ? (
        <div className="mt-2 text-xs leading-5 text-[var(--app-text-subtle)]">
          {hint}
        </div>
      ) : null}
    </div>
  );
}

function PortfolioPositionEditor(props: {
  position: PortfolioPositionDraft;
  errors?: PortfolioFormErrors["rows"][string];
  onChange: (patch: Partial<PortfolioPositionDraft>) => void;
  onRemove: () => void;
}) {
  const { position, errors, onChange, onRemove } = props;

  return (
    <article className="rounded-[12px] border border-[var(--app-border)] bg-[var(--app-panel)] p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-base font-medium text-[var(--app-text)]">
            {position.stockName || "未命名持仓"}
          </div>
          <div className="mt-1 text-sm text-[var(--app-text-muted)]">
            {position.stockCode}
            {position.market ? ` · ${position.market}` : ""}
          </div>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => onChange({ advancedOpen: !position.advancedOpen })}
            className="app-button"
          >
            {position.advancedOpen ? "收起补充信息" : "补充信息"}
          </button>
          <button type="button" onClick={onRemove} className="app-button">
            删除
          </button>
        </div>
      </div>

      <div className="mt-4 grid gap-3 md:grid-cols-3">
        <LabeledInput
          label="数量"
          required
          value={position.quantity}
          onChange={(value) => onChange({ quantity: value })}
          inputMode="decimal"
          error={errors?.quantity}
        />
        <LabeledInput
          label="成本价"
          required
          value={position.costBasis}
          onChange={(value) => onChange({ costBasis: value })}
          inputMode="decimal"
          error={errors?.costBasis}
        />
        <LabeledInput
          label="当前仓位 (%)"
          required
          value={position.currentWeightPct}
          onChange={(value) => onChange({ currentWeightPct: value })}
          inputMode="decimal"
          error={errors?.currentWeightPct}
        />
      </div>

      {errors?.stockCode ? (
        <div className="mt-3 text-xs leading-5 text-[var(--app-danger)]">
          {errors.stockCode}
        </div>
      ) : null}

      {position.advancedOpen ? (
        <div className="mt-4 grid gap-3 md:grid-cols-2">
          <LabeledInput
            label="行业"
            value={position.sector}
            onChange={(value) => onChange({ sector: value })}
          />
          <LabeledInput
            label="主题"
            value={position.themes}
            onChange={(value) => onChange({ themes: value })}
          />
          <LabeledInput
            label="建仓日期"
            value={position.openedAt}
            onChange={(value) => onChange({ openedAt: value })}
            error={errors?.openedAt}
          />
          <LabeledInput
            label="最近加仓日期"
            value={position.lastAddedAt}
            onChange={(value) => onChange({ lastAddedAt: value })}
            error={errors?.lastAddedAt}
          />
          <LabeledInput
            label="失效价"
            value={position.invalidationPrice}
            onChange={(value) => onChange({ invalidationPrice: value })}
            inputMode="decimal"
            error={errors?.invalidationPrice}
          />
          <LabeledInput
            label="计划持有天数"
            value={position.plannedHoldingDays}
            onChange={(value) => onChange({ plannedHoldingDays: value })}
            inputMode="numeric"
            error={errors?.plannedHoldingDays}
          />
        </div>
      ) : null}
    </article>
  );
}
