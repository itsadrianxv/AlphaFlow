import ExcelJS from "exceljs";

type RuleMetadata = {
  id: string;
  name: string;
  points: number;
  condition?: unknown;
};

type ScoreRow = {
  stockCode: string;
  stockName: string;
  rank: number;
  selected: boolean;
  evaluationStatus: string;
  score: number;
  maxScore: number;
  ruleResults: unknown;
};

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function safeCell(value: unknown) {
  const text =
    typeof value === "string"
      ? value
      : value == null
        ? ""
        : JSON.stringify(value);
  return /^[=+\-@]/.test(text) ? `'${text}` : text;
}

function observationText(value: unknown) {
  const observations = record(record(value).observations);
  return Object.entries(observations)
    .map(([metric, observation]) => {
      const values = record(observation);
      const previous = values.previous === undefined ? "" : `, previous=${String(values.previous)}`;
      return `${metric}: current=${String(values.current ?? "-")}${previous}`;
    })
    .join("; ");
}

export async function buildScoringWorkbook(params: {
  taskName: string;
  executionId: string;
  scheduledAt: Date;
  summary: Record<string, unknown>;
  rules: RuleMetadata[];
  rows: ScoreRow[];
}) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "AlphaFlow";
  workbook.created = new Date();

  const overview = workbook.addWorksheet("评分总览", {
    views: [{ state: "frozen", ySplit: 1, xSplit: 7 }],
  });
  overview.columns = [
    { header: "排名", key: "rank", width: 10 },
    { header: "是否入选", key: "selected", width: 12 },
    { header: "股票代码", key: "stockCode", width: 14 },
    { header: "股票名称", key: "stockName", width: 18 },
    { header: "评估状态", key: "evaluationStatus", width: 16 },
    { header: "总分", key: "score", width: 12 },
    { header: "最高分", key: "maxScore", width: 12 },
    ...params.rules.flatMap((rule) => [
      { header: `${rule.name}-状态`, key: `${rule.id}:status`, width: 18 },
      { header: `${rule.name}-得分`, key: `${rule.id}:score`, width: 16 },
      { header: `${rule.name}-观测值`, key: `${rule.id}:observations`, width: 42 },
    ]),
  ];
  overview.getRow(1).font = { bold: true };
  overview.autoFilter = { from: "A1", to: overview.getRow(1).getCell(overview.columnCount).address };
  for (const item of params.rows) {
    const ruleResults = record(item.ruleResults);
    const row: Record<string, unknown> = {
      rank: item.rank,
      selected: item.selected ? "是" : "否",
      stockCode: safeCell(item.stockCode),
      stockName: safeCell(item.stockName),
      evaluationStatus: item.evaluationStatus,
      score: item.score,
      maxScore: item.maxScore,
    };
    for (const rule of params.rules) {
      const result = record(ruleResults[rule.id]);
      row[`${rule.id}:status`] = result.status ?? "NOT_EVALUATED";
      row[`${rule.id}:score`] = result.awardedPoints ?? 0;
      row[`${rule.id}:observations`] = safeCell(observationText(result));
    }
    overview.addRow(row);
  }

  const rules = workbook.addWorksheet("规则说明");
  rules.columns = [
    { header: "顺序", key: "order", width: 10 },
    { header: "规则ID", key: "id", width: 28 },
    { header: "规则名称", key: "name", width: 30 },
    { header: "分值", key: "points", width: 12 },
    { header: "条件", key: "condition", width: 80 },
  ];
  rules.getRow(1).font = { bold: true };
  params.rules.forEach((rule, index) =>
    rules.addRow({ ...rule, order: index + 1, condition: safeCell(rule.condition) }),
  );

  const info = workbook.addWorksheet("执行信息");
  info.columns = [
    { header: "字段", key: "field", width: 28 },
    { header: "值", key: "value", width: 100 },
  ];
  info.getRow(1).font = { bold: true };
  const values: Record<string, unknown> = {
    taskName: params.taskName,
    executionId: params.executionId,
    scheduledAt: params.scheduledAt.toISOString(),
    ...params.summary,
  };
  for (const [field, value] of Object.entries(values))
    info.addRow({ field, value: safeCell(value) });

  return workbook.xlsx.writeBuffer();
}
