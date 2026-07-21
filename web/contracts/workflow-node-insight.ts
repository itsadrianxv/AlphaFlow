import { z } from "zod";

const textValueSchema = z.object({
  kind: z.literal("text"),
  text: z.string().trim().min(1).max(4000),
});

const listValueSchema = z.object({
  kind: z.literal("list"),
  items: z.array(z.string().trim().min(1).max(1200)).min(1).max(30),
});

const keyValueSchema = z.object({
  label: z.string().trim().min(1).max(120),
  value: z.string().trim().min(1).max(1200),
});

const keyValueListSchema = z.object({
  kind: z.literal("key_values"),
  items: z.array(keyValueSchema).min(1).max(30),
});

const tableValueSchema = z.object({
  kind: z.literal("table"),
  columns: z.array(z.string().trim().min(1).max(120)).min(1).max(8),
  rows: z
    .array(z.array(z.string().trim().max(1200)).min(1).max(8))
    .min(1)
    .max(30),
});

export const workflowNodeInsightValueSchema = z.discriminatedUnion("kind", [
  textValueSchema,
  listValueSchema,
  keyValueListSchema,
  tableValueSchema,
]);

export const workflowNodeInsightCitationSchema = z.object({
  referenceId: z.string().trim().min(1).max(160),
  label: z.string().trim().min(1).max(240),
  url: z.string().url().optional(),
});

export const workflowNodeInsightFieldSchema = z.object({
  label: z.string().trim().min(1).max(120),
  value: workflowNodeInsightValueSchema,
  citations: z.array(workflowNodeInsightCitationSchema).max(12).optional(),
});

export const workflowNodeInsightSchema = z.object({
  summary: z.string().trim().min(1).max(1200).optional(),
  fields: z.array(workflowNodeInsightFieldSchema).min(1).max(20),
  downstreamNote: z.string().trim().min(1).max(1600).optional(),
});

export type WorkflowNodeInsight = z.infer<typeof workflowNodeInsightSchema>;
export type WorkflowNodeInsightField = z.infer<
  typeof workflowNodeInsightFieldSchema
>;

export function parseWorkflowNodeInsight(value: unknown) {
  return workflowNodeInsightSchema.safeParse(value);
}

const labelMap: Record<string, string> = {
  analysisDepth: "分析深度",
  autoEscalated: "是否升级研究深度",
  autoEscalationReason: "升级原因",
  candidateCount: "候选标的数量",
  clarificationRequest: "澄清请求",
  collectionSummary: "信源汇总",
  compressedFindings: "压缩结论",
  confidenceStatus: "置信度状态",
  contractScore: "任务契约评分",
  credibilityCount: "可信度评估数量",
  evidenceCount: "证据数量",
  finalReport: "阶段报告",
  findingCount: "问题回答数量",
  firstPartyCount: "一手信源数量",
  firstPartySeedCount: "一手信源种子数量",
  gapAnalysis: "信息缺口",
  groundedSources: "已确认信源",
  heatAnalysis: "行业热度判断",
  industryOverview: "行业概览",
  missingRequirements: "未满足要求",
  plannedUnitCount: "计划研究单元",
  qualityFlags: "质量提示",
  questionCount: "研究问题数量",
  referenceCount: "参考文献数量",
  reflection: "研究复盘",
  replanCount: "重规划次数",
  researchBrief: "研究简报",
  structuredModelFinal: "最终推理模型",
  structuredModelInitial: "初始推理模型",
  taskContract: "研究约束",
};

function labelFor(key: string) {
  return labelMap[key] ?? key.replace(/([a-z])([A-Z])/g, "$1 $2");
}

function displayScalar(value: unknown) {
  if (typeof value === "string") {
    return value.trim();
  }
  if (typeof value === "number") {
    return String(value);
  }
  if (typeof value === "boolean") {
    return value ? "是" : "否";
  }
  return undefined;
}

function summarizeRecord(record: Record<string, unknown>) {
  const items = Object.entries(record)
    .map(([key, value]) => {
      const scalar = displayScalar(value);
      if (scalar) {
        return { label: labelFor(key), value: scalar };
      }

      if (Array.isArray(value)) {
        return { label: labelFor(key), value: `${value.length} 项` };
      }

      if (value && typeof value === "object") {
        return { label: labelFor(key), value: "已生成结构化结果" };
      }

      return undefined;
    })
    .filter((item): item is { label: string; value: string } => Boolean(item));

  return items.slice(0, 30);
}

function valueFor(value: unknown): WorkflowNodeInsightField["value"] | null {
  const scalar = displayScalar(value);
  if (scalar) {
    return { kind: "text", text: scalar };
  }

  if (Array.isArray(value)) {
    const items = value
      .map((item) => {
        const itemScalar = displayScalar(item);
        if (itemScalar) {
          return itemScalar;
        }
        if (item && typeof item === "object" && !Array.isArray(item)) {
          const entries = summarizeRecord(item as Record<string, unknown>);
          return entries
            .map((entry) => `${entry.label}：${entry.value}`)
            .join("；");
        }
        return undefined;
      })
      .filter((item): item is string => Boolean(item));

    return items.length > 0
      ? { kind: "list", items: items.slice(0, 30) }
      : null;
  }

  if (value && typeof value === "object") {
    const items = summarizeRecord(value as Record<string, unknown>);
    return items.length > 0 ? { kind: "key_values", items } : null;
  }

  return null;
}

/** Converts verified node output into a presentation fallback without adding a model call. */
export function buildWorkflowNodeInsightFromOutput(
  output: Record<string, unknown>,
) {
  const fields = Object.entries(output)
    .filter(([key]) => key !== "insight")
    .map(([key, value]) => {
      const displayValue = valueFor(value);
      return displayValue
        ? { label: labelFor(key), value: displayValue }
        : null;
    })
    .filter((item): item is WorkflowNodeInsightField => Boolean(item));

  return fields.length > 0
    ? ({ fields } satisfies WorkflowNodeInsight)
    : undefined;
}

type CitationSource = {
  label: string;
  url?: string;
};

function collectCitationSources(
  value: unknown,
  sources: Map<string, CitationSource>,
): void {
  if (Array.isArray(value)) {
    for (const item of value) {
      collectCitationSources(item, sources);
    }
    return;
  }

  if (!value || typeof value !== "object") {
    return;
  }

  const record = value as Record<string, unknown>;
  const referenceId =
    displayScalar(record.referenceId) ?? displayScalar(record.id);
  const url = displayScalar(record.url);
  const title =
    displayScalar(record.title) ??
    displayScalar(record.sourceName) ??
    displayScalar(record.label);

  if (referenceId && title) {
    sources.set(referenceId, {
      label: title,
      url: url && /^https?:\/\//i.test(url) ? url : undefined,
    });
  }

  for (const [key, nested] of Object.entries(record)) {
    if (key !== "insight") {
      collectCitationSources(nested, sources);
    }
  }
}

function resolveInsightCitations(
  insight: WorkflowNodeInsight,
  output: Record<string, unknown>,
) {
  const sources = new Map<string, CitationSource>();
  collectCitationSources(output, sources);

  return {
    ...insight,
    fields: insight.fields.map((field) => ({
      ...field,
      citations: field.citations?.flatMap((citation) => {
        const source = sources.get(citation.referenceId);
        if (!source) {
          return [];
        }

        return [
          source.url
            ? {
                referenceId: citation.referenceId,
                label: source.label,
                url: source.url,
              }
            : {
                referenceId: citation.referenceId,
                label: source.label,
              },
        ];
      }),
    })),
  } satisfies WorkflowNodeInsight;
}

export function attachWorkflowNodeInsight(output: Record<string, unknown>) {
  const parsed = parseWorkflowNodeInsight(output.insight);
  const insight = parsed.success
    ? resolveInsightCitations(parsed.data, output)
    : buildWorkflowNodeInsightFromOutput(output);

  return insight ? { ...output, insight } : output;
}
