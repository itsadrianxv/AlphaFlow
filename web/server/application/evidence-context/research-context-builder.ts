import { createHash, randomUUID } from "node:crypto";
import type {
  EvidenceContextItem,
  EvidenceQualitySummary,
  ResearchContextPolicy,
} from "~/server/domain/evidence-context/types";
import type { PrismaEvidenceContextRepository } from "~/server/infrastructure/evidence-context/prisma-evidence-context-repository";

export type PromptMessage = { role: "system" | "user"; content: string };

export type ResearchContextBuildRequest = {
  userId: string;
  workflowRunId?: string;
  purpose: string;
  policy: ResearchContextPolicy;
  messages: PromptMessage[];
  evidenceItemIds: string[];
  maxItemChars?: number;
};

export type BuiltResearchContext = {
  requestGroupId: string;
  messages: PromptMessage[];
  quality: EvidenceQualitySummary;
  items: Array<{
    evidenceItemId: string;
    ordinal: number;
    projection: Record<string, unknown>;
    truncationReason?: string;
  }>;
};

function projectItem(item: EvidenceContextItem, maxChars: number) {
  const fact = item.extractedFact ?? item.snippet ?? "";
  const text = fact.length > maxChars ? `${fact.slice(0, maxChars)}…` : fact;
  return {
    evidenceItemId: item.id,
    itemKey: item.itemKey,
    fact: text,
    source: {
      type: item.sourceType,
      name: item.sourceName,
      url: item.url,
      publishedAt: item.publishedAt,
      observedAt: item.observedAt,
    },
    status: item.effectiveStatus ?? item.status,
    limitations: item.limitations,
    warnings: item.warnings,
    lineage: {
      recordKind: item.recordKind,
      lineageId: item.lineageId,
      derivedFromItemIds: item.derivedFromItemIds,
      algorithmVersion: item.algorithmVersion,
      correctionOfItemId: item.correctionOfItemId,
      supersedesItemId: item.supersedesItemId,
    },
  };
}

function quality(items: EvidenceContextItem[]): EvidenceQualitySummary {
  const degraded = items.filter(
    (item) => (item.effectiveStatus ?? item.status) !== "available",
  );
  const score = items.length === 0 ? 0 : Math.round(((items.length - degraded.length) / items.length) * 100);
  return {
    overallScore: score,
    level: score >= 85 ? "good" : score >= 70 ? "usable" : score >= 50 ? "limited" : "poor",
    blockScores: {},
    limitations: degraded.map((item) => `${item.itemKey}:${item.effectiveStatus ?? item.status}`),
    warnings: [...new Set(items.flatMap((item) => item.warnings))],
    confidenceCap: score < 50 ? "low" : degraded.length > 0 ? "medium" : "high",
  };
}

export class ResearchContextBuilder {
  constructor(private readonly repository: PrismaEvidenceContextRepository) {}

  async build(request: ResearchContextBuildRequest): Promise<BuiltResearchContext> {
    const details = await this.repository.listItemsForUser(
      request.userId,
      [...new Set(request.evidenceItemIds)],
    );
    const items = details.map((detail) => detail.item);
    const maxItemChars = request.maxItemChars ?? 1800;
    const projectedItems = items.map((item, ordinal) => ({
      evidenceItemId: item.id,
      ordinal,
      projection: projectItem(item, maxItemChars),
      truncationReason:
        (item.extractedFact ?? item.snippet ?? "").length > maxItemChars
          ? "item_char_budget"
          : undefined,
    }));
    const summary = quality(items);
    const evidencePayload = projectedItems.map((item) => item.projection);
    const qualityInstruction = request.policy === "evidence_required"
      ? "只能基于以下证据形成事实性主张；每条事实主张必须返回引用的 evidenceItemId。证据不足时明确写“证据不足”。"
      : "以下为本次转换任务的可追溯输入，不要求输出事实性引用。";
    return {
      requestGroupId: randomUUID(),
      messages: [
        ...request.messages,
        {
          role: "user",
          content: `${qualityInstruction}\n证据质量：${JSON.stringify(summary)}\n证据：${JSON.stringify(evidencePayload)}`,
        },
      ],
      quality: summary,
      items: projectedItems,
    };
  }

  static hashMessages(messages: PromptMessage[]) {
    return createHash("sha256").update(JSON.stringify(messages)).digest("hex");
  }
}
