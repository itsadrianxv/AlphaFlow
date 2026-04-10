"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import type React from "react";
import { useEffect, useMemo, useState } from "react";
import {
  EmptyState,
  Panel,
  StatusPill,
  WorkspaceShell,
} from "~/app/_components/ui";
import { WorkflowStageSwitcher } from "~/app/_components/workflow-stage-switcher";
import { buildWorkflowRunHistoryItems } from "~/app/_components/workspace-history";
import { timingStageTabs } from "~/app/timing/timing-stage-tabs";
import { timingTemplateCodes } from "~/app/workflows/workflow-shell-context";
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
  if (value === null || value === undefined) {
    return "-";
  }

  return `${value.toFixed(2)}%`;
}

type PortfolioPositionInput = {
  stockCode: string;
  stockName: string;
  quantity: number;
  costBasis: number;
  currentWeightPct: number;
  sector?: string;
  themes?: string[];
  openedAt?: string;
  lastAddedAt?: string;
  invalidationPrice?: number;
  plannedHoldingDays?: number;
};

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

const sourceLabelMap: Record<string, string> = {
  single: "单股",
  watchlist: "自选股",
  screening: "筛选联动",
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

const defaultPresetConfigJson = JSON.stringify(
  {
    contextWeights: {
      signalContext: 1,
      marketContext: 0.9,
      positionContext: 0.8,
      feedbackContext: 0.6,
    },
    signalEngineWeights: {
      multiTimeframeAlignment: 0.24,
      relativeStrength: 0.2,
      volatilityPercentile: 0.14,
      liquidityStructure: 0.14,
      breakoutFailure: 0.14,
      gapVolumeQuality: 0.14,
    },
    positionWeights: {
      invalidationRiskPenalty: 12,
      matureGainTrimBoost: 10,
      lossNearInvalidationPenalty: 14,
      earlyEntryBonus: 4,
    },
    feedbackPolicy: {
      lookbackDays: 180,
      minimumSamples: 12,
      weightStep: 0.15,
      actionThresholdStep: 3,
      successRateDeltaThreshold: 8,
      averageReturnDeltaThreshold: 2,
    },
    confidenceThresholds: {
      signalStrengthWeight: 0.55,
      alignmentWeight: 35,
      riskPenaltyPerFlag: 4,
      neutralPenalty: 8,
      minConfidence: 25,
      maxConfidence: 95,
    },
    actionThresholds: {
      addConfidence: 74,
      addSignalStrength: 68,
      probeConfidence: 56,
      probeSignalStrength: 52,
      holdConfidence: 60,
      trimConfidence: 68,
      exitConfidence: 82,
    },
    reviewSchedule: {
      horizons: ["T5", "T10", "T20"],
    },
  },
  null,
  2,
);

export function TimingClient() {
  const router = useRouter();
  const utils = api.useUtils();

  const [stockCode, setStockCode] = useState("");
  const [watchListId, setWatchListId] = useState("");
  const [selectedPortfolioId, setSelectedPortfolioId] = useState("");
  const [portfolioName, setPortfolioName] = useState("核心组合");
  const [baseCurrency, setBaseCurrency] = useState("CNY");
  const [cash, setCash] = useState("30000");
  const [totalCapital, setTotalCapital] = useState("100000");
  const [positionsJson, setPositionsJson] = useState("[]");
  const [maxSingleNamePct, setMaxSingleNamePct] = useState("12");
  const [maxThemeExposurePct, setMaxThemeExposurePct] = useState("28");
  const [defaultProbePct, setDefaultProbePct] = useState("3");
  const [maxPortfolioRiskBudgetPct, setMaxPortfolioRiskBudgetPct] =
    useState("20");
  const [portfolioFormError, setPortfolioFormError] = useState<string | null>(
    null,
  );
  const [filterStockCode, setFilterStockCode] = useState("");
  const [filterSourceType, setFilterSourceType] = useState<
    "all" | "single" | "watchlist" | "screening"
  >("all");
  const [selectedPresetId, setSelectedPresetId] = useState("");
  const [presetDraftId, setPresetDraftId] = useState("");
  const [presetName, setPresetName] = useState("稳健日频预设");
  const [presetDescription, setPresetDescription] = useState("");
  const [presetConfigJson, setPresetConfigJson] = useState(
    defaultPresetConfigJson,
  );
  const [presetFormError, setPresetFormError] = useState<string | null>(null);
  const [activeTabId, setActiveTabId] = useState(
    timingStageTabs[0]?.id ?? "signals",
  );

  const watchListsQuery = api.watchlist.list.useQuery({
    limit: 50,
    offset: 0,
    sortBy: "updatedAt",
    sortDirection: "desc",
  });
  const portfolioSnapshotsQuery = api.timing.listPortfolioSnapshots.useQuery();
  const cardsQuery = api.timing.listTimingCards.useQuery({
    limit: 24,
    stockCode: filterStockCode.trim() || undefined,
    sourceType: filterSourceType === "all" ? undefined : filterSourceType,
  });
  const recommendationsQuery = api.timing.listRecommendations.useQuery({
    limit: 48,
    watchListId: watchListId || undefined,
    portfolioSnapshotId: selectedPortfolioId || undefined,
  });
  const reviewRecordsQuery = api.timing.listReviewRecords.useQuery({
    limit: 36,
    completedOnly: false,
  });
  const presetsQuery = api.timing.listTimingPresets.useQuery();
  const runsQuery = api.workflow.listRuns.useQuery(
    {
      limit: 20,
      templateCodes: [...timingTemplateCodes],
    },
    {
      refetchOnWindowFocus: false,
    },
  );

  const startSingleMutation =
    api.workflow.startTimingSignalPipeline.useMutation({
      onSuccess: (result) => {
        router.push(`/workflows/${result.runId}`);
      },
    });
  const startWatchlistCardsMutation =
    api.workflow.startWatchlistTimingCardsPipeline.useMutation({
      onSuccess: (result) => {
        router.push(`/workflows/${result.runId}`);
      },
    });
  const startWatchlistTimingMutation =
    api.workflow.startWatchlistTimingPipeline.useMutation({
      onSuccess: (result) => {
        router.push(`/workflows/${result.runId}`);
      },
    });
  const startTimingReviewLoopMutation =
    api.workflow.startTimingReviewLoop.useMutation({
      onSuccess: (result) => {
        router.push(`/workflows/${result.runId}`);
      },
    });
  const createPortfolioSnapshotMutation =
    api.timing.createPortfolioSnapshot.useMutation({
      onSuccess: async (snapshot) => {
        setSelectedPortfolioId(snapshot.id);
        await Promise.all([
          utils.timing.listPortfolioSnapshots.invalidate(),
          utils.timing.listRecommendations.invalidate(),
        ]);
      },
    });
  const updatePortfolioSnapshotMutation =
    api.timing.updatePortfolioSnapshot.useMutation({
      onSuccess: async () => {
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
      setPresetFormError(null);
      await utils.timing.listTimingPresets.invalidate();
    },
  });

  useEffect(() => {
    if (!watchListId && watchListsQuery.data?.[0]?.id) {
      setWatchListId(watchListsQuery.data[0].id);
    }
  }, [watchListId, watchListsQuery.data]);

  useEffect(() => {
    if (!selectedPortfolioId && portfolioSnapshotsQuery.data?.[0]?.id) {
      setSelectedPortfolioId(portfolioSnapshotsQuery.data[0].id);
    }
  }, [portfolioSnapshotsQuery.data, selectedPortfolioId]);

  useEffect(() => {
    if (!selectedPresetId && presetsQuery.data?.[0]?.id) {
      setSelectedPresetId(presetsQuery.data[0].id);
    }
  }, [presetsQuery.data, selectedPresetId]);

  const cards = cardsQuery.data ?? [];
  const recommendations = recommendationsQuery.data ?? [];
  type RecommendationItem = NonNullable<
    typeof recommendationsQuery.data
  >[number];
  type PortfolioSnapshotItem = NonNullable<
    typeof portfolioSnapshotsQuery.data
  >[number];
  type ReviewRecordItem = NonNullable<typeof reviewRecordsQuery.data>[number];
  type PresetItem = NonNullable<typeof presetsQuery.data>[number];
  type CardItem = NonNullable<typeof cardsQuery.data>[number];
  type WatchListItem = NonNullable<typeof watchListsQuery.data>[number];
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
  const recommendationContext = latestRecommendations[0]?.reasoning;
  const reviewRecords = reviewRecordsQuery.data ?? [];
  const presets = presetsQuery.data ?? [];
  const historyItems = useMemo(
    () => buildWorkflowRunHistoryItems(runsQuery.data?.items ?? []),
    [runsQuery.data?.items],
  );

  useEffect(() => {
    if (!selectedSnapshot) {
      return;
    }

    setPortfolioName(selectedSnapshot.name);
    setBaseCurrency(selectedSnapshot.baseCurrency);
    setCash(String(selectedSnapshot.cash));
    setTotalCapital(String(selectedSnapshot.totalCapital));
    setPositionsJson(JSON.stringify(selectedSnapshot.positions, null, 2));
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
    setPortfolioFormError(null);
  }, [selectedSnapshot]);

  useEffect(() => {
    if (!presetDraftId) {
      return;
    }

    const preset = presets.find(
      (item: PresetItem) => item.id === presetDraftId,
    );
    if (!preset) {
      return;
    }

    setPresetName(preset.name);
    setPresetDescription(preset.description ?? "");
    setPresetConfigJson(JSON.stringify(preset.config, null, 2));
    setPresetFormError(null);
  }, [presetDraftId, presets]);

  const parsePortfolioPayload = () => {
    try {
      const positions = JSON.parse(positionsJson) as PortfolioPositionInput[];
      setPortfolioFormError(null);

      return {
        name: portfolioName.trim(),
        baseCurrency: baseCurrency.trim() || "CNY",
        cash: Number(cash),
        totalCapital: Number(totalCapital),
        positions,
        riskPreferences: {
          maxSingleNamePct: Number(maxSingleNamePct),
          maxThemeExposurePct: Number(maxThemeExposurePct),
          defaultProbePct: Number(defaultProbePct),
          maxPortfolioRiskBudgetPct: Number(maxPortfolioRiskBudgetPct),
        },
      };
    } catch {
      setPortfolioFormError("持仓 JSON 解析失败，请检查格式。");
      return null;
    }
  };

  const handleStartSingle = async () => {
    if (!/^\d{6}$/.test(stockCode.trim())) {
      return;
    }

    await startSingleMutation.mutateAsync({
      stockCode: stockCode.trim(),
      presetId: selectedPresetId || undefined,
    });
  };

  const handleStartWatchlistCards = async () => {
    if (!watchListId) {
      return;
    }

    await startWatchlistCardsMutation.mutateAsync({
      watchListId,
      presetId: selectedPresetId || undefined,
    });
  };

  const handleCreatePortfolioSnapshot = async () => {
    const payload = parsePortfolioPayload();
    if (!payload) {
      return;
    }

    await createPortfolioSnapshotMutation.mutateAsync(payload);
  };

  const handleUpdatePortfolioSnapshot = async () => {
    if (!selectedPortfolioId) {
      return;
    }

    const payload = parsePortfolioPayload();
    if (!payload) {
      return;
    }

    await updatePortfolioSnapshotMutation.mutateAsync({
      id: selectedPortfolioId,
      ...payload,
    });
  };

  const handleStartWatchlistTiming = async () => {
    if (!watchListId || !selectedPortfolioId) {
      return;
    }

    await startWatchlistTimingMutation.mutateAsync({
      watchListId,
      portfolioSnapshotId: selectedPortfolioId,
      presetId: selectedPresetId || undefined,
    });
  };

  const handleStartTimingReviewLoop = async () => {
    await startTimingReviewLoopMutation.mutateAsync({});
  };

  const handleSavePreset = async () => {
    try {
      const config = JSON.parse(presetConfigJson) as Record<string, unknown>;
      setPresetFormError(null);

      await saveTimingPresetMutation.mutateAsync({
        id: presetDraftId || undefined,
        name: presetName.trim(),
        description: presetDescription.trim() || undefined,
        config,
      });
    } catch {
      setPresetFormError("预设配置 JSON 解析失败，请检查格式。");
    }
  };

  const stagePanelSummary = {
    signals: (
      <Panel title="信号来源">
        <div className="text-sm leading-6 text-[var(--app-text-muted)]">
          先决定是单股、自选股还是筛选联动。当前信号卡 {cards.length} 条。
        </div>
      </Panel>
    ),
    portfolio: (
      <Panel title="组合约束">
        <div className="text-sm leading-6 text-[var(--app-text-muted)]">
          当前组合快照 {portfolioSnapshotsQuery.data?.length ?? 0} 份，选中{" "}
          {selectedSnapshot?.name ?? "未选择"}。
        </div>
      </Panel>
    ),
    preset: (
      <Panel title="预设策略">
        <div className="text-sm leading-6 text-[var(--app-text-muted)]">
          当前预设 {presets.length} 个，选中 {selectedPresetId || "默认预设"}。
        </div>
      </Panel>
    ),
    recommendations: (
      <Panel title="组合建议">
        <div className="text-sm leading-6 text-[var(--app-text-muted)]">
          当前最新建议 {latestRecommendations.length}{" "}
          条，建议先看风险预算，再看动作区间。
        </div>
      </Panel>
    ),
    reviews: (
      <Panel title="复盘记录">
        <div className="text-sm leading-6 text-[var(--app-text-muted)]">
          当前复盘记录 {reviewRecords.length} 条，用于回看执行后表现。
        </div>
      </Panel>
    ),
  } satisfies Record<string, React.ReactNode>;
  const stagePanels = {
    signals: stagePanelSummary.signals && null,
    portfolio: stagePanelSummary.portfolio && null,
    preset: stagePanelSummary.preset && null,
    recommendations: stagePanelSummary.recommendations && null,
    reviews: stagePanelSummary.reviews && null,
  } satisfies Record<string, React.ReactNode>;

  return (
    <WorkspaceShell
      section="timing"
      historyItems={historyItems}
      historyHref="/timing/history"
      historyLoading={runsQuery.isLoading}
      historyEmptyText="还没有择时记录"
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
        panels={stagePanels}
      />

      <div
        className={
          activeTabId === "recommendations"
            ? "grid gap-6 xl:grid-cols-[1.08fr_0.92fr]"
            : "hidden"
        }
      >
        <Panel
          title="最新建议"
          actions={
            <button
              type="button"
              onClick={() => void recommendationsQuery.refetch()}
              className="app-button"
            >
              刷新建议
            </button>
          }
        >
          {latestRecommendations.length === 0 ? (
            <EmptyState title="还没有新的组合建议" />
          ) : (
            <div className="grid gap-3">
              {latestRecommendations
                .slice(0, 3)
                .map((recommendation: RecommendationItem) => (
                  <article
                    key={recommendation.id}
                    className="rounded-[14px] border border-[var(--app-border)] bg-[var(--app-panel)] p-4"
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <StatusPill
                        label={
                          actionLabelMap[recommendation.action] ??
                          recommendation.action
                        }
                        tone={actionToneMap[recommendation.action] ?? "neutral"}
                      />
                      <StatusPill
                        label={`优先级 ${recommendation.priority}`}
                        tone="warning"
                      />
                      <StatusPill
                        label={`预算 ${formatPct(recommendation.riskBudgetPct)}`}
                        tone="neutral"
                      />
                    </div>
                    <p className="mt-3 text-base font-medium text-[var(--app-text)]">
                      {recommendation.stockName} · {recommendation.stockCode}
                    </p>
                    <p className="mt-2 text-sm leading-6 text-[var(--app-text-muted)]">
                      {recommendation.reasoning.actionRationale}
                    </p>
                  </article>
                ))}
            </div>
          )}
        </Panel>

        <Panel title="风险预算 / 组合语境">
          <div className="grid gap-3">
            {latestRecommendations.length > 0 && recommendationContext ? (
              <article className="rounded-[14px] border border-[var(--app-border)] bg-[var(--app-panel)] p-4">
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
                    label={`预算 ${formatPct(latestRecommendations[0]?.riskBudgetPct)}`}
                    tone="warning"
                  />
                  <StatusPill
                    label={`单票上限 ${formatPct(recommendationContext.riskPlan.maxSingleNamePct)}`}
                    tone="neutral"
                  />
                </div>
                <p className="mt-3 text-sm leading-6 text-[var(--app-text-muted)]">
                  {recommendationContext.marketContext.summary}
                </p>
              </article>
            ) : (
              <EmptyState title="还没有可用的预算语境" />
            )}

            {selectedSnapshot ? (
              <article className="rounded-[14px] border border-[var(--app-border)] bg-[var(--app-panel)] p-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="text-base font-medium text-[var(--app-text)]">
                      {selectedSnapshot.name}
                    </p>
                    <p className="mt-1 text-sm text-[var(--app-text-muted)]">
                      现金 {selectedSnapshot.cash.toFixed(2)}{" "}
                      {selectedSnapshot.baseCurrency} · 总资金{" "}
                      {selectedSnapshot.totalCapital.toFixed(2)}{" "}
                      {selectedSnapshot.baseCurrency}
                    </p>
                  </div>
                  <StatusPill
                    label={`预算上限 ${formatPct(selectedSnapshot.riskPreferences.maxPortfolioRiskBudgetPct)}`}
                    tone="info"
                  />
                </div>
              </article>
            ) : null}
          </div>
        </Panel>
      </div>

      <div
        className={
          activeTabId === "signals"
            ? "grid gap-6 xl:grid-cols-[1fr_1fr]"
            : "hidden"
        }
      >
        <Panel title="单股信号">
          <div className="grid gap-4">
            <label className="grid gap-2 text-sm text-[var(--app-text-muted)]">
              股票代码
              <input
                value={stockCode}
                onChange={(event) =>
                  setStockCode(
                    event.target.value.replace(/\D/g, "").slice(0, 6),
                  )
                }
                placeholder="例如 600519"
                className="rounded-[10px] border border-[var(--app-border)] bg-[var(--app-panel-strong)] px-3 py-2 text-sm text-[var(--app-text)] outline-none transition-colors focus:border-[var(--app-border-strong)]"
              />
            </label>
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => void handleStartSingle()}
                className="app-button app-button-primary"
                disabled={
                  startSingleMutation.isPending || stockCode.length !== 6
                }
              >
                {startSingleMutation.isPending ? "启动中..." : "生成单股信号"}
              </button>
              <span className="text-xs text-[var(--app-text-soft)]">
                生成后可继续查看建议。
              </span>
            </div>
          </div>
        </Panel>

        <Panel title="批量信号">
          <div className="grid gap-4">
            <label className="grid gap-2 text-sm text-[var(--app-text-muted)]">
              自选清单
              <select
                value={watchListId}
                onChange={(event) => setWatchListId(event.target.value)}
                className="rounded-[10px] border border-[var(--app-border)] bg-[var(--app-panel-strong)] px-3 py-2 text-sm text-[var(--app-text)] outline-none transition-colors focus:border-[var(--app-border-strong)]"
              >
                {watchListsQuery.data?.map((watchList) => (
                  <option key={watchList.id} value={watchList.id}>
                    {watchList.name} · {watchList.stockCount} 只
                  </option>
                ))}
              </select>
            </label>
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => void handleStartWatchlistCards()}
                className="app-button"
                disabled={startWatchlistCardsMutation.isPending || !watchListId}
              >
                {startWatchlistCardsMutation.isPending
                  ? "启动中..."
                  : "生成批量信号"}
              </button>
              <span className="text-xs text-[var(--app-text-soft)]">
                批量刷新当前清单。
              </span>
            </div>
          </div>
        </Panel>
      </div>

      <Panel
        title="信号参数与复盘设定"
        className={activeTabId === "preset" ? undefined : "hidden"}
        actions={
          <button
            type="button"
            onClick={() => void handleStartTimingReviewLoop()}
            className="app-button app-button-success"
            disabled={startTimingReviewLoopMutation.isPending}
          >
            {startTimingReviewLoopMutation.isPending
              ? "启动中..."
              : "运行今日复盘"}
          </button>
        }
      >
        <div className="grid gap-6 xl:grid-cols-[0.9fr_1.1fr]">
          <div className="grid gap-4 rounded-[12px] border border-[var(--app-border)] bg-[var(--app-panel-soft)] p-4">
            <div className="flex flex-wrap items-center gap-2">
              <StatusPill
                label={
                  selectedPresetId ? "已绑定自定义参数" : "使用内置默认参数"
                }
                tone={selectedPresetId ? "success" : "info"}
              />
              <StatusPill
                label={`${reviewRecords.filter((item: ReviewRecordItem) => !item.completedAt).length} 条待复查`}
                tone="warning"
              />
            </div>
            <label className="grid gap-2 text-sm text-[var(--app-text-muted)]">
              当前使用的参数预设
              <select
                value={selectedPresetId}
                onChange={(event) => setSelectedPresetId(event.target.value)}
                className="rounded-[10px] border border-[var(--app-border)] bg-[var(--app-panel-strong)] px-3 py-2 text-sm text-[var(--app-text)] outline-none transition-colors focus:border-[var(--app-border-strong)]"
              >
                <option value="">内置默认参数</option>
                {presets.map((preset: PresetItem) => (
                  <option key={preset.id} value={preset.id}>
                    {preset.name}
                  </option>
                ))}
              </select>
            </label>
            <div className="text-xs leading-6 text-[var(--app-text-soft)]">
              影响后续信号与复盘。
            </div>
            <div className="grid gap-2">
              {presets.length === 0 ? (
                <EmptyState title="还没有自定义参数预设" />
              ) : (
                presets.map((preset: PresetItem) => (
                  <button
                    key={preset.id}
                    type="button"
                    onClick={() => setPresetDraftId(preset.id)}
                    className="flex items-center justify-between rounded-[10px] border border-[var(--app-border)] bg-[var(--app-code-bg)] px-4 py-3 text-left text-sm text-[var(--app-text)] transition-colors hover:border-[var(--app-border-strong)]"
                  >
                    <span>{preset.name}</span>
                    <span className="text-xs text-[var(--app-text-soft)]">
                      {formatDate(preset.updatedAt)}
                    </span>
                  </button>
                ))
              )}
            </div>
          </div>

          <div className="grid gap-4 rounded-[12px] border border-[var(--app-border)] bg-[var(--app-panel-soft)] p-4">
            <div className="grid gap-4 md:grid-cols-[220px_1fr]">
              <label className="grid gap-2 text-sm text-[var(--app-text-muted)]">
                编辑已有参数预设
                <select
                  value={presetDraftId}
                  onChange={(event) => setPresetDraftId(event.target.value)}
                  className="rounded-[10px] border border-[var(--app-border)] bg-[var(--app-panel-strong)] px-3 py-2 text-sm text-[var(--app-text)] outline-none transition-colors focus:border-[var(--app-border-strong)]"
                >
                  <option value="">新建参数预设</option>
                  {presets.map((preset: PresetItem) => (
                    <option key={preset.id} value={preset.id}>
                      {preset.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="grid gap-2 text-sm text-[var(--app-text-muted)]">
                预设名称
                <input
                  value={presetName}
                  onChange={(event) => setPresetName(event.target.value)}
                  className="rounded-[10px] border border-[var(--app-border)] bg-[var(--app-panel-strong)] px-3 py-2 text-sm text-[var(--app-text)] outline-none transition-colors focus:border-[var(--app-border-strong)]"
                />
              </label>
            </div>
            <label className="grid gap-2 text-sm text-[var(--app-text-muted)]">
              说明
              <input
                value={presetDescription}
                onChange={(event) => setPresetDescription(event.target.value)}
                className="rounded-[10px] border border-[var(--app-border)] bg-[var(--app-panel-strong)] px-3 py-2 text-sm text-[var(--app-text)] outline-none transition-colors focus:border-[var(--app-border-strong)]"
              />
            </label>
            <label className="grid gap-2 text-sm text-[var(--app-text-muted)]">
              配置 JSON
              <textarea
                value={presetConfigJson}
                onChange={(event) => setPresetConfigJson(event.target.value)}
                rows={14}
                className="rounded-[12px] border border-[var(--app-border)] bg-[var(--app-code-bg)] px-4 py-3 font-mono text-xs leading-6 text-[var(--app-text)] outline-none transition-colors focus:border-[var(--app-border-strong)]"
              />
            </label>
            {presetFormError ? (
              <div className="rounded-[10px] border border-[var(--app-danger-border)] bg-[var(--app-danger-surface)] px-4 py-3 text-sm text-[var(--app-danger)]">
                {presetFormError}
              </div>
            ) : null}
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => void handleSavePreset()}
                className="app-button app-button-primary"
                disabled={
                  saveTimingPresetMutation.isPending || !presetName.trim()
                }
              >
                {saveTimingPresetMutation.isPending
                  ? "保存中..."
                  : "保存参数预设"}
              </button>
              <span className="text-xs text-[var(--app-text-soft)]">
                仅影响权重、阈值和复查周期。
              </span>
            </div>
          </div>
        </div>
      </Panel>

      <div
        className={
          activeTabId === "portfolio"
            ? "grid gap-6 xl:grid-cols-[1.08fr_0.92fr]"
            : "hidden"
        }
      >
        <Panel
          title="组合快照"
          actions={
            <>
              <button
                type="button"
                className="app-button"
                onClick={() => void handleCreatePortfolioSnapshot()}
                disabled={createPortfolioSnapshotMutation.isPending}
              >
                {createPortfolioSnapshotMutation.isPending
                  ? "保存中..."
                  : "新建快照"}
              </button>
              <button
                type="button"
                className="app-button app-button-success"
                onClick={() => void handleUpdatePortfolioSnapshot()}
                disabled={
                  updatePortfolioSnapshotMutation.isPending ||
                  !selectedPortfolioId
                }
              >
                {updatePortfolioSnapshotMutation.isPending
                  ? "更新中..."
                  : "更新当前快照"}
              </button>
            </>
          }
        >
          <div className="grid gap-4">
            <div className="grid gap-4 md:grid-cols-[220px_1fr_1fr]">
              <label className="grid gap-2 text-sm text-[var(--app-text-muted)]">
                选择快照
                <select
                  value={selectedPortfolioId}
                  onChange={(event) =>
                    setSelectedPortfolioId(event.target.value)
                  }
                  className="rounded-[10px] border border-[var(--app-border)] bg-[var(--app-panel-strong)] px-3 py-2 text-sm text-[var(--app-text)] outline-none transition-colors focus:border-[var(--app-border-strong)]"
                >
                  <option value="">新建一个快照</option>
                  {portfolioSnapshotsQuery.data?.map(
                    (snapshot: PortfolioSnapshotItem) => (
                      <option key={snapshot.id} value={snapshot.id}>
                        {snapshot.name}
                      </option>
                    ),
                  )}
                </select>
              </label>
              <label className="grid gap-2 text-sm text-[var(--app-text-muted)]">
                快照名称
                <input
                  value={portfolioName}
                  onChange={(event) => setPortfolioName(event.target.value)}
                  className="rounded-[10px] border border-[var(--app-border)] bg-[var(--app-panel-strong)] px-3 py-2 text-sm text-[var(--app-text)] outline-none transition-colors focus:border-[var(--app-border-strong)]"
                />
              </label>
              <label className="grid gap-2 text-sm text-[var(--app-text-muted)]">
                计价货币
                <input
                  value={baseCurrency}
                  onChange={(event) => setBaseCurrency(event.target.value)}
                  className="rounded-[10px] border border-[var(--app-border)] bg-[var(--app-panel-strong)] px-3 py-2 text-sm text-[var(--app-text)] outline-none transition-colors focus:border-[var(--app-border-strong)]"
                />
              </label>
            </div>

            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
              <label className="grid gap-2 text-sm text-[var(--app-text-muted)]">
                现金
                <input
                  value={cash}
                  onChange={(event) => setCash(event.target.value)}
                  inputMode="decimal"
                  className="rounded-[10px] border border-[var(--app-border)] bg-[var(--app-panel-strong)] px-3 py-2 text-sm text-[var(--app-text)] outline-none transition-colors focus:border-[var(--app-border-strong)]"
                />
              </label>
              <label className="grid gap-2 text-sm text-[var(--app-text-muted)]">
                总资本
                <input
                  value={totalCapital}
                  onChange={(event) => setTotalCapital(event.target.value)}
                  inputMode="decimal"
                  className="rounded-[10px] border border-[var(--app-border)] bg-[var(--app-panel-strong)] px-3 py-2 text-sm text-[var(--app-text)] outline-none transition-colors focus:border-[var(--app-border-strong)]"
                />
              </label>
              <label className="grid gap-2 text-sm text-[var(--app-text-muted)]">
                最大单票
                <input
                  value={maxSingleNamePct}
                  onChange={(event) => setMaxSingleNamePct(event.target.value)}
                  inputMode="decimal"
                  className="rounded-[10px] border border-[var(--app-border)] bg-[var(--app-panel-strong)] px-3 py-2 text-sm text-[var(--app-text)] outline-none transition-colors focus:border-[var(--app-border-strong)]"
                />
              </label>
              <label className="grid gap-2 text-sm text-[var(--app-text-muted)]">
                风险预算上限
                <input
                  value={maxPortfolioRiskBudgetPct}
                  onChange={(event) =>
                    setMaxPortfolioRiskBudgetPct(event.target.value)
                  }
                  inputMode="decimal"
                  className="rounded-[10px] border border-[var(--app-border)] bg-[var(--app-panel-strong)] px-3 py-2 text-sm text-[var(--app-text)] outline-none transition-colors focus:border-[var(--app-border-strong)]"
                />
              </label>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <label className="grid gap-2 text-sm text-[var(--app-text-muted)]">
                最大主题暴露
                <input
                  value={maxThemeExposurePct}
                  onChange={(event) =>
                    setMaxThemeExposurePct(event.target.value)
                  }
                  inputMode="decimal"
                  className="rounded-[10px] border border-[var(--app-border)] bg-[var(--app-panel-strong)] px-3 py-2 text-sm text-[var(--app-text)] outline-none transition-colors focus:border-[var(--app-border-strong)]"
                />
              </label>
              <label className="grid gap-2 text-sm text-[var(--app-text-muted)]">
                默认试仓比例
                <input
                  value={defaultProbePct}
                  onChange={(event) => setDefaultProbePct(event.target.value)}
                  inputMode="decimal"
                  className="rounded-[10px] border border-[var(--app-border)] bg-[var(--app-panel-strong)] px-3 py-2 text-sm text-[var(--app-text)] outline-none transition-colors focus:border-[var(--app-border-strong)]"
                />
              </label>
            </div>

            <label className="grid gap-2 text-sm text-[var(--app-text-muted)]">
              持仓 JSON
              <textarea
                value={positionsJson}
                onChange={(event) => setPositionsJson(event.target.value)}
                rows={12}
                className="rounded-[12px] border border-[var(--app-border)] bg-[var(--app-code-bg)] px-4 py-3 font-mono text-xs leading-6 text-[var(--app-text)] outline-none transition-colors focus:border-[var(--app-border-strong)]"
              />
            </label>

            {portfolioFormError ? (
              <div className="rounded-[10px] border border-[var(--app-danger-border)] bg-[var(--app-danger-surface)] px-4 py-3 text-sm text-[var(--app-danger)]">
                {portfolioFormError}
              </div>
            ) : null}
          </div>
        </Panel>

        <Panel
          title="组合语境解读"
          actions={
            <button
              type="button"
              onClick={() => void handleStartWatchlistTiming()}
              className="app-button app-button-primary"
              disabled={
                startWatchlistTimingMutation.isPending ||
                !watchListId ||
                !selectedPortfolioId
              }
            >
              {startWatchlistTimingMutation.isPending
                ? "生成中..."
                : "生成组合建议"}
            </button>
          }
        >
          <div className="grid gap-4">
            <div className="grid gap-3 rounded-[12px] border border-[var(--app-border)] bg-[var(--app-panel-soft)] p-4">
              <div className="flex flex-wrap items-center gap-2">
                <StatusPill
                  label={
                    watchListsQuery.data?.find(
                      (item: WatchListItem) => item.id === watchListId,
                    )?.name ?? "未选择自选清单"
                  }
                  tone="info"
                />
                <StatusPill
                  label={selectedSnapshot?.name ?? "未选择组合快照"}
                  tone="neutral"
                />
                <StatusPill label="组合建议流程" tone="success" />
              </div>
              <p className="text-sm leading-6 text-[var(--app-text-muted)]">
                组合建议受仓位与风险预算约束。
              </p>
            </div>

            {latestRecommendations.length > 0 && recommendationContext ? (
              <div className="grid gap-3 rounded-[12px] border border-[var(--app-border)] bg-[var(--app-panel-soft)] p-4">
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
                    label={`预算 ${formatPct(latestRecommendations[0]?.riskBudgetPct)}`}
                    tone="warning"
                  />
                  <StatusPill
                    label={`单票上限 ${formatPct(recommendationContext.riskPlan.maxSingleNamePct)}`}
                    tone="neutral"
                  />
                </div>
                <p className="text-sm leading-6 text-[var(--app-text-muted)]">
                  {recommendationContext.marketContext.summary}
                </p>
              </div>
            ) : (
              <EmptyState title="还没有组合建议结果" />
            )}
          </div>
        </Panel>
      </div>

      <Panel
        title="建议明细"
        className={activeTabId === "recommendations" ? undefined : "hidden"}
        actions={
          <button
            type="button"
            onClick={() => void recommendationsQuery.refetch()}
            className="app-button"
          >
            刷新建议
          </button>
        }
      >
        {latestRecommendations.length === 0 ? (
          <EmptyState title="暂无组合建议" />
        ) : (
          <div className="grid gap-4">
            {latestRecommendations.map((recommendation: RecommendationItem) => (
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
                        tone={actionToneMap[recommendation.action] ?? "neutral"}
                      />
                      <StatusPill
                        label={`优先级 ${recommendation.priority}`}
                        tone="info"
                      />
                    </div>
                    <p className="mt-3 max-w-4xl text-sm leading-6 text-[var(--app-text-muted)]">
                      {recommendation.reasoning.actionRationale}
                    </p>
                  </div>
                  <div className="text-right text-xs text-[var(--app-text-soft)]">
                    <p>写入时间 {formatDate(recommendation.createdAt)}</p>
                    <p>预算上限 {formatPct(recommendation.riskBudgetPct)}</p>
                    {recommendation.workflowRunId ? (
                      <Link
                        href={`/workflows/${recommendation.workflowRunId}`}
                        className="mt-2 inline-flex text-[var(--app-accent-strong)] hover:text-[var(--app-text)]"
                      >
                        查看研究详情
                      </Link>
                    ) : null}
                  </div>
                </div>

                <div className="mt-4 grid gap-3 md:grid-cols-4">
                  <div className="rounded-[10px] border border-[var(--app-border)] bg-[var(--app-panel-soft)] px-4 py-3">
                    <div className="text-xs text-[var(--app-text-soft)]">
                      建议区间
                    </div>
                    <div className="mt-2 text-xl text-[var(--app-text)]">
                      {formatPct(recommendation.suggestedMinPct)} -{" "}
                      {formatPct(recommendation.suggestedMaxPct)}
                    </div>
                  </div>
                  <div className="rounded-[10px] border border-[var(--app-border)] bg-[var(--app-panel-soft)] px-4 py-3">
                    <div className="text-xs text-[var(--app-text-soft)]">
                      置信度
                    </div>
                    <div className="mt-2 text-xl text-[var(--app-text)]">
                      {recommendation.confidence}
                    </div>
                  </div>
                  <div className="rounded-[10px] border border-[var(--app-border)] bg-[var(--app-panel-soft)] px-4 py-3">
                    <div className="text-xs text-[var(--app-text-soft)]">
                      当前持仓
                    </div>
                    <div className="mt-2 text-xl text-[var(--app-text)]">
                      {formatPct(
                        recommendation.reasoning.positionContext
                          .currentWeightPct,
                      )}
                    </div>
                  </div>
                  <div className="rounded-[10px] border border-[var(--app-border)] bg-[var(--app-panel-soft)] px-4 py-3">
                    <div className="text-xs text-[var(--app-text-soft)]">
                      目标增量
                    </div>
                    <div className="mt-2 text-xl text-[var(--app-text)]">
                      {formatPct(
                        recommendation.reasoning.positionContext.targetDeltaPct,
                      )}
                    </div>
                  </div>
                </div>

                <div className="mt-4 grid gap-4 xl:grid-cols-[1fr_1fr_0.9fr]">
                  <div>
                    <p className="text-sm font-medium text-[var(--app-text)]">
                      市场状态约束
                    </p>
                    <ul className="mt-2 grid gap-2 text-sm leading-6 text-[var(--app-text-muted)]">
                      {recommendation.reasoning.marketContext.constraints.map(
                        (item: string) => (
                          <li key={item}>- {item}</li>
                        ),
                      )}
                    </ul>
                  </div>
                  <div>
                    <p className="text-sm font-medium text-[var(--app-text)]">
                      触发与失效
                    </p>
                    <ul className="mt-2 grid gap-2 text-sm leading-6 text-[var(--app-text-muted)]">
                      {recommendation.reasoning.signalContext.triggerNotes.map(
                        (item: string) => (
                          <li key={item}>- {item}</li>
                        ),
                      )}
                      {recommendation.reasoning.signalContext.invalidationNotes.map(
                        (item: string) => (
                          <li key={item}>× {item}</li>
                        ),
                      )}
                    </ul>
                  </div>
                  <div>
                    <p className="text-sm font-medium text-[var(--app-text)]">
                      风险标签
                    </p>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {recommendation.riskFlags.length === 0 ? (
                        <span className="text-sm text-[var(--app-text-soft)]">
                          暂无
                        </span>
                      ) : (
                        recommendation.riskFlags.map((flag: string) => (
                          <StatusPill key={flag} label={flag} tone="warning" />
                        ))
                      )}
                    </div>
                  </div>
                </div>
              </article>
            ))}
          </div>
        )}
      </Panel>

      <Panel
        title="复盘记录"
        className={activeTabId === "reviews" ? undefined : "hidden"}
        actions={
          <button
            type="button"
            onClick={() => void reviewRecordsQuery.refetch()}
            className="app-button"
          >
            刷新复查
          </button>
        }
      >
        {reviewRecords.length === 0 ? (
          <EmptyState title="暂无复盘记录" />
        ) : (
          <div className="grid gap-4 md:grid-cols-2">
            {reviewRecords.map((record: ReviewRecordItem) => (
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
                      <StatusPill label={record.reviewHorizon} tone="info" />
                      <StatusPill
                        label={
                          actionLabelMap[record.expectedAction] ??
                          record.expectedAction
                        }
                        tone={actionToneMap[record.expectedAction] ?? "neutral"}
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
                  <div className="text-right text-xs text-[var(--app-text-soft)]">
                    <p>计划复查 {formatDate(record.scheduledAt)}</p>
                    <p>完成时间 {formatDate(record.completedAt)}</p>
                  </div>
                </div>

                <div className="mt-4 grid gap-3 sm:grid-cols-3">
                  <div className="rounded-[10px] border border-[var(--app-border)] bg-[var(--app-panel-soft)] px-4 py-3">
                    <div className="text-xs text-[var(--app-text-soft)]">
                      区间收益
                    </div>
                    <div className="mt-2 text-xl text-[var(--app-text)]">
                      {formatPct(record.actualReturnPct)}
                    </div>
                  </div>
                  <div className="rounded-[10px] border border-[var(--app-border)] bg-[var(--app-panel-soft)] px-4 py-3">
                    <div className="text-xs text-[var(--app-text-soft)]">
                      最大顺行
                    </div>
                    <div className="mt-2 text-xl text-[var(--app-text)]">
                      {formatPct(record.maxFavorableExcursionPct)}
                    </div>
                  </div>
                  <div className="rounded-[10px] border border-[var(--app-border)] bg-[var(--app-panel-soft)] px-4 py-3">
                    <div className="text-xs text-[var(--app-text-soft)]">
                      最大逆行
                    </div>
                    <div className="mt-2 text-xl text-[var(--app-text)]">
                      {formatPct(record.maxAdverseExcursionPct)}
                    </div>
                  </div>
                </div>
              </article>
            ))}
          </div>
        )}
      </Panel>

      <Panel
        title="信号库"
        className={activeTabId === "signals" ? undefined : "hidden"}
        actions={
          <button
            type="button"
            onClick={() => void cardsQuery.refetch()}
            className="app-button"
          >
            刷新卡片
          </button>
        }
      >
        <div className="mb-5 grid gap-3 md:grid-cols-[180px_180px_auto]">
          <input
            value={filterStockCode}
            onChange={(event) =>
              setFilterStockCode(
                event.target.value.replace(/\D/g, "").slice(0, 6),
              )
            }
            placeholder="按股票代码筛选"
            className="rounded-[10px] border border-[var(--app-border)] bg-[var(--app-panel-strong)] px-3 py-2 text-sm text-[var(--app-text)] outline-none transition-colors focus:border-[var(--app-border-strong)]"
          />
          <select
            value={filterSourceType}
            onChange={(event) =>
              setFilterSourceType(event.target.value as typeof filterSourceType)
            }
            className="rounded-[10px] border border-[var(--app-border)] bg-[var(--app-panel-strong)] px-3 py-2 text-sm text-[var(--app-text)] outline-none transition-colors focus:border-[var(--app-border-strong)]"
          >
            <option value="all">全部来源</option>
            <option value="single">单股</option>
            <option value="watchlist">自选股</option>
            <option value="screening">筛选联动</option>
          </select>
          <div className="text-xs leading-6 text-[var(--app-text-soft)]">
            基础信号不含持有 / 减仓 / 退出。
          </div>
        </div>

        {cardsQuery.isLoading ? (
          <EmptyState title="正在加载信号库" />
        ) : cards.length === 0 ? (
          <EmptyState title="还没有信号结果" />
        ) : (
          <div className="grid gap-4">
            {cards.map((card: CardItem) => {
              const indicators = card.signalSnapshot?.indicators;

              return (
                <article
                  key={card.id}
                  className="rounded-[12px] border border-[var(--app-border)] bg-[var(--app-panel)] p-5"
                >
                  <div className="flex flex-wrap items-start justify-between gap-4">
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="text-lg font-semibold text-[var(--app-text)]">
                          {card.stockName}
                        </h3>
                        <span className="text-sm text-[var(--app-text-soft)]">
                          {card.stockCode}
                        </span>
                        <StatusPill
                          label={
                            actionLabelMap[card.actionBias] ?? card.actionBias
                          }
                          tone={actionToneMap[card.actionBias] ?? "neutral"}
                        />
                        <StatusPill
                          label={
                            sourceLabelMap[card.sourceType] ?? card.sourceType
                          }
                          tone="info"
                        />
                      </div>
                      <p className="mt-3 max-w-4xl text-sm leading-6 text-[var(--app-text-muted)]">
                        {card.summary}
                      </p>
                    </div>
                    <div className="text-right text-xs text-[var(--app-text-soft)]">
                      <p>写入时间 {formatDate(card.createdAt)}</p>
                      <p>信号日期 {card.signalSnapshot?.asOfDate ?? "-"}</p>
                    </div>
                  </div>

                  <div className="mt-4 grid gap-3 md:grid-cols-4">
                    <div className="rounded-[10px] border border-[var(--app-border)] bg-[var(--app-panel-soft)] px-4 py-3">
                      <div className="text-xs text-[var(--app-text-soft)]">
                        置信度
                      </div>
                      <div className="mt-2 text-xl text-[var(--app-text)]">
                        {card.confidence}
                      </div>
                    </div>
                    <div className="rounded-[10px] border border-[var(--app-border)] bg-[var(--app-panel-soft)] px-4 py-3">
                      <div className="text-xs text-[var(--app-text-soft)]">
                        RSI
                      </div>
                      <div className="mt-2 text-xl text-[var(--app-text)]">
                        {indicators?.rsi.value.toFixed(1) ?? "-"}
                      </div>
                    </div>
                    <div className="rounded-[10px] border border-[var(--app-border)] bg-[var(--app-panel-soft)] px-4 py-3">
                      <div className="text-xs text-[var(--app-text-soft)]">
                        MACD 柱值
                      </div>
                      <div className="mt-2 text-xl text-[var(--app-text)]">
                        {indicators?.macd.histogram.toFixed(2) ?? "-"}
                      </div>
                    </div>
                    <div className="rounded-[10px] border border-[var(--app-border)] bg-[var(--app-panel-soft)] px-4 py-3">
                      <div className="text-xs text-[var(--app-text-soft)]">
                        量比 20D
                      </div>
                      <div className="mt-2 text-xl text-[var(--app-text)]">
                        {indicators?.volumeRatio20.toFixed(2) ?? "-"}
                      </div>
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </Panel>
    </WorkspaceShell>
  );
}
