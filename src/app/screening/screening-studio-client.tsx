"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { z } from "zod";
import { api, type RouterInputs, type RouterOutputs } from "~/trpc/react";

const filterConditionSchema = z.object({
  field: z.string(),
  operator: z.string(),
  value: z.union([
    z.object({
      type: z.literal("numeric"),
      value: z.number(),
      unit: z.string().optional(),
    }),
    z.object({ type: z.literal("text"), value: z.string() }),
    z.object({ type: z.literal("list"), values: z.array(z.string()) }),
    z.object({ type: z.literal("range"), min: z.number(), max: z.number() }),
    z.object({
      type: z.literal("timeSeries"),
      years: z.number(),
      threshold: z.number().optional(),
    }),
  ]),
});

type FilterGroupInput = {
  groupId: string;
  operator: string;
  conditions: z.infer<typeof filterConditionSchema>[];
  subGroups: FilterGroupInput[];
};

const filterGroupSchema: z.ZodType<FilterGroupInput> = z.lazy(() =>
  z.object({
    groupId: z.string(),
    operator: z.string(),
    conditions: z.array(filterConditionSchema),
    subGroups: z.array(filterGroupSchema),
  }),
);

const scoringConfigSchema = z.object({
  weights: z.record(z.string(), z.number()),
  directions: z.record(z.string(), z.enum(["ASC", "DESC"])).optional(),
  normalizationMethod: z.string(),
});

type CreateStrategyInput = RouterInputs["screening"]["createStrategy"];
type StrategyListItem = RouterOutputs["screening"]["listStrategies"][number];
type SessionListItem = RouterOutputs["screening"]["listRecentSessions"][number];
type WatchListItem = RouterOutputs["watchlist"]["list"][number];

type StrategyFormState = {
  name: string;
  description: string;
  tagsText: string;
  isTemplate: boolean;
  filtersJson: string;
  scoringConfigJson: string;
};

type StrategyFormMode = "create" | "update";

type NoticeState = {
  tone: "success" | "error" | "info";
  text: string;
};

type ParsedTopStock = {
  stockCode: string;
  stockName: string;
  score: number;
  indicatorPreview: string;
  explanations: string[];
};

type ParsedWatchedStock = {
  stockCode: string;
  stockName: string;
  note: string;
  tags: string[];
  addedAt: string;
};

const DEFAULT_FILTERS: CreateStrategyInput["filters"] = {
  groupId: "root",
  operator: "AND",
  conditions: [
    {
      field: "ROE",
      operator: "GREATER_THAN",
      value: {
        type: "numeric",
        value: 0.15,
      },
    },
    {
      field: "PE",
      operator: "LESS_THAN",
      value: {
        type: "numeric",
        value: 30,
      },
    },
  ],
  subGroups: [],
};

const DEFAULT_SCORING_CONFIG: CreateStrategyInput["scoringConfig"] = {
  weights: {
    ROE: 0.45,
    PE: 0.3,
    NET_PROFIT_CAGR_3Y: 0.25,
  },
  directions: {
    ROE: "DESC",
    PE: "ASC",
    NET_PROFIT_CAGR_3Y: "DESC",
  },
  normalizationMethod: "MIN_MAX",
};

function createDefaultStrategyForm(): StrategyFormState {
  return {
    name: "价值成长混合策略",
    description: "兼顾盈利质量、估值和成长性",
    tagsText: "价值, 成长, 基本面",
    isTemplate: false,
    filtersJson: JSON.stringify(DEFAULT_FILTERS, null, 2),
    scoringConfigJson: JSON.stringify(DEFAULT_SCORING_CONFIG, null, 2),
  };
}

function formatDate(value: Date | string | null | undefined): string {
  if (!value) {
    return "-";
  }

  const date = value instanceof Date ? value : new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "-";
  }

  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function parseTags(tagsText: string): string[] {
  return tagsText
    .split(/[\n,，]/)
    .map((tag) => tag.trim())
    .filter((tag) => tag.length > 0);
}

function toRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }

  return value as Record<string, unknown>;
}

function readString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function readStringList(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter((item): item is string => typeof item === "string");
}

function readNumber(value: unknown, fallback = 0): number {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return fallback;
  }

  return value;
}

function formatValue(value: unknown): string {
  if (typeof value === "number") {
    if (Math.abs(value) >= 1000) {
      return value.toFixed(0);
    }

    return value
      .toFixed(3)
      .replace(/\.0+$/, "")
      .replace(/(\.\d*?)0+$/, "$1");
  }

  if (typeof value === "string") {
    return value;
  }

  if (typeof value === "boolean") {
    return value ? "true" : "false";
  }

  if (value === null || value === undefined) {
    return "-";
  }

  return JSON.stringify(value);
}

function parseTopStocks(rawStocks: unknown): ParsedTopStock[] {
  if (!Array.isArray(rawStocks)) {
    return [];
  }

  const parsed: ParsedTopStock[] = [];

  for (const entry of rawStocks) {
    const record = toRecord(entry);
    if (!record) {
      continue;
    }

    const indicatorValuesRecord = toRecord(record.indicatorValues);
    const indicatorPreview = indicatorValuesRecord
      ? Object.entries(indicatorValuesRecord)
          .slice(0, 4)
          .map(([field, value]) => `${field}: ${formatValue(value)}`)
          .join(" · ")
      : "-";

    parsed.push({
      stockCode: readString(record.stockCode, "-"),
      stockName: readString(record.stockName, "未知股票"),
      score: readNumber(record.score, 0),
      indicatorPreview,
      explanations: readStringList(record.scoreExplanations),
    });
  }

  return parsed.sort((left, right) => right.score - left.score);
}

function parseWatchedStocks(rawStocks: unknown): ParsedWatchedStock[] {
  if (!Array.isArray(rawStocks)) {
    return [];
  }

  const parsed: ParsedWatchedStock[] = [];

  for (const entry of rawStocks) {
    const record = toRecord(entry);
    if (!record) {
      continue;
    }

    parsed.push({
      stockCode: readString(record.stockCode, "-"),
      stockName: readString(record.stockName, "未知股票"),
      note: readString(record.note, ""),
      tags: readStringList(record.tags),
      addedAt: readString(record.addedAt, ""),
    });
  }

  return parsed.sort((left, right) => {
    return left.stockCode.localeCompare(right.stockCode, "zh-CN");
  });
}

function statusClassName(status: string): string {
  if (status === "SUCCEEDED") {
    return "text-[#63f2c1]";
  }

  if (status === "FAILED") {
    return "text-[#ff93a2]";
  }

  if (status === "RUNNING") {
    return "text-[#71dcff]";
  }

  if (status === "PENDING") {
    return "text-[#ffd180]";
  }

  return "text-[#d0e3f7]";
}

function noticeClassName(tone: NoticeState["tone"]): string {
  if (tone === "success") {
    return "border-[#4ce0af]/45 bg-[#133730]/65 text-[#9bfad6]";
  }

  if (tone === "error") {
    return "border-[#ff7f92]/45 bg-[#5b2432]/52 text-[#ffbec9]";
  }

  return "border-[#f6bf64]/45 bg-[#5d4621]/42 text-[#ffd697]";
}

export function ScreeningStudioClient() {
  const utils = api.useUtils();
  const [notice, setNotice] = useState<NoticeState | null>(null);

  const [strategyMode, setStrategyMode] = useState<StrategyFormMode>("create");
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
  const [runningStrategyId, setRunningStrategyId] = useState<string | null>(
    null,
  );

  const [newWatchListName, setNewWatchListName] = useState("长期跟踪");
  const [newWatchListDescription, setNewWatchListDescription] = useState(
    "记录阶段性跟踪与交易计划",
  );

  const [watchMetaName, setWatchMetaName] = useState("");
  const [watchMetaDescription, setWatchMetaDescription] = useState("");

  const [newStockCode, setNewStockCode] = useState("");
  const [newStockName, setNewStockName] = useState("");
  const [newStockNote, setNewStockNote] = useState("");
  const [newStockTags, setNewStockTags] = useState("成长, 跟踪");

  const [selectedStockCode, setSelectedStockCode] = useState("");
  const [editedStockNote, setEditedStockNote] = useState("");
  const [editedStockTags, setEditedStockTags] = useState("");

  const strategiesQuery = api.screening.listStrategies.useQuery({
    limit: 50,
    offset: 0,
  });
  const sessionsQuery = api.screening.listRecentSessions.useQuery({
    limit: 20,
    offset: 0,
  });
  const watchListsQuery = api.watchlist.list.useQuery({
    limit: 30,
    offset: 0,
    sortBy: "updatedAt",
    sortDirection: "desc",
  });

  const strategyDetailQuery = api.screening.getStrategy.useQuery(
    { id: selectedStrategyId ?? "" },
    {
      enabled: selectedStrategyId !== null,
    },
  );

  const sessionDetailQuery = api.screening.getSessionDetail.useQuery(
    { sessionId: selectedSessionId ?? "" },
    {
      enabled: selectedSessionId !== null,
    },
  );

  const watchListDetailQuery = api.watchlist.getDetail.useQuery(
    { id: selectedWatchListId ?? "" },
    {
      enabled: selectedWatchListId !== null,
    },
  );

  const createStrategyMutation = api.screening.createStrategy.useMutation({
    onSuccess: async (created) => {
      setStrategyMode("update");
      setSelectedStrategyId(created.id);
      setNotice({ tone: "success", text: `策略「${created.name}」创建成功` });
      await Promise.all([
        utils.screening.listStrategies.invalidate(),
        utils.screening.getStrategy.invalidate({ id: created.id }),
      ]);
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
      setNotice({ tone: "error", text: `删除策略失败：${error.message}` });
    },
  });

  const executeStrategyMutation = api.screening.executeStrategy.useMutation({
    onSuccess: async (result) => {
      setSelectedSessionId(result.sessionId);
      setNotice({
        tone: "success",
        text: `执行完成：扫描 ${result.totalScanned} 支，命中 ${result.matchedCount} 支`,
      });
      await Promise.all([
        utils.screening.listRecentSessions.invalidate(),
        utils.screening.getSessionDetail.invalidate({
          sessionId: result.sessionId,
        }),
      ]);
    },
    onError: (error) => {
      setNotice({ tone: "error", text: `执行失败：${error.message}` });
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
      setNotice({ tone: "error", text: `删除会话失败：${error.message}` });
    },
  });

  const createWatchListMutation = api.watchlist.create.useMutation({
    onSuccess: async (created) => {
      setSelectedWatchListId(created.id);
      setNotice({
        tone: "success",
        text: `自选股列表「${created.name}」已创建`,
      });
      await Promise.all([
        utils.watchlist.list.invalidate(),
        utils.watchlist.getDetail.invalidate({ id: created.id }),
      ]);
    },
    onError: (error) => {
      setNotice({ tone: "error", text: `创建列表失败：${error.message}` });
    },
  });

  const updateWatchMetaMutation = api.watchlist.updateMeta.useMutation({
    onSuccess: async (updated) => {
      setNotice({ tone: "success", text: `列表「${updated.name}」信息已更新` });
      await Promise.all([
        utils.watchlist.list.invalidate(),
        utils.watchlist.getDetail.invalidate({ id: updated.id }),
      ]);
    },
    onError: (error) => {
      setNotice({ tone: "error", text: `更新列表失败：${error.message}` });
    },
  });

  const deleteWatchListMutation = api.watchlist.delete.useMutation({
    onSuccess: async () => {
      setNotice({ tone: "success", text: "自选股列表已删除" });
      await Promise.all([
        utils.watchlist.list.invalidate(),
        utils.watchlist.getDetail.invalidate(),
      ]);
    },
    onError: (error) => {
      setNotice({ tone: "error", text: `删除列表失败：${error.message}` });
    },
  });

  const addStockMutation = api.watchlist.addStock.useMutation({
    onSuccess: async () => {
      if (selectedWatchListId) {
        await utils.watchlist.getDetail.invalidate({ id: selectedWatchListId });
      }
      await utils.watchlist.list.invalidate();
      setNotice({ tone: "success", text: "股票已加入自选股列表" });
      setNewStockCode("");
      setNewStockName("");
      setNewStockNote("");
    },
    onError: (error) => {
      setNotice({ tone: "error", text: `添加股票失败：${error.message}` });
    },
  });

  const removeStockMutation = api.watchlist.removeStock.useMutation({
    onSuccess: async () => {
      if (selectedWatchListId) {
        await utils.watchlist.getDetail.invalidate({ id: selectedWatchListId });
      }
      await utils.watchlist.list.invalidate();
      setNotice({ tone: "success", text: "股票已从列表移除" });
    },
    onError: (error) => {
      setNotice({ tone: "error", text: `移除股票失败：${error.message}` });
    },
  });

  const updateStockNoteMutation = api.watchlist.updateStockNote.useMutation({
    onSuccess: async () => {
      if (selectedWatchListId) {
        await utils.watchlist.getDetail.invalidate({ id: selectedWatchListId });
      }
      setNotice({ tone: "success", text: "备注已更新" });
    },
    onError: (error) => {
      setNotice({ tone: "error", text: `更新备注失败：${error.message}` });
    },
  });

  const updateStockTagsMutation = api.watchlist.updateStockTags.useMutation({
    onSuccess: async () => {
      if (selectedWatchListId) {
        await utils.watchlist.getDetail.invalidate({ id: selectedWatchListId });
      }
      setNotice({ tone: "success", text: "标签已更新" });
    },
    onError: (error) => {
      setNotice({ tone: "error", text: `更新标签失败：${error.message}` });
    },
  });

  const strategies = strategiesQuery.data ?? [];
  const sessions = sessionsQuery.data ?? [];
  const watchLists = watchListsQuery.data ?? [];

  const parsedTopStocks = useMemo(() => {
    return parseTopStocks(sessionDetailQuery.data?.topStocks);
  }, [sessionDetailQuery.data?.topStocks]);

  const parsedWatchStocks = useMemo(() => {
    return parseWatchedStocks(watchListDetailQuery.data?.stocks);
  }, [watchListDetailQuery.data?.stocks]);

  useEffect(() => {
    if (!notice) {
      return;
    }

    const timer = window.setTimeout(() => {
      setNotice(null);
    }, 3800);

    return () => {
      window.clearTimeout(timer);
    };
  }, [notice]);

  useEffect(() => {
    if (strategies.length === 0) {
      setSelectedStrategyId(null);
      return;
    }

    if (
      !selectedStrategyId ||
      !strategies.some((item) => item.id === selectedStrategyId)
    ) {
      setSelectedStrategyId(strategies[0]?.id ?? null);
    }
  }, [selectedStrategyId, strategies]);

  useEffect(() => {
    if (sessions.length === 0) {
      setSelectedSessionId(null);
      return;
    }

    if (
      !selectedSessionId ||
      !sessions.some((item) => item.id === selectedSessionId)
    ) {
      setSelectedSessionId(sessions[0]?.id ?? null);
    }
  }, [selectedSessionId, sessions]);

  useEffect(() => {
    if (watchLists.length === 0) {
      setSelectedWatchListId(null);
      return;
    }

    if (
      !selectedWatchListId ||
      !watchLists.some((item) => item.id === selectedWatchListId)
    ) {
      setSelectedWatchListId(watchLists[0]?.id ?? null);
    }
  }, [selectedWatchListId, watchLists]);

  useEffect(() => {
    if (strategyMode !== "update" || !strategyDetailQuery.data) {
      return;
    }

    const detail = strategyDetailQuery.data;

    setStrategyForm({
      name: detail.name,
      description: detail.description ?? "",
      tagsText: detail.tags.join(", "),
      isTemplate: detail.isTemplate,
      filtersJson: JSON.stringify(detail.filters, null, 2),
      scoringConfigJson: JSON.stringify(detail.scoringConfig, null, 2),
    });
  }, [strategyMode, strategyDetailQuery.data]);

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
      setEditedStockNote("");
      setEditedStockTags("");
      return;
    }

    if (
      !selectedStockCode ||
      !parsedWatchStocks.some((stock) => stock.stockCode === selectedStockCode)
    ) {
      const firstStock = parsedWatchStocks[0];
      if (!firstStock) {
        return;
      }

      setSelectedStockCode(firstStock.stockCode);
      setEditedStockNote(firstStock.note);
      setEditedStockTags(firstStock.tags.join(", "));
    }
  }, [parsedWatchStocks, selectedStockCode]);

  useEffect(() => {
    if (!selectedStockCode) {
      return;
    }

    const selectedStock = parsedWatchStocks.find(
      (stock) => stock.stockCode === selectedStockCode,
    );
    if (!selectedStock) {
      return;
    }

    setEditedStockNote(selectedStock.note);
    setEditedStockTags(selectedStock.tags.join(", "));
  }, [parsedWatchStocks, selectedStockCode]);

  const strategyPending =
    createStrategyMutation.isPending ||
    updateStrategyMutation.isPending ||
    strategyDetailQuery.isFetching;

  const watchListPending =
    createWatchListMutation.isPending ||
    updateWatchMetaMutation.isPending ||
    deleteWatchListMutation.isPending;

  async function handleSubmitStrategy() {
    let filters: CreateStrategyInput["filters"];
    let scoringConfig: CreateStrategyInput["scoringConfig"];

    try {
      const parsedFilters = filterGroupSchema.safeParse(
        JSON.parse(strategyForm.filtersJson) as unknown,
      );
      if (!parsedFilters.success) {
        setNotice({ tone: "error", text: "筛选条件 JSON 结构无效" });
        return;
      }
      filters = parsedFilters.data;
    } catch {
      setNotice({ tone: "error", text: "筛选条件 JSON 解析失败" });
      return;
    }

    try {
      const parsedScoring = scoringConfigSchema.safeParse(
        JSON.parse(strategyForm.scoringConfigJson) as unknown,
      );
      if (!parsedScoring.success) {
        setNotice({ tone: "error", text: "评分配置 JSON 结构无效" });
        return;
      }
      scoringConfig = parsedScoring.data;
    } catch {
      setNotice({ tone: "error", text: "评分配置 JSON 解析失败" });
      return;
    }

    const name = strategyForm.name.trim();
    const description = strategyForm.description.trim();

    if (!name) {
      setNotice({ tone: "error", text: "策略名称不能为空" });
      return;
    }

    const basePayload: Omit<CreateStrategyInput, "name"> & { name: string } = {
      name,
      tags: parseTags(strategyForm.tagsText),
      isTemplate: strategyForm.isTemplate,
      filters,
      scoringConfig,
    };

    if (strategyMode === "create") {
      await createStrategyMutation.mutateAsync({
        ...basePayload,
        description: description.length > 0 ? description : undefined,
      });
      return;
    }

    if (!selectedStrategyId) {
      setNotice({ tone: "error", text: "请选择要更新的策略" });
      return;
    }

    await updateStrategyMutation.mutateAsync({
      id: selectedStrategyId,
      ...basePayload,
      description,
    });
  }

  async function handleDeleteStrategy(strategy: StrategyListItem) {
    const shouldDelete = window.confirm(`确认删除策略「${strategy.name}」吗？`);
    if (!shouldDelete) {
      return;
    }

    await deleteStrategyMutation.mutateAsync({ id: strategy.id });

    if (selectedStrategyId === strategy.id) {
      setStrategyMode("create");
      setStrategyForm(createDefaultStrategyForm());
      setSelectedStrategyId(null);
    }
  }

  async function handleExecuteStrategy(strategyId: string) {
    setRunningStrategyId(strategyId);
    try {
      await executeStrategyMutation.mutateAsync({ strategyId });
    } finally {
      setRunningStrategyId(null);
    }
  }

  async function handleDeleteSession(session: SessionListItem) {
    const shouldDelete = window.confirm(
      `确认删除会话「${session.strategyName}」吗？`,
    );
    if (!shouldDelete) {
      return;
    }

    await deleteSessionMutation.mutateAsync({ id: session.id });

    if (selectedSessionId === session.id) {
      setSelectedSessionId(null);
    }
  }

  async function handleCreateWatchList() {
    const name = newWatchListName.trim();
    if (!name) {
      setNotice({ tone: "error", text: "列表名称不能为空" });
      return;
    }

    await createWatchListMutation.mutateAsync({
      name,
      description: newWatchListDescription.trim() || undefined,
    });
  }

  async function handleUpdateWatchMeta() {
    if (!selectedWatchListId) {
      setNotice({ tone: "error", text: "请先选择一个自选股列表" });
      return;
    }

    const name = watchMetaName.trim();
    const description = watchMetaDescription.trim();

    if (!name && !description) {
      setNotice({ tone: "error", text: "至少更新一个字段" });
      return;
    }

    await updateWatchMetaMutation.mutateAsync({
      id: selectedWatchListId,
      name: name || undefined,
      description: description || undefined,
    });
  }

  async function handleDeleteWatchList(item: WatchListItem) {
    const shouldDelete = window.confirm(
      `确认删除自选股列表「${item.name}」吗？`,
    );
    if (!shouldDelete) {
      return;
    }

    await deleteWatchListMutation.mutateAsync({ id: item.id });

    if (selectedWatchListId === item.id) {
      setSelectedWatchListId(null);
      setSelectedStockCode("");
    }
  }

  async function handleAddStock() {
    if (!selectedWatchListId) {
      setNotice({ tone: "error", text: "请先选择一个自选股列表" });
      return;
    }

    const stockCode = newStockCode.trim();
    const stockName = newStockName.trim();

    if (stockCode.length !== 6) {
      setNotice({ tone: "error", text: "股票代码必须为 6 位" });
      return;
    }

    if (!stockName) {
      setNotice({ tone: "error", text: "股票名称不能为空" });
      return;
    }

    await addStockMutation.mutateAsync({
      watchListId: selectedWatchListId,
      stockCode,
      stockName,
      note: newStockNote.trim() || undefined,
      tags: parseTags(newStockTags),
    });
  }

  async function handleRemoveStock(stockCode: string) {
    if (!selectedWatchListId) {
      setNotice({ tone: "error", text: "请先选择一个自选股列表" });
      return;
    }

    await removeStockMutation.mutateAsync({
      watchListId: selectedWatchListId,
      stockCode,
    });
  }

  async function handleUpdateSelectedStock() {
    if (!selectedWatchListId || !selectedStockCode) {
      setNotice({ tone: "error", text: "请选择一只股票" });
      return;
    }

    await Promise.all([
      updateStockNoteMutation.mutateAsync({
        watchListId: selectedWatchListId,
        stockCode: selectedStockCode,
        note: editedStockNote,
      }),
      updateStockTagsMutation.mutateAsync({
        watchListId: selectedWatchListId,
        stockCode: selectedStockCode,
        tags: parseTags(editedStockTags),
      }),
    ]);
  }

  const selectedSession = sessions.find(
    (item) => item.id === selectedSessionId,
  );
  const selectedWatchList = watchLists.find(
    (item) => item.id === selectedWatchListId,
  );

  return (
    <main className="market-shell px-4 py-6 font-[family-name:var(--font-body)] text-[#e8f3ff] sm:px-6 lg:px-8 lg:py-8">
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute -top-28 left-[-8%] h-72 w-72 rounded-full bg-[#32c09b]/30 blur-3xl studio-float" />
        <div
          className="absolute right-[-10%] top-[10%] h-80 w-80 rounded-full bg-[#2ea9d9]/35 blur-3xl studio-float"
          style={{ animationDelay: "-2s" }}
        />
        <div
          className="absolute bottom-[-15%] left-[20%] h-80 w-80 rounded-full bg-[#4f6dff]/32 blur-3xl studio-float"
          style={{ animationDelay: "-4s" }}
        />
      </div>

      <div className="market-frame relative flex w-full max-w-[1400px] flex-col gap-6">
        <header className="studio-rise rounded-[30px] border border-[#35526f]/35 bg-[#0d1c30]/95 p-6 shadow-[0_28px_88px_-48px_rgba(2,10,22,0.92)] backdrop-blur sm:p-8">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="font-[family-name:var(--font-display)] text-xs tracking-[0.45em] text-[#8aa5bf]">
                INVESTMENT STUDIO
              </p>
              <h1 className="mt-3 font-[family-name:var(--font-display)] text-3xl font-semibold leading-tight text-[#f0f8ff] sm:text-4xl">
                策略筛选与自选股研究台
              </h1>
              <p className="mt-3 max-w-3xl font-[family-name:var(--font-body)] text-sm leading-7 text-[#a6bdd3] sm:text-base">
                面向投资者的一站式工作台：先筛选，再复盘，再沉淀到自选清单。你可以把研究动作连成闭环，持续优化自己的投资决策。
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Link
                href="/"
                className="rounded-full border border-[#d9e8f9]/20 bg-[#0d1e31]/86 px-4 py-2 text-sm font-medium text-[#d9e8f9] transition hover:border-[#d9e8f9]/45"
              >
                返回首页
              </Link>
              <Link
                href="/workflows"
                className="rounded-full border border-[#2f8dc8]/25 bg-[#12364f]/45 px-4 py-2 text-sm font-medium text-[#89deff] transition hover:border-[#2f8dc8]/50"
              >
                行业研究任务中心
              </Link>
            </div>
          </div>
        </header>

        {notice ? (
          <p
            className={`studio-rise rounded-2xl border px-4 py-3 text-sm ${noticeClassName(notice.tone)}`}
          >
            {notice.text}
          </p>
        ) : null}

        <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <article
            className="studio-rise rounded-2xl border border-[#35526f]/35 bg-[#10243a]/88 p-4"
            style={{ animationDelay: "0.08s" }}
          >
            <p className="text-xs tracking-[0.2em] text-[#8ca7c1]">策略库</p>
            <p className="mt-2 text-3xl font-semibold text-[#f2f8ff]">
              {strategies.length}
            </p>
            <p className="mt-1 text-xs text-[#96afc7]">可复用筛选方案</p>
          </article>
          <article
            className="studio-rise rounded-2xl border border-[#35526f]/35 bg-[#10243a]/88 p-4"
            style={{ animationDelay: "0.12s" }}
          >
            <p className="text-xs tracking-[0.2em] text-[#8ca7c1]">执行记录</p>
            <p className="mt-2 text-3xl font-semibold text-[#f2f8ff]">
              {sessions.length}
            </p>
            <p className="mt-1 text-xs text-[#96afc7]">近期筛选结果</p>
          </article>
          <article
            className="studio-rise rounded-2xl border border-[#35526f]/35 bg-[#10243a]/88 p-4"
            style={{ animationDelay: "0.16s" }}
          >
            <p className="text-xs tracking-[0.2em] text-[#8ca7c1]">跟踪清单</p>
            <p className="mt-2 text-3xl font-semibold text-[#f2f8ff]">
              {watchLists.length}
            </p>
            <p className="mt-1 text-xs text-[#96afc7]">沉淀中的观察组合</p>
          </article>
          <article
            className="studio-rise rounded-2xl border border-[#35526f]/35 bg-[#081426] p-4 text-[#e9f5ff]"
            style={{ animationDelay: "0.2s" }}
          >
            <p className="text-xs tracking-[0.2em] text-[#9cb7cc]">今日建议</p>
            <p className="mt-2 text-sm leading-6 text-[#edf7ff]">
              优先执行近期回撤后的策略，观察命中标的的估值与盈利匹配度。
            </p>
            <p className="mt-1 text-xs text-[#9cb6cc]">
              执行后可直接加入自选清单
            </p>
          </article>
        </section>

        <div className="grid gap-6 xl:grid-cols-[1.25fr_1fr]">
          <section
            className="studio-rise rounded-[26px] border border-[#35526f]/35 bg-[#0d1e33]/95 p-5 shadow-[0_24px_78px_-44px_rgba(2,10,22,0.9)] sm:p-6"
            style={{ animationDelay: "0.2s" }}
          >
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 className="font-[family-name:var(--font-display)] text-2xl text-[#e9f4ff]">
                第一步：制定并执行策略
              </h2>
              <button
                type="button"
                onClick={() => {
                  setStrategyMode("create");
                  setStrategyForm(createDefaultStrategyForm());
                }}
                className="rounded-full border border-[#d2e5f9]/20 bg-[#0f2137]/88 px-3 py-1.5 text-xs font-medium text-[#d2e5f9] transition hover:border-[#d2e5f9]/45"
              >
                新建策略
              </button>
            </div>

            <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {strategiesQuery.isLoading ? (
                <p className="text-sm text-[#8ea8c1]">策略加载中...</p>
              ) : strategies.length === 0 ? (
                <p className="text-sm text-[#8ea8c1]">暂无策略，请先创建。</p>
              ) : (
                strategies.map((strategy) => {
                  const active = strategy.id === selectedStrategyId;
                  return (
                    <article
                      key={strategy.id}
                      className={`rounded-2xl border p-4 transition ${
                        active
                          ? "border-[#49ddb8] bg-[#123f35]"
                          : "border-[#35526f]/35 bg-[#10253c]/90 hover:border-[#35526f]/30"
                      }`}
                    >
                      <button
                        type="button"
                        onClick={() => setSelectedStrategyId(strategy.id)}
                        className="w-full text-left"
                      >
                        <p className="truncate text-sm font-semibold text-[#eff8ff]">
                          {strategy.name}
                        </p>
                        <p className="mt-1 line-clamp-2 min-h-9 text-xs text-[#97afc7]">
                          {strategy.description ?? "无描述"}
                        </p>
                      </button>

                      <div className="mt-3 flex flex-wrap gap-1">
                        {strategy.tags.length === 0 ? (
                          <span className="rounded-full border border-[#e1eeff]/28 px-2 py-0.5 text-[11px] text-[#91aac2]">
                            无标签
                          </span>
                        ) : (
                          strategy.tags.map((tag) => (
                            <span
                              key={`${strategy.id}-${tag}`}
                              className="rounded-full border border-[#e1eeff]/28 px-2 py-0.5 text-[11px] text-[#91aac2]"
                            >
                              {tag}
                            </span>
                          ))
                        )}
                        {strategy.isTemplate ? (
                          <span className="rounded-full border border-[#37a8df]/30 bg-[#133a53] px-2 py-0.5 text-[11px] text-[#67d3ff]">
                            模板
                          </span>
                        ) : null}
                      </div>

                      <div className="mt-4 flex flex-wrap gap-2 text-xs">
                        <button
                          type="button"
                          onClick={() => {
                            setSelectedStrategyId(strategy.id);
                            setStrategyMode("update");
                          }}
                          className="rounded-full border border-[#e1eeff]/34 px-3 py-1 transition hover:border-[#e1eeff]/45"
                        >
                          编辑
                        </button>
                        <button
                          type="button"
                          onClick={() => handleExecuteStrategy(strategy.id)}
                          disabled={
                            executeStrategyMutation.isPending ||
                            runningStrategyId === strategy.id
                          }
                          className="rounded-full border border-[#2fa889]/25 bg-[#103830] px-3 py-1 text-[#5cefc4] transition hover:border-[#2fa889]/45 disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          {runningStrategyId === strategy.id
                            ? "执行中"
                            : "执行"}
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDeleteStrategy(strategy)}
                          disabled={deleteStrategyMutation.isPending}
                          className="rounded-full border border-[#ff8d9b]/25 bg-[#4b2331] px-3 py-1 text-[#ff8d9b] transition hover:border-[#ff8d9b]/45 disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          删除
                        </button>
                      </div>
                    </article>
                  );
                })
              )}
            </div>

            <section className="mt-6 rounded-2xl border border-[#35526f]/35 bg-[#10253c]/90 p-4 sm:p-5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h3 className="text-lg font-semibold text-[#e9f4ff]">
                  {strategyMode === "create" ? "策略信息" : "编辑策略"}
                </h3>
                {strategyMode === "update" ? (
                  <button
                    type="button"
                    onClick={() => {
                      setStrategyMode("create");
                      setStrategyForm(createDefaultStrategyForm());
                    }}
                    className="rounded-full border border-[#e1eeff]/34 px-3 py-1 text-xs text-[#97afc7] transition hover:border-[#e1eeff]/45"
                  >
                    新建模式
                  </button>
                ) : null}
              </div>
              <p className="mt-2 text-xs leading-5 text-[#91aac2]">
                先填写策略名称、标签和描述即可保存；JSON
                区域用于高级规则配置，默认模板可直接执行。
              </p>

              <div className="mt-4 grid gap-3 lg:grid-cols-2">
                <label className="text-xs text-[#97b0c9]">
                  策略名称
                  <input
                    value={strategyForm.name}
                    onChange={(event) =>
                      setStrategyForm((previous) => ({
                        ...previous,
                        name: event.target.value,
                      }))
                    }
                    className="mt-1 w-full rounded-xl border border-[#e1eeff]/34 bg-[#0a1a2d] px-3 py-2 text-sm text-[#e1eeff] outline-none transition focus:border-[#43bee9]"
                  />
                </label>
                <label className="text-xs text-[#97b0c9]">
                  标签（逗号分隔）
                  <input
                    value={strategyForm.tagsText}
                    onChange={(event) =>
                      setStrategyForm((previous) => ({
                        ...previous,
                        tagsText: event.target.value,
                      }))
                    }
                    className="mt-1 w-full rounded-xl border border-[#e1eeff]/34 bg-[#0a1a2d] px-3 py-2 text-sm text-[#e1eeff] outline-none transition focus:border-[#43bee9]"
                  />
                </label>
                <label className="text-xs text-[#97b0c9] lg:col-span-2">
                  描述
                  <textarea
                    value={strategyForm.description}
                    onChange={(event) =>
                      setStrategyForm((previous) => ({
                        ...previous,
                        description: event.target.value,
                      }))
                    }
                    rows={3}
                    className="mt-1 w-full rounded-xl border border-[#e1eeff]/34 bg-[#0a1a2d] px-3 py-2 text-sm text-[#e1eeff] outline-none transition focus:border-[#43bee9]"
                  />
                </label>
              </div>

              <label className="mt-3 flex items-center gap-2 text-xs text-[#97b0c9]">
                <input
                  type="checkbox"
                  checked={strategyForm.isTemplate}
                  onChange={(event) =>
                    setStrategyForm((previous) => ({
                      ...previous,
                      isTemplate: event.target.checked,
                    }))
                  }
                  className="h-4 w-4 rounded border-[#e1eeff]/38"
                />
                设为模板策略
              </label>

              <div className="mt-4 grid gap-3 lg:grid-cols-2">
                <label className="text-xs text-[#97b0c9]">
                  高级筛选规则 JSON
                  <textarea
                    value={strategyForm.filtersJson}
                    onChange={(event) =>
                      setStrategyForm((previous) => ({
                        ...previous,
                        filtersJson: event.target.value,
                      }))
                    }
                    rows={14}
                    className="mt-1 w-full rounded-xl border border-[#e1eeff]/34 bg-[#09192e] px-3 py-2 font-mono text-xs leading-6 text-[#d8ecff] outline-none transition focus:border-[#5addff]"
                  />
                </label>

                <label className="text-xs text-[#97b0c9]">
                  高级评分规则 JSON
                  <textarea
                    value={strategyForm.scoringConfigJson}
                    onChange={(event) =>
                      setStrategyForm((previous) => ({
                        ...previous,
                        scoringConfigJson: event.target.value,
                      }))
                    }
                    rows={14}
                    className="mt-1 w-full rounded-xl border border-[#e1eeff]/34 bg-[#09192e] px-3 py-2 font-mono text-xs leading-6 text-[#d8ecff] outline-none transition focus:border-[#5addff]"
                  />
                </label>
              </div>

              <button
                type="button"
                onClick={handleSubmitStrategy}
                disabled={strategyPending}
                className="mt-4 rounded-xl border border-[#e1eeff]/34 bg-[#0f8468] px-4 py-2 text-sm font-semibold text-[#eefef8] transition hover:bg-[#0d5b49] disabled:cursor-not-allowed disabled:opacity-65"
              >
                {strategyPending
                  ? "提交中..."
                  : strategyMode === "create"
                    ? "保存策略"
                    : "保存更新"}
              </button>
              {strategyDetailQuery.error ? (
                <p className="mt-3 rounded-xl border border-[#ff7f92]/45 bg-[#5b2432]/50 px-3 py-2 text-xs text-[#ffbec9]">
                  {strategyDetailQuery.error.message}
                </p>
              ) : null}
            </section>

            <section className="mt-6 rounded-2xl border border-[#35526f]/35 bg-[#0f2238] p-4 sm:p-5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="text-lg font-semibold text-[#e9f4ff]">
                  第二步：查看执行结果
                </h3>
                <button
                  type="button"
                  onClick={() => sessionsQuery.refetch()}
                  className="rounded-full border border-[#e1eeff]/34 px-3 py-1 text-xs text-[#97afc7] transition hover:border-[#e1eeff]/45"
                >
                  刷新会话
                </button>
              </div>

              <div className="mt-4 grid gap-3 lg:grid-cols-[0.95fr_1.05fr]">
                <div className="max-h-[420px] space-y-2 overflow-auto pr-1">
                  {sessionsQuery.isLoading ? (
                    <p className="text-sm text-[#8ea8c1]">会话加载中...</p>
                  ) : sessions.length === 0 ? (
                    <p className="text-sm text-[#8ea8c1]">
                      暂无会话，先执行一个策略。
                    </p>
                  ) : (
                    sessions.map((session) => {
                      const active = session.id === selectedSessionId;
                      return (
                        <article
                          key={session.id}
                          className={`rounded-xl border px-3 py-3 ${
                            active
                              ? "border-[#3dd3b5] bg-[#113d37]"
                              : "border-[#35526f]/35 bg-[#10253c]/90"
                          }`}
                        >
                          <button
                            type="button"
                            className="w-full text-left"
                            onClick={() => setSelectedSessionId(session.id)}
                          >
                            <p className="truncate text-sm font-medium text-[#e1eeff]">
                              {session.strategyName}
                            </p>
                            <p className="mt-1 text-xs text-[#92abc3]">
                              扫描 {session.totalScanned} · 命中{" "}
                              {session.matchedCount} ·{" "}
                              {formatDate(session.executedAt)}
                            </p>
                          </button>
                          <div className="mt-2 flex justify-end">
                            <button
                              type="button"
                              onClick={() => handleDeleteSession(session)}
                              disabled={deleteSessionMutation.isPending}
                              className="rounded-full border border-[#ff8d9b]/25 bg-[#4b2331] px-2.5 py-1 text-[11px] text-[#ff8d9b] transition hover:border-[#ff8d9b]/45 disabled:cursor-not-allowed disabled:opacity-60"
                            >
                              删除
                            </button>
                          </div>
                        </article>
                      );
                    })
                  )}
                </div>

                <div className="rounded-xl border border-[#35526f]/35 bg-[#10263d]/94 p-3">
                  {!selectedSession ? (
                    <p className="text-sm text-[#8ea8c1]">
                      请选择会话查看详情。
                    </p>
                  ) : sessionDetailQuery.isLoading ? (
                    <p className="text-sm text-[#8ea8c1]">会话详情加载中...</p>
                  ) : sessionDetailQuery.error ? (
                    <p className="rounded-lg border border-[#ff7f92]/45 bg-[#5b2432]/50 px-3 py-2 text-xs text-[#ffbec9]">
                      {sessionDetailQuery.error.message}
                    </p>
                  ) : (
                    <>
                      <div className="grid grid-cols-2 gap-2 text-xs text-[#a1b8ce]">
                        <p className="rounded-lg border border-[#e1eeff]/38 bg-[#11253b] px-3 py-2">
                          策略: {selectedSession.strategyName}
                        </p>
                        <p className="rounded-lg border border-[#e1eeff]/38 bg-[#11253b] px-3 py-2">
                          执行耗时: {selectedSession.executionTime.toFixed(2)} s
                        </p>
                        <p className="rounded-lg border border-[#e1eeff]/38 bg-[#11253b] px-3 py-2">
                          总扫描: {selectedSession.totalScanned}
                        </p>
                        <p className="rounded-lg border border-[#e1eeff]/38 bg-[#11253b] px-3 py-2">
                          命中: {selectedSession.matchedCount}
                        </p>
                      </div>

                      <h4 className="mt-4 text-sm font-semibold text-[#e4f1ff]">
                        优先关注标的
                      </h4>
                      {parsedTopStocks.length === 0 ? (
                        <p className="mt-2 text-xs text-[#92abc3]">
                          暂无评分明细。
                        </p>
                      ) : (
                        <div className="mt-2 max-h-[280px] overflow-auto rounded-lg border border-[#35526f]/35">
                          <table className="min-w-full border-collapse text-left text-xs">
                            <thead className="sticky top-0 bg-[#122b42] text-[#b7cee5]">
                              <tr>
                                <th className="px-3 py-2 font-medium">代码</th>
                                <th className="px-3 py-2 font-medium">名称</th>
                                <th className="px-3 py-2 font-medium">评分</th>
                                <th className="px-3 py-2 font-medium">
                                  指标快照
                                </th>
                              </tr>
                            </thead>
                            <tbody>
                              {parsedTopStocks.map((stock) => (
                                <tr
                                  key={`${stock.stockCode}-${stock.stockName}`}
                                  className="border-t border-[#35526f]/35"
                                >
                                  <td className="px-3 py-2 text-[#e1eeff]">
                                    {stock.stockCode}
                                  </td>
                                  <td className="px-3 py-2 text-[#e1eeff]">
                                    {stock.stockName}
                                  </td>
                                  <td className="px-3 py-2 text-[#58e8bf]">
                                    {stock.score.toFixed(4)}
                                  </td>
                                  <td className="px-3 py-2 text-[#92abc3]">
                                    <p className="line-clamp-2">
                                      {stock.indicatorPreview}
                                    </p>
                                    {stock.explanations.length > 0 ? (
                                      <p className="mt-1 line-clamp-2 text-[11px] text-[#80b4d8]">
                                        {stock.explanations.join(" | ")}
                                      </p>
                                    ) : null}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </>
                  )}
                </div>
              </div>
            </section>
          </section>

          <section
            className="studio-rise rounded-[26px] border border-[#35526f]/35 bg-[#0d1e33]/95 p-5 shadow-[0_24px_78px_-44px_rgba(2,10,22,0.9)] sm:p-6"
            style={{ animationDelay: "0.3s" }}
          >
            <h2 className="font-[family-name:var(--font-display)] text-2xl text-[#e9f4ff]">
              第三步：维护跟踪清单
            </h2>

            <section className="mt-4 rounded-2xl border border-[#35526f]/35 bg-[#10253c]/90 p-4">
              <h3 className="text-base font-semibold text-[#e1eeff]">
                创建新清单
              </h3>
              <div className="mt-3 grid gap-2">
                <input
                  value={newWatchListName}
                  onChange={(event) => setNewWatchListName(event.target.value)}
                  placeholder="例如：高确定性组合"
                  className="rounded-xl border border-[#e1eeff]/34 bg-[#0a1a2d] px-3 py-2 text-sm outline-none transition focus:border-[#43bee9]"
                />
                <input
                  value={newWatchListDescription}
                  onChange={(event) =>
                    setNewWatchListDescription(event.target.value)
                  }
                  placeholder="组合说明"
                  className="rounded-xl border border-[#e1eeff]/34 bg-[#0a1a2d] px-3 py-2 text-sm outline-none transition focus:border-[#43bee9]"
                />
                <button
                  type="button"
                  onClick={handleCreateWatchList}
                  disabled={watchListPending}
                  className="rounded-xl border border-[#e1eeff]/34 bg-[#2582b5] px-4 py-2 text-sm font-medium text-[#e8f6ff] transition hover:bg-[#1d6f9f] disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {createWatchListMutation.isPending ? "创建中..." : "创建清单"}
                </button>
              </div>
            </section>

            <section className="mt-4 rounded-2xl border border-[#35526f]/35 bg-[#10253c]/90 p-4">
              <h3 className="text-base font-semibold text-[#e1eeff]">
                清单列表
              </h3>
              <div className="mt-3 grid max-h-52 gap-2 overflow-auto pr-1">
                {watchListsQuery.isLoading ? (
                  <p className="text-sm text-[#8ea8c1]">列表加载中...</p>
                ) : watchLists.length === 0 ? (
                  <p className="text-sm text-[#8ea8c1]">暂无自选股列表。</p>
                ) : (
                  watchLists.map((item) => {
                    const active = item.id === selectedWatchListId;
                    return (
                      <article
                        key={item.id}
                        className={`rounded-xl border p-3 ${
                          active
                            ? "border-[#37a8df] bg-[#123346]"
                            : "border-[#35526f]/35 bg-[#0a1a2d]"
                        }`}
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
                        <div className="mt-2 flex justify-end">
                          <button
                            type="button"
                            onClick={() => handleDeleteWatchList(item)}
                            disabled={deleteWatchListMutation.isPending}
                            className="rounded-full border border-[#ff8d9b]/25 bg-[#4b2331] px-2.5 py-1 text-[11px] text-[#ff8d9b] transition hover:border-[#ff8d9b]/45 disabled:cursor-not-allowed disabled:opacity-60"
                          >
                            删除
                          </button>
                        </div>
                      </article>
                    );
                  })
                )}
              </div>
            </section>

            <section className="mt-4 rounded-2xl border border-[#35526f]/35 bg-[#10253c]/90 p-4">
              <h3 className="text-base font-semibold text-[#e1eeff]">
                清单信息编辑
              </h3>
              {selectedWatchList ? (
                <>
                  <div className="mt-3 grid gap-2">
                    <input
                      value={watchMetaName}
                      onChange={(event) => setWatchMetaName(event.target.value)}
                      className="rounded-xl border border-[#e1eeff]/34 bg-[#0a1a2d] px-3 py-2 text-sm outline-none transition focus:border-[#43bee9]"
                    />
                    <input
                      value={watchMetaDescription}
                      onChange={(event) =>
                        setWatchMetaDescription(event.target.value)
                      }
                      className="rounded-xl border border-[#e1eeff]/34 bg-[#0a1a2d] px-3 py-2 text-sm outline-none transition focus:border-[#43bee9]"
                    />
                    <button
                      type="button"
                      onClick={handleUpdateWatchMeta}
                      disabled={updateWatchMetaMutation.isPending}
                      className="rounded-xl border border-[#e1eeff]/34 bg-[#11916f] px-4 py-2 text-sm font-medium text-[#ecfff8] transition hover:bg-[#0f6f58] disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      更新列表信息
                    </button>
                  </div>

                  <div className="mt-4 border-t border-[#35526f]/35 pt-4">
                    <h4 className="text-sm font-semibold text-[#e6f2ff]">
                      添加标的
                    </h4>
                    <div className="mt-2 grid gap-2 sm:grid-cols-2">
                      <input
                        value={newStockCode}
                        onChange={(event) =>
                          setNewStockCode(event.target.value)
                        }
                        placeholder="股票代码（6位）"
                        className="rounded-xl border border-[#e1eeff]/34 bg-[#0a1a2d] px-3 py-2 text-sm outline-none transition focus:border-[#43bee9]"
                      />
                      <input
                        value={newStockName}
                        onChange={(event) =>
                          setNewStockName(event.target.value)
                        }
                        placeholder="股票名称"
                        className="rounded-xl border border-[#e1eeff]/34 bg-[#0a1a2d] px-3 py-2 text-sm outline-none transition focus:border-[#43bee9]"
                      />
                      <input
                        value={newStockTags}
                        onChange={(event) =>
                          setNewStockTags(event.target.value)
                        }
                        placeholder="标签：成长, 跟踪"
                        className="rounded-xl border border-[#e1eeff]/34 bg-[#0a1a2d] px-3 py-2 text-sm outline-none transition focus:border-[#43bee9]"
                      />
                      <input
                        value={newStockNote}
                        onChange={(event) =>
                          setNewStockNote(event.target.value)
                        }
                        placeholder="备注"
                        className="rounded-xl border border-[#e1eeff]/34 bg-[#0a1a2d] px-3 py-2 text-sm outline-none transition focus:border-[#43bee9]"
                      />
                    </div>
                    <button
                      type="button"
                      onClick={handleAddStock}
                      disabled={addStockMutation.isPending}
                      className="mt-2 rounded-xl border border-[#e1eeff]/34 bg-[#227cae] px-4 py-2 text-sm font-medium text-[#e8f6ff] transition hover:bg-[#1b6f9f] disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      添加到清单
                    </button>
                  </div>

                  <div className="mt-4 border-t border-[#35526f]/35 pt-4">
                    <h4 className="text-sm font-semibold text-[#e6f2ff]">
                      更新选中标的
                    </h4>
                    {parsedWatchStocks.length === 0 ? (
                      <p className="mt-2 text-xs text-[#92abc3]">
                        列表为空，先添加股票。
                      </p>
                    ) : (
                      <>
                        <select
                          value={selectedStockCode}
                          onChange={(event) =>
                            setSelectedStockCode(event.target.value)
                          }
                          className="mt-2 w-full rounded-xl border border-[#e1eeff]/34 bg-[#0a1a2d] px-3 py-2 text-sm outline-none transition focus:border-[#43bee9]"
                        >
                          {parsedWatchStocks.map((stock) => (
                            <option
                              key={`selector-${stock.stockCode}`}
                              value={stock.stockCode}
                            >
                              {stock.stockCode} {stock.stockName}
                            </option>
                          ))}
                        </select>
                        <div className="mt-2 grid gap-2">
                          <input
                            value={editedStockTags}
                            onChange={(event) =>
                              setEditedStockTags(event.target.value)
                            }
                            placeholder="标签（逗号分隔）"
                            className="rounded-xl border border-[#e1eeff]/34 bg-[#0a1a2d] px-3 py-2 text-sm outline-none transition focus:border-[#43bee9]"
                          />
                          <input
                            value={editedStockNote}
                            onChange={(event) =>
                              setEditedStockNote(event.target.value)
                            }
                            placeholder="备注"
                            className="rounded-xl border border-[#e1eeff]/34 bg-[#0a1a2d] px-3 py-2 text-sm outline-none transition focus:border-[#43bee9]"
                          />
                        </div>
                        <button
                          type="button"
                          onClick={handleUpdateSelectedStock}
                          disabled={
                            updateStockNoteMutation.isPending ||
                            updateStockTagsMutation.isPending
                          }
                          className="mt-2 rounded-xl border border-[#e1eeff]/34 bg-[#11916f] px-4 py-2 text-sm font-medium text-[#ecfff8] transition hover:bg-[#0f6f58] disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          保存备注与标签
                        </button>
                      </>
                    )}
                  </div>
                </>
              ) : (
                <p className="mt-2 text-sm text-[#8ea8c1]">
                  请选择一个自选股列表。
                </p>
              )}
            </section>

            <section className="mt-4 rounded-2xl border border-[#35526f]/35 bg-[#10253c]/90 p-4">
              <h3 className="text-base font-semibold text-[#e1eeff]">
                清单明细
              </h3>
              {watchListDetailQuery.isLoading ? (
                <p className="mt-2 text-sm text-[#8ea8c1]">列表详情加载中...</p>
              ) : watchListDetailQuery.error ? (
                <p className="mt-2 rounded-lg border border-[#ff7f92]/45 bg-[#5b2432]/50 px-3 py-2 text-xs text-[#ffbec9]">
                  {watchListDetailQuery.error.message}
                </p>
              ) : parsedWatchStocks.length === 0 ? (
                <p className="mt-2 text-sm text-[#8ea8c1]">
                  当前列表暂无股票。
                </p>
              ) : (
                <div className="mt-2 max-h-[380px] overflow-auto rounded-lg border border-[#35526f]/35">
                  <table className="min-w-full border-collapse text-left text-xs">
                    <thead className="sticky top-0 bg-[#122b42] text-[#b7cee5]">
                      <tr>
                        <th className="px-3 py-2 font-medium">代码</th>
                        <th className="px-3 py-2 font-medium">名称</th>
                        <th className="px-3 py-2 font-medium">标签</th>
                        <th className="px-3 py-2 font-medium">备注</th>
                        <th className="px-3 py-2 font-medium">时间</th>
                        <th className="px-3 py-2 font-medium">操作</th>
                      </tr>
                    </thead>
                    <tbody>
                      {parsedWatchStocks.map((stock) => (
                        <tr
                          key={`watch-${stock.stockCode}`}
                          className="border-t border-[#35526f]/35"
                        >
                          <td className="px-3 py-2 text-[#e1eeff]">
                            {stock.stockCode}
                          </td>
                          <td className="px-3 py-2 text-[#e1eeff]">
                            {stock.stockName}
                          </td>
                          <td className="px-3 py-2 text-[#92abc3]">
                            {stock.tags.join(" / ") || "-"}
                          </td>
                          <td className="px-3 py-2 text-[#92abc3]">
                            {stock.note || "-"}
                          </td>
                          <td className="px-3 py-2 text-[#92abc3]">
                            {formatDate(stock.addedAt)}
                          </td>
                          <td className="px-3 py-2">
                            <button
                              type="button"
                              onClick={() => handleRemoveStock(stock.stockCode)}
                              disabled={removeStockMutation.isPending}
                              className="rounded-full border border-[#ff8d9b]/25 bg-[#4b2331] px-2.5 py-1 text-[11px] text-[#ff8d9b] transition hover:border-[#ff8d9b]/45 disabled:cursor-not-allowed disabled:opacity-60"
                            >
                              移除
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          </section>
        </div>

        {(strategiesQuery.error ||
          sessionsQuery.error ||
          watchListsQuery.error) && (
          <section className="rounded-2xl border border-[#ff7f92]/45 bg-[#5b2432]/50 px-4 py-3 text-sm text-[#ffbec9]">
            <p>
              数据加载异常：
              {strategiesQuery.error?.message ??
                sessionsQuery.error?.message ??
                watchListsQuery.error?.message}
            </p>
            <p className="mt-1 text-xs text-[#ff9aac]">
              如果提示未授权，请先回首页登录账号后重试。
            </p>
          </section>
        )}

        {selectedSession ? (
          <section className="rounded-2xl border border-[#35526f]/35 bg-[#0f2137]/88 px-4 py-3 text-xs text-[#92abc3]">
            当前结果查看状态:
            <span
              className={`ml-2 font-semibold ${statusClassName(
                sessionDetailQuery.data ? "SUCCEEDED" : "PENDING",
              )}`}
            >
              {sessionDetailQuery.data ? "已加载" : "加载中"}
            </span>
            <span className="ml-2">
              ({selectedSession.strategyName} /{" "}
              {formatDate(selectedSession.executedAt)})
            </span>
          </section>
        ) : null}
      </div>
    </main>
  );
}
