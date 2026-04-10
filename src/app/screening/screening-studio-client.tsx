"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import type React from "react";
import { useDeferredValue, useEffect, useMemo, useState } from "react";
import {
  EmptyState,
  InlineNotice,
  SectionCard,
  StatusPill,
  WorkspaceShell,
} from "~/app/_components/ui";
import { WorkflowStageSwitcher } from "~/app/_components/workflow-stage-switcher";
import { screeningStageTabs } from "~/app/screening/screening-stage-tabs";
import {
  annualPresetOptions,
  buildCatalogNotice,
  buildMetricNameMap,
  buildResultColumns,
  buildVisibleResultRows,
  formatDateTime,
  getLatestMetricValue,
  groupCatalogItems,
  quarterlyPresetOptions,
} from "~/app/screening/screening-ui";
import type {
  WorkspaceFilterRule,
  WorkspaceResult,
  WorkspaceTimeConfig,
} from "~/contracts/screening";
import { api, type RouterOutputs } from "~/trpc/react";

type FormulaItem = RouterOutputs["screening"]["listFormulas"][number];
type WorkspaceSummary = RouterOutputs["screening"]["listWorkspaces"][number];
type WorkspaceDetail = RouterOutputs["screening"]["getWorkspace"];
type SelectedStock = {
  stockCode: string;
  stockName: string;
  market: string;
};
type FilterRuleDraft = WorkspaceFilterRule & { clientId: string };

type NoticeState = {
  tone: "info" | "success" | "error";
  text: string;
};

const defaultTimeConfig: WorkspaceTimeConfig = {
  periodType: "ANNUAL",
  rangeMode: "PRESET",
  presetKey: "3Y",
};

const defaultColumnState = {
  hiddenMetricIds: [] as string[],
  pinnedMetricIds: ["stockCode", "stockName"],
};

function emptyFilterRule(): FilterRuleDraft {
  return {
    clientId: crypto.randomUUID(),
    metricId: "",
    operator: ">=",
    value: "",
    valueType: "NUMBER",
    applyScope: "LATEST_DEFAULT",
  };
}

function toSelectedStocks(detail: WorkspaceDetail): SelectedStock[] {
  const latestRows = detail.state.resultSnapshot?.latestSnapshotRows ?? [];
  const latestMap = new Map(
    latestRows.map((row) => [row.stockCode, row.stockName] as const),
  );

  return detail.state.stockCodes.map((stockCode) => ({
    stockCode,
    stockName: latestMap.get(stockCode) ?? stockCode,
    market: "",
  }));
}

export function ScreeningStudioClient() {
  const searchParams = useSearchParams();
  const workspaceIdFromUrl = searchParams.get("workspaceId");
  const utils = api.useUtils();
  const [notice, setNotice] = useState<NoticeState | null>(null);
  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState<string | null>(
    workspaceIdFromUrl,
  );
  const [draftMode, setDraftMode] = useState(workspaceIdFromUrl === null);
  const [workspaceName, setWorkspaceName] = useState("");
  const [workspaceDescription, setWorkspaceDescription] = useState("");
  const [selectedStocks, setSelectedStocks] = useState<SelectedStock[]>([]);
  const [selectedIndicatorIds, setSelectedIndicatorIds] = useState<string[]>(
    [],
  );
  const [selectedFormulaIds, setSelectedFormulaIds] = useState<string[]>([]);
  const [timeConfig, setTimeConfig] =
    useState<WorkspaceTimeConfig>(defaultTimeConfig);
  const [filterRules, setFilterRules] = useState<FilterRuleDraft[]>([]);
  const [sortState, setSortState] = useState<{
    metricId: string;
    direction: "asc" | "desc";
  } | null>(null);
  const [columnState] = useState(defaultColumnState);
  const [resultSnapshot, setResultSnapshot] = useState<WorkspaceResult | null>(
    null,
  );
  const [lastFetchedAt, setLastFetchedAt] = useState<string | undefined>();
  const [stockSearchKeyword, setStockSearchKeyword] = useState("");
  const deferredStockKeyword = useDeferredValue(stockSearchKeyword.trim());
  const [editingFormulaId, setEditingFormulaId] = useState<string | null>(null);
  const [formulaName, setFormulaName] = useState("");
  const [formulaDescription, setFormulaDescription] = useState("");
  const [formulaExpression, setFormulaExpression] = useState("");
  const [formulaTargetIndicators, setFormulaTargetIndicators] = useState<
    string[]
  >([]);
  const [formulaValidation, setFormulaValidation] = useState<string | null>(
    null,
  );
  const [activeTabId, setActiveTabId] = useState(
    screeningStageTabs[0]?.id ?? "stocks",
  );

  const catalogQuery = api.screening.listIndicatorCatalog.useQuery(undefined, {
    refetchOnWindowFocus: false,
  });
  const formulasQuery = api.screening.listFormulas.useQuery(undefined, {
    refetchOnWindowFocus: false,
  });
  const workspacesQuery = api.screening.listWorkspaces.useQuery(
    { limit: 100, offset: 0 },
    { refetchOnWindowFocus: false },
  );
  const workspaceDetailQuery = api.screening.getWorkspace.useQuery(
    { id: selectedWorkspaceId ?? "" },
    {
      enabled: selectedWorkspaceId !== null && !draftMode,
      refetchOnWindowFocus: false,
    },
  );
  const searchStocksQuery = api.screening.searchStocks.useQuery(
    {
      keyword: deferredStockKeyword,
      limit: 20,
    },
    {
      enabled: deferredStockKeyword.length > 0,
      refetchOnWindowFocus: false,
    },
  );

  const groupedCatalog = useMemo(
    () =>
      groupCatalogItems({
        categories: catalogQuery.data?.categories ?? [],
        items: catalogQuery.data?.items ?? [],
      }),
    [catalogQuery.data],
  );
  const catalogNotice = useMemo(
    () =>
      buildCatalogNotice({
        isLoading: catalogQuery.isLoading,
        errorMessage: catalogQuery.isError ? catalogQuery.error.message : null,
        categories: catalogQuery.data?.categories ?? [],
        items: catalogQuery.data?.items ?? [],
      }),
    [
      catalogQuery.data,
      catalogQuery.error,
      catalogQuery.isError,
      catalogQuery.isLoading,
    ],
  );
  const formulas = formulasQuery.data ?? [];
  const workspaceOptions = workspacesQuery.data ?? [];
  const metricNameMap = useMemo(
    () =>
      buildMetricNameMap({
        catalogItems: catalogQuery.data?.items ?? [],
        formulas,
        result: resultSnapshot,
      }),
    [catalogQuery.data, formulas, resultSnapshot],
  );
  const resultColumns = useMemo(
    () => buildResultColumns(resultSnapshot),
    [resultSnapshot],
  );
  const visibleLatestRows = useMemo(
    () =>
      buildVisibleResultRows({
        result: resultSnapshot,
        filterRules: filterRules.filter((rule) => rule.metricId),
        sortState,
      }),
    [filterRules, resultSnapshot, sortState],
  );
  const visibleRows = useMemo(() => {
    if (!resultSnapshot) {
      return [];
    }

    const visibleOrder = new Map(
      visibleLatestRows.map((row, index) => [row.stockCode, index] as const),
    );

    return resultSnapshot.rows
      .filter((row) => visibleOrder.has(row.stockCode))
      .sort(
        (left, right) =>
          (visibleOrder.get(left.stockCode) ?? 0) -
          (visibleOrder.get(right.stockCode) ?? 0),
      );
  }, [resultSnapshot, visibleLatestRows]);
  const filterMetricOptions = useMemo(
    () =>
      Array.from(
        new Set(visibleLatestRows.flatMap((row) => Object.keys(row.metrics))),
      ),
    [visibleLatestRows],
  );

  const createWorkspaceMutation = api.screening.createWorkspace.useMutation({
    onSuccess: async (workspace) => {
      setDraftMode(false);
      setSelectedWorkspaceId(workspace.id);
      setNotice({ tone: "success", text: `工作台“${workspace.name}”已保存` });
      await utils.screening.listWorkspaces.invalidate();
    },
    onError: (error) => setNotice({ tone: "error", text: error.message }),
  });
  const updateWorkspaceMutation = api.screening.updateWorkspace.useMutation({
    onSuccess: async (workspace) => {
      setNotice({ tone: "success", text: `工作台“${workspace.name}”已更新` });
      await Promise.all([
        utils.screening.listWorkspaces.invalidate(),
        utils.screening.getWorkspace.invalidate({ id: workspace.id }),
      ]);
    },
    onError: (error) => setNotice({ tone: "error", text: error.message }),
  });
  const queryDatasetMutation = api.screening.queryDataset.useMutation({
    onSuccess: (workspaceResult) => {
      setResultSnapshot({
        ...workspaceResult,
        warnings: workspaceResult.warnings ?? [],
      });
      setLastFetchedAt(new Date().toISOString());
      setSelectedStocks((current) =>
        current.map((stock) => {
          const row = workspaceResult.latestSnapshotRows.find(
            (item) => item.stockCode === stock.stockCode,
          );
          return row ? { ...stock, stockName: row.stockName } : stock;
        }),
      );
      setNotice(null);
    },
    onError: (error) => setNotice({ tone: "error", text: error.message }),
  });
  const validateFormulaMutation = api.screening.validateFormula.useMutation({
    onSuccess: (result) =>
      setFormulaValidation(
        result.valid
          ? `校验通过：${result.normalizedExpression ?? formulaExpression}`
          : (result.errors ?? []).join("；"),
      ),
    onError: (error) => setFormulaValidation(error.message),
  });
  const createFormulaMutation = api.screening.createFormula.useMutation({
    onSuccess: async (formula) => {
      setSelectedFormulaIds((current) =>
        current.includes(formula.id) ? current : [...current, formula.id],
      );
      setNotice({ tone: "success", text: `公式“${formula.name}”已保存` });
      await utils.screening.listFormulas.invalidate();
      resetFormulaEditor();
    },
    onError: (error) => setNotice({ tone: "error", text: error.message }),
  });
  const updateFormulaMutation = api.screening.updateFormula.useMutation({
    onSuccess: async (formula) => {
      setNotice({ tone: "success", text: `公式“${formula.name}”已更新` });
      await utils.screening.listFormulas.invalidate();
      resetFormulaEditor();
    },
    onError: (error) => setNotice({ tone: "error", text: error.message }),
  });
  const deleteFormulaMutation = api.screening.deleteFormula.useMutation({
    onSuccess: async () => {
      setNotice({ tone: "success", text: "公式已删除" });
      await utils.screening.listFormulas.invalidate();
      resetFormulaEditor();
    },
    onError: (error) => setNotice({ tone: "error", text: error.message }),
  });

  function resetFormulaEditor() {
    setEditingFormulaId(null);
    setFormulaName("");
    setFormulaDescription("");
    setFormulaExpression("");
    setFormulaTargetIndicators([]);
    setFormulaValidation(null);
  }

  function resetWorkspaceDraft() {
    setDraftMode(true);
    setSelectedWorkspaceId(null);
    setWorkspaceName("");
    setWorkspaceDescription("");
    setSelectedStocks([]);
    setSelectedIndicatorIds([]);
    setSelectedFormulaIds([]);
    setTimeConfig(defaultTimeConfig);
    setFilterRules([]);
    setSortState(null);
    setResultSnapshot(null);
    setLastFetchedAt(undefined);
  }

  useEffect(() => {
    if (workspaceIdFromUrl) {
      setDraftMode(false);
      setSelectedWorkspaceId(workspaceIdFromUrl);
    }
  }, [workspaceIdFromUrl]);

  useEffect(() => {
    if (workspaceOptions.length === 0 || selectedWorkspaceId || draftMode) {
      return;
    }

    const firstWorkspace = workspaceOptions[0];
    if (firstWorkspace) {
      setSelectedWorkspaceId(firstWorkspace.id);
      setDraftMode(false);
    }
  }, [draftMode, selectedWorkspaceId, workspaceOptions]);

  useEffect(() => {
    if (!workspaceDetailQuery.data) {
      return;
    }

    const detail = workspaceDetailQuery.data;
    setWorkspaceName(detail.name);
    setWorkspaceDescription(detail.description ?? "");
    setSelectedStocks(toSelectedStocks(detail));
    setSelectedIndicatorIds(detail.state.indicatorIds);
    setSelectedFormulaIds(detail.state.formulaIds);
    setTimeConfig(detail.state.timeConfig);
    setFilterRules(
      detail.state.filterRules.map((rule) => ({
        ...rule,
        clientId: crypto.randomUUID(),
      })),
    );
    setSortState(detail.state.sortState ?? null);
    setResultSnapshot(detail.state.resultSnapshot ?? null);
    setLastFetchedAt(detail.state.lastFetchedAt);
  }, [workspaceDetailQuery.data]);

  useEffect(() => {
    setSelectedFormulaIds((current) =>
      current.filter((formulaId) =>
        formulas.some((formula: FormulaItem) => formula.id === formulaId),
      ),
    );
  }, [formulas]);

  function toggleStock(stock: SelectedStock) {
    setSelectedStocks((current) => {
      const exists = current.some((item) => item.stockCode === stock.stockCode);
      if (exists) {
        return current.filter((item) => item.stockCode !== stock.stockCode);
      }
      if (current.length >= 20) {
        setNotice({ tone: "error", text: "最多只能选择 20 只股票" });
        return current;
      }
      return [...current, stock];
    });
  }

  function toggleIndicator(indicatorId: string) {
    setSelectedIndicatorIds((current) =>
      current.includes(indicatorId)
        ? current.filter((item) => item !== indicatorId)
        : [...current, indicatorId],
    );
  }

  function toggleFormula(formulaId: string) {
    setSelectedFormulaIds((current) =>
      current.includes(formulaId)
        ? current.filter((item) => item !== formulaId)
        : [...current, formulaId],
    );
  }

  function addFilterRule() {
    setFilterRules((current) => [...current, emptyFilterRule()]);
  }

  function updateFilterRule(
    index: number,
    patch: Partial<WorkspaceFilterRule>,
  ) {
    setFilterRules((current) =>
      current.map((rule, ruleIndex) =>
        ruleIndex === index ? { ...rule, ...patch } : rule,
      ),
    );
  }

  function removeFilterRule(index: number) {
    setFilterRules((current) =>
      current.filter((_rule, ruleIndex) => ruleIndex !== index),
    );
  }

  function insertMetricIntoFormula(name: string) {
    setFormulaExpression((current) =>
      current.length === 0 ? `[${name}]` : `${current}[${name}]`,
    );
  }

  function toggleFormulaTargetIndicator(metricId: string) {
    setFormulaTargetIndicators((current) => {
      if (current.includes(metricId)) {
        return current.filter((item) => item !== metricId);
      }
      if (current.length >= 5) {
        setNotice({ tone: "error", text: "目标指标最多只能选择 5 个" });
        return current;
      }
      return [...current, metricId];
    });
  }

  async function handleSaveWorkspace() {
    const payload = {
      name: workspaceName,
      description: workspaceDescription || undefined,
      stockCodes: selectedStocks.map((stock) => stock.stockCode),
      indicatorIds: selectedIndicatorIds,
      formulaIds: selectedFormulaIds,
      timeConfig,
      filterRules: filterRules.map(({ clientId: _clientId, ...rule }) => rule),
      sortState,
      columnState,
      resultSnapshot: resultSnapshot ?? undefined,
      lastFetchedAt,
    };

    if (draftMode || !selectedWorkspaceId) {
      await createWorkspaceMutation.mutateAsync(payload);
      return;
    }

    await updateWorkspaceMutation.mutateAsync({
      id: selectedWorkspaceId,
      ...payload,
    });
  }

  async function handleFetchDataset() {
    if (selectedStocks.length === 0) {
      setNotice({ tone: "error", text: "请先选择股票" });
      return;
    }
    if (selectedIndicatorIds.length === 0 && selectedFormulaIds.length === 0) {
      setNotice({ tone: "error", text: "请至少选择一个指标或公式" });
      return;
    }

    await queryDatasetMutation.mutateAsync({
      stockCodes: selectedStocks.map((stock) => stock.stockCode),
      indicatorIds: selectedIndicatorIds,
      formulaIds: selectedFormulaIds,
      timeConfig,
    });
  }

  async function handleValidateFormula() {
    if (!formulaExpression.trim() || formulaTargetIndicators.length === 0) {
      setFormulaValidation("请填写公式表达式并选择目标指标");
      return;
    }
    await validateFormulaMutation.mutateAsync({
      expression: formulaExpression,
      targetIndicators: formulaTargetIndicators,
    });
  }

  async function handleSaveFormula() {
    const payload = {
      name: formulaName,
      expression: formulaExpression,
      targetIndicators: formulaTargetIndicators,
      description: formulaDescription || undefined,
      categoryId: "custom",
    };

    if (editingFormulaId) {
      await updateFormulaMutation.mutateAsync({
        id: editingFormulaId,
        ...payload,
      });
      return;
    }

    await createFormulaMutation.mutateAsync(payload);
  }

  const stagePanelSummary = {
    stocks: (
      <SectionCard
        title="选股池"
        description="先确定本轮筛选覆盖哪些股票，再进入指标和公式配置。"
      >
        <div className="text-sm leading-6 text-[var(--app-text-muted)]">
          当前已选择 {selectedStocks.length} 只股票，最多支持 20 只。
        </div>
      </SectionCard>
    ),
    indicators: (
      <SectionCard
        title="指标-公式"
        description="明确本轮筛选要看哪些官方指标和自定义公式。"
      >
        <div className="text-sm leading-6 text-[var(--app-text-muted)]">
          当前已选 {selectedIndicatorIds.length} 个指标和{" "}
          {selectedFormulaIds.length} 个公式。
        </div>
      </SectionCard>
    ),
    period: (
      <SectionCard
        title="期间设置"
        description="确认财报周期、回溯方式和时间边界。"
      >
        <div className="text-sm leading-6 text-[var(--app-text-muted)]">
          当前模式为 {timeConfig.periodType} / {timeConfig.rangeMode}。
        </div>
      </SectionCard>
    ),
    filters: (
      <SectionCard
        title="本地筛选"
        description="远端数据取回后，优先在本地完成过滤和排序。"
      >
        <div className="text-sm leading-6 text-[var(--app-text-muted)]">
          当前配置 {filterRules.length} 条本地规则。
        </div>
      </SectionCard>
    ),
    results: (
      <SectionCard
        title="结果表"
        description="查看可见结果、告警和最终输出，再决定是否保存工作台。"
      >
        <div className="text-sm leading-6 text-[var(--app-text-muted)]">
          当前可见 {visibleRows.length} 条结果。
        </div>
      </SectionCard>
    ),
  } satisfies Record<string, React.ReactNode>;
  const stagePanels = {
    stocks: stagePanelSummary.stocks && null,
    indicators: stagePanelSummary.indicators && null,
    period: stagePanelSummary.period && null,
    filters: stagePanelSummary.filters && null,
    results: stagePanelSummary.results && null,
  } satisfies Record<string, React.ReactNode>;

  return (
    <WorkspaceShell
      section="screening"
      title="小批量筛选工作台"
      description="先搜股票，再选指标、公式与报告期；只有点击“获取”时才会请求数据。结果获取后，筛选、排序和保存都在本地工作台内完成。"
      actions={
        <>
          <select
            value={draftMode ? "" : (selectedWorkspaceId ?? "")}
            onChange={(event) => {
              const nextId = event.target.value;
              if (!nextId) {
                return;
              }
              setDraftMode(false);
              setSelectedWorkspaceId(nextId);
            }}
            className="app-input min-w-[220px]"
          >
            <option value="">选择已保存工作台</option>
            {workspaceOptions.map((workspace: WorkspaceSummary) => (
              <option key={workspace.id} value={workspace.id}>
                {workspace.name}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={resetWorkspaceDraft}
            className="app-button"
          >
            新建工作台
          </button>
          <button
            type="button"
            onClick={() => void handleSaveWorkspace()}
            className="app-button app-button-primary"
            disabled={
              createWorkspaceMutation.isPending ||
              updateWorkspaceMutation.isPending
            }
          >
            保存工作台
          </button>
          <Link href="/screening/history" className="app-button">
            工作台库
          </Link>
        </>
      }
    >
      {notice ? (
        <InlineNotice
          tone={
            notice.tone === "success"
              ? "success"
              : notice.tone === "error"
                ? "danger"
                : "info"
          }
          description={notice.text}
        />
      ) : null}

      <WorkflowStageSwitcher
        tabs={screeningStageTabs}
        activeTabId={activeTabId}
        onChange={setActiveTabId}
        panels={stagePanels}
      />

      <div className="grid gap-6 xl:grid-cols-12">
        <SectionCard
          title="股票搜索多选"
          description="基于本地股票代码映射搜索，最多选择 20 只股票加入当前工作台。"
          className={activeTabId === "stocks" ? "xl:col-span-4" : "hidden"}
        >
          <input
            value={stockSearchKeyword}
            onChange={(event) => setStockSearchKeyword(event.target.value)}
            placeholder="输入股票代码或名称"
            className="app-input"
          />
          <div className="mt-4 flex flex-wrap gap-2">
            {selectedStocks.map((stock) => (
              <button
                key={stock.stockCode}
                type="button"
                onClick={() => toggleStock(stock)}
                className="rounded-full border border-[var(--app-border-soft)] px-3 py-1 text-xs text-[var(--app-text)]"
              >
                {stock.stockName} {stock.stockCode}
              </button>
            ))}
          </div>
          <div className="mt-4 max-h-[280px] overflow-auto rounded-[12px] border border-[var(--app-border-soft)]">
            {deferredStockKeyword.length === 0 ? (
              <div className="p-4 text-sm text-[var(--app-text-muted)]">
                输入关键词后从本地股票列表搜索，最多选择 20 只。
              </div>
            ) : searchStocksQuery.isLoading ? (
              <div className="p-4 text-sm text-[var(--app-text-muted)]">
                搜索中...
              </div>
            ) : searchStocksQuery.isError ? (
              <div className="p-4">
                <InlineNotice
                  tone="danger"
                  description={searchStocksQuery.error.message}
                />
              </div>
            ) : (searchStocksQuery.data?.length ?? 0) === 0 ? (
              <div className="p-4 text-sm text-[var(--app-text-muted)]">
                未找到匹配的股票。
              </div>
            ) : (
              <div className="grid">
                {(searchStocksQuery.data ?? []).map((stock) => {
                  const selected = selectedStocks.some(
                    (item) => item.stockCode === stock.stockCode,
                  );
                  return (
                    <button
                      key={stock.stockCode}
                      type="button"
                      onClick={() =>
                        toggleStock({
                          stockCode: stock.stockCode,
                          stockName: stock.stockName,
                          market: stock.market,
                        })
                      }
                      className="flex items-center justify-between border-b border-[var(--app-border-soft)] px-4 py-3 text-left text-sm last:border-b-0"
                    >
                      <div>
                        <div className="text-[var(--app-text)]">
                          {stock.stockName} {stock.stockCode}
                        </div>
                        <div className="text-xs text-[var(--app-text-subtle)]">
                          {stock.market} ·{" "}
                          {stock.matchField === "CODE"
                            ? "代码命中"
                            : "名称命中"}
                        </div>
                      </div>
                      <StatusPill
                        label={selected ? "已选" : "添加"}
                        tone={selected ? "success" : "info"}
                      />
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </SectionCard>

        <SectionCard
          title="指标目录"
          description="官方指标与自定义公式都在当前工作台里统一勾选。"
          className={activeTabId === "indicators" ? "xl:col-span-4" : "hidden"}
        >
          {catalogNotice ? (
            <InlineNotice
              tone={catalogNotice.tone}
              description={catalogNotice.description}
            />
          ) : null}
          <div className="max-h-[420px] overflow-auto rounded-[12px] border border-[var(--app-border-soft)]">
            <div className="border-b border-[var(--app-border-soft)] px-4 py-3 text-xs text-[var(--app-text-subtle)]">
              官方指标
            </div>
            {groupedCatalog.length === 0 ? (
              <div className="px-4 py-4 text-sm text-[var(--app-text-muted)]">
                暂无可展示的官方指标。
              </div>
            ) : null}
            {groupedCatalog.map((category) => (
              <div
                key={category.id}
                className="border-b border-[var(--app-border-soft)] px-4 py-3 last:border-b-0"
              >
                <div className="text-xs font-medium text-[var(--app-text-soft)]">
                  {category.name}
                </div>
                <div className="mt-2 grid gap-2">
                  {category.items.map((item) => (
                    <label
                      key={item.id}
                      className="flex items-start gap-2 text-sm text-[var(--app-text)]"
                    >
                      <input
                        type="checkbox"
                        checked={selectedIndicatorIds.includes(item.id)}
                        onChange={() => toggleIndicator(item.id)}
                        className="mt-1"
                      />
                      <span>
                        <span>{item.name}</span>
                        <span className="block text-xs text-[var(--app-text-subtle)]">
                          {item.periodScope === "series"
                            ? "多期间展开"
                            : "仅最新值"}
                        </span>
                      </span>
                    </label>
                  ))}
                </div>
              </div>
            ))}
            <div className="border-t border-[var(--app-border-soft)] px-4 py-3 text-xs text-[var(--app-text-subtle)]">
              自定义公式
            </div>
            <div className="px-4 py-3">
              {formulas.length === 0 ? (
                <div className="text-sm text-[var(--app-text-muted)]">
                  还没有保存过公式。
                </div>
              ) : (
                <div className="grid gap-2">
                  {formulas.map((formula: FormulaItem) => (
                    <label
                      key={formula.id}
                      className="flex items-start gap-2 text-sm text-[var(--app-text)]"
                    >
                      <input
                        type="checkbox"
                        checked={selectedFormulaIds.includes(formula.id)}
                        onChange={() => toggleFormula(formula.id)}
                        className="mt-1"
                      />
                      <span>
                        <span>{formula.name}</span>
                        <span className="block text-xs text-[var(--app-text-subtle)]">
                          {formula.expression}
                        </span>
                      </span>
                    </label>
                  ))}
                </div>
              )}
            </div>
          </div>
        </SectionCard>

        <SectionCard
          title="公式编辑器"
          description="输入 [指标名]，保存时会由后端转换为安全表达式。"
          className={activeTabId === "indicators" ? "xl:col-span-4" : "hidden"}
          actions={
            editingFormulaId ? (
              <button
                type="button"
                onClick={resetFormulaEditor}
                className="app-button"
              >
                取消编辑
              </button>
            ) : null
          }
        >
          <div className="grid gap-3">
            <input
              value={formulaName}
              onChange={(event) => setFormulaName(event.target.value)}
              placeholder="公式名称"
              className="app-input"
            />
            <textarea
              value={formulaExpression}
              onChange={(event) => setFormulaExpression(event.target.value)}
              placeholder="示例：[营业收入] / [归母净利润]"
              className="app-input min-h-[120px]"
            />
            <input
              value={formulaDescription}
              onChange={(event) => setFormulaDescription(event.target.value)}
              placeholder="说明"
              className="app-input"
            />
            <div className="rounded-[12px] border border-[var(--app-border-soft)] p-3">
              <div className="text-xs text-[var(--app-text-subtle)]">
                点击插入指标名
              </div>
              <div className="mt-2 flex max-h-[120px] flex-wrap gap-2 overflow-auto">
                {(catalogQuery.data?.items ?? []).slice(0, 30).map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => insertMetricIntoFormula(item.name)}
                    className="rounded-full border border-[var(--app-border-soft)] px-3 py-1 text-xs text-[var(--app-text)]"
                  >
                    {item.name}
                  </button>
                ))}
              </div>
            </div>
            <div className="rounded-[12px] border border-[var(--app-border-soft)] p-3">
              <div className="text-xs text-[var(--app-text-subtle)]">
                目标指标（最多 5 个）
              </div>
              <div className="mt-2 grid max-h-[140px] gap-2 overflow-auto">
                {(catalogQuery.data?.items ?? []).map((item) => (
                  <label
                    key={item.id}
                    className="flex items-center gap-2 text-sm text-[var(--app-text)]"
                  >
                    <input
                      type="checkbox"
                      checked={formulaTargetIndicators.includes(item.id)}
                      onChange={() => toggleFormulaTargetIndicator(item.id)}
                    />
                    <span>{item.name}</span>
                  </label>
                ))}
              </div>
            </div>
            {formulaValidation ? (
              <InlineNotice tone="info" description={formulaValidation} />
            ) : null}
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => void handleValidateFormula()}
                className="app-button"
              >
                校验公式
              </button>
              <button
                type="button"
                onClick={() => void handleSaveFormula()}
                className="app-button app-button-primary"
              >
                保存公式
              </button>
            </div>
            {formulas.length > 0 ? (
              <div className="rounded-[12px] border border-[var(--app-border-soft)] p-3">
                <div className="text-xs text-[var(--app-text-subtle)]">
                  已保存公式
                </div>
                <div className="mt-2 grid gap-2">
                  {formulas.map((formula: FormulaItem) => (
                    <div
                      key={formula.id}
                      className="flex items-center justify-between gap-3 rounded-[10px] border border-[var(--app-border-soft)] px-3 py-2"
                    >
                      <div className="min-w-0">
                        <div className="truncate text-sm text-[var(--app-text)]">
                          {formula.name}
                        </div>
                        <div className="truncate text-xs text-[var(--app-text-subtle)]">
                          {formula.expression}
                        </div>
                      </div>
                      <div className="flex gap-2">
                        <button
                          type="button"
                          className="app-button"
                          onClick={() => {
                            setEditingFormulaId(formula.id);
                            setFormulaName(formula.name);
                            setFormulaDescription(formula.description ?? "");
                            setFormulaExpression(formula.expression);
                            setFormulaTargetIndicators(
                              formula.targetIndicators,
                            );
                            setFormulaValidation(null);
                          }}
                        >
                          编辑
                        </button>
                        <button
                          type="button"
                          className="app-button"
                          onClick={() =>
                            void deleteFormulaMutation.mutateAsync({
                              id: formula.id,
                            })
                          }
                        >
                          删除
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
          </div>
        </SectionCard>

        <SectionCard
          title="期间设置"
          description="改变期间设置不会自动取数，只有点击获取才会请求数据。"
          className={activeTabId === "period" ? "xl:col-span-4" : "hidden"}
        >
          <div className="grid gap-3">
            <input
              value={workspaceName}
              onChange={(event) => setWorkspaceName(event.target.value)}
              placeholder="工作台名称"
              className="app-input"
            />
            <input
              value={workspaceDescription}
              onChange={(event) => setWorkspaceDescription(event.target.value)}
              placeholder="描述"
              className="app-input"
            />
            <div className="grid gap-3 md:grid-cols-2">
              <label className="grid gap-2 text-sm text-[var(--app-text-muted)]">
                报告类型
                <select
                  value={timeConfig.periodType}
                  onChange={(event) =>
                    setTimeConfig({
                      periodType: event.target.value as "ANNUAL" | "QUARTERLY",
                      rangeMode: "PRESET",
                      presetKey: event.target.value === "ANNUAL" ? "3Y" : "8Q",
                    })
                  }
                  className="app-input"
                >
                  <option value="ANNUAL">年报</option>
                  <option value="QUARTERLY">季报</option>
                </select>
              </label>
              <label className="grid gap-2 text-sm text-[var(--app-text-muted)]">
                回溯方式
                <select
                  value={timeConfig.rangeMode}
                  onChange={(event) =>
                    setTimeConfig((current) => ({
                      ...current,
                      rangeMode: event.target.value as "PRESET" | "CUSTOM",
                    }))
                  }
                  className="app-input"
                >
                  <option value="PRESET">预设</option>
                  <option value="CUSTOM">自定义</option>
                </select>
              </label>
            </div>
            {timeConfig.rangeMode === "PRESET" ? (
              <label className="grid gap-2 text-sm text-[var(--app-text-muted)]">
                预设区间
                <select
                  value={timeConfig.presetKey}
                  onChange={(event) =>
                    setTimeConfig((current) => ({
                      ...current,
                      presetKey: event.target.value as typeof current.presetKey,
                    }))
                  }
                  className="app-input"
                >
                  {(timeConfig.periodType === "ANNUAL"
                    ? annualPresetOptions
                    : quarterlyPresetOptions
                  ).map((preset) => (
                    <option key={preset} value={preset}>
                      {preset}
                    </option>
                  ))}
                </select>
              </label>
            ) : (
              <div className="grid gap-3 md:grid-cols-2">
                <input
                  value={timeConfig.customStart ?? ""}
                  onChange={(event) =>
                    setTimeConfig((current) => ({
                      ...current,
                      customStart: event.target.value,
                    }))
                  }
                  placeholder="customStart"
                  className="app-input"
                />
                <input
                  value={timeConfig.customEnd ?? ""}
                  onChange={(event) =>
                    setTimeConfig((current) => ({
                      ...current,
                      customEnd: event.target.value,
                    }))
                  }
                  placeholder="customEnd"
                  className="app-input"
                />
              </div>
            )}
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => void handleFetchDataset()}
                className="app-button app-button-primary"
                disabled={queryDatasetMutation.isPending}
              >
                {queryDatasetMutation.isPending ? "获取中..." : "获取"}
              </button>
              <StatusPill
                label={`股票 ${selectedStocks.length}/20`}
                tone={selectedStocks.length > 0 ? "success" : "neutral"}
              />
              <StatusPill
                label={`指标 ${selectedIndicatorIds.length + selectedFormulaIds.length}`}
                tone={
                  selectedIndicatorIds.length + selectedFormulaIds.length > 0
                    ? "info"
                    : "neutral"
                }
              />
            </div>
            <div className="text-sm text-[var(--app-text-muted)]">
              最近获取：{formatDateTime(lastFetchedAt)}
            </div>
          </div>
        </SectionCard>

        <SectionCard
          title="本地筛选与排序"
          description="默认始终基于每只股票最新可用一期的值，不触发任何网络请求。"
          className={activeTabId === "filters" ? "xl:col-span-4" : "hidden"}
        >
          <div className="grid gap-3">
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={addFilterRule}
                className="app-button"
              >
                添加规则
              </button>
              <button
                type="button"
                onClick={() => setFilterRules([])}
                className="app-button"
              >
                清空规则
              </button>
            </div>
            {filterRules.length === 0 ? (
              <div className="text-sm text-[var(--app-text-muted)]">
                还没有本地筛选规则。
              </div>
            ) : (
              <div className="grid gap-3">
                {filterRules.map((rule, index) => (
                  <div
                    key={rule.clientId}
                    className="grid gap-2 rounded-[12px] border border-[var(--app-border-soft)] p-3"
                  >
                    <select
                      value={rule.metricId}
                      onChange={(event) =>
                        updateFilterRule(index, {
                          metricId: event.target.value,
                        })
                      }
                      className="app-input"
                    >
                      <option value="">选择指标</option>
                      {filterMetricOptions.map((metricId) => (
                        <option key={metricId} value={metricId}>
                          {metricNameMap.get(metricId) ?? metricId}
                        </option>
                      ))}
                    </select>
                    <div className="grid gap-2 md:grid-cols-[120px_minmax(0,1fr)_120px]">
                      <select
                        value={rule.operator}
                        onChange={(event) =>
                          updateFilterRule(index, {
                            operator: event.target
                              .value as WorkspaceFilterRule["operator"],
                          })
                        }
                        className="app-input"
                      >
                        <option value=">=">{">="}</option>
                        <option value=">">{">"}</option>
                        <option value="<=">{"<="}</option>
                        <option value="<">{"<"}</option>
                        <option value="=">{"="}</option>
                        <option value="!=">{"!="}</option>
                      </select>
                      <input
                        value={String(rule.value)}
                        onChange={(event) =>
                          updateFilterRule(index, { value: event.target.value })
                        }
                        placeholder="过滤值"
                        className="app-input"
                      />
                      <button
                        type="button"
                        onClick={() => removeFilterRule(index)}
                        className="app-button"
                      >
                        删除
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
            <div className="rounded-[12px] border border-[var(--app-border-soft)] p-3">
              <div className="text-xs text-[var(--app-text-subtle)]">排序</div>
              <div className="mt-2 grid gap-2 md:grid-cols-[minmax(0,1fr)_140px]">
                <select
                  value={sortState?.metricId ?? ""}
                  onChange={(event) =>
                    setSortState(
                      event.target.value
                        ? {
                            metricId: event.target.value,
                            direction: sortState?.direction ?? "desc",
                          }
                        : null,
                    )
                  }
                  className="app-input"
                >
                  <option value="">不排序</option>
                  {filterMetricOptions.map((metricId) => (
                    <option key={metricId} value={metricId}>
                      {metricNameMap.get(metricId) ?? metricId}
                    </option>
                  ))}
                </select>
                <select
                  value={sortState?.direction ?? "desc"}
                  onChange={(event) =>
                    setSortState((current) =>
                      current
                        ? {
                            ...current,
                            direction: event.target.value as "asc" | "desc",
                          }
                        : null,
                    )
                  }
                  className="app-input"
                  disabled={!sortState}
                >
                  <option value="desc">降序</option>
                  <option value="asc">升序</option>
                </select>
              </div>
            </div>
          </div>
        </SectionCard>

        <SectionCard
          title="结果表格"
          description="财报类指标按期间展开，latest-only 指标放在最新列。"
          className={activeTabId === "results" ? "xl:col-span-8" : "hidden"}
        >
          {!resultSnapshot ? (
            <EmptyState
              title="还没有加载结果"
              description="先完成股票、指标与期间选择，再点击“获取”拉取数据。"
            />
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-2">
                <StatusPill
                  label={`provider: ${resultSnapshot.provider}`}
                  tone="info"
                />
                <StatusPill
                  label={`状态: ${resultSnapshot.dataStatus}`}
                  tone="success"
                />
                <StatusPill
                  label={`可见 ${visibleRows.length} / ${resultSnapshot.rows.length}`}
                  tone="neutral"
                />
              </div>
              {resultSnapshot.warnings.length > 0 ? (
                <div className="mt-3 grid gap-2">
                  {resultSnapshot.warnings.map((warning) => (
                    <InlineNotice
                      key={warning}
                      tone="warning"
                      description={warning}
                    />
                  ))}
                </div>
              ) : null}
              <div className="mt-4 overflow-auto rounded-[12px] border border-[var(--app-border-soft)]">
                <table className="app-table min-w-[980px]">
                  <thead>
                    <tr>
                      <th>股票</th>
                      <th>代码</th>
                      {resultColumns.map((column) => (
                        <th key={column.key}>{column.label}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {visibleRows.map((row) => (
                      <tr key={row.stockCode}>
                        <td>{row.stockName}</td>
                        <td>{row.stockCode}</td>
                        {resultColumns.map((column) => {
                          const seriesMetric = row.metrics[column.metricId];
                          const latestValue = getLatestMetricValue(
                            resultSnapshot,
                            row.stockCode,
                            column.metricId,
                          );
                          const cellValue =
                            column.period === null
                              ? latestValue
                              : (seriesMetric?.byPeriod[column.period] ?? null);

                          return (
                            <td key={`${row.stockCode}-${column.key}`}>
                              {cellValue ?? "-"}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </SectionCard>
      </div>
    </WorkspaceShell>
  );
}
