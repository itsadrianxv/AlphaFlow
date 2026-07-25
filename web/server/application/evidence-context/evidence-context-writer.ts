import { createHash, randomUUID } from "node:crypto";
import type {
  CollectionEvidenceStatus,
  EvidenceContextBlock,
  EvidenceContextItem,
  EvidenceSubject,
} from "~/server/domain/evidence-context/types";
import type { PrismaEvidenceContextRepository } from "~/server/infrastructure/evidence-context/prisma-evidence-context-repository";

export type EvidenceContextWriter = Pick<
  PrismaEvidenceContextRepository,
  "create" | "appendItem"
>;

export type EvidenceBlockDraft = {
  blockKey: string;
  status?: CollectionEvidenceStatus;
  sourceType?: string;
  sourceId?: string;
  sourceName?: string;
  url?: string;
  observedAt?: string;
  fetchedAt?: string;
  warnings?: string[];
  limitations?: string[];
  items: Array<
    Omit<
      EvidenceContextItem,
      | "id"
      | "status"
      | "warnings"
      | "limitations"
      | "metadata"
      | "sourceType"
      | "recordKind"
      | "lineageId"
      | "derivedFromItemIds"
      | "algorithmVersion"
      | "parameters"
      | "correctionOfItemId"
      | "supersedesItemId"
      | "contentHash"
    > & {
      sourceType?: string;
      status?: CollectionEvidenceStatus;
      warnings?: string[];
      limitations?: string[];
      metadata?: Record<string, unknown>;
      recordKind?: "observation" | "manual_input" | "derived" | "model_derived" | "correction";
      lineageId?: string;
      derivedFromItemIds?: string[];
      algorithmVersion?: string;
      parameters?: Record<string, unknown>;
      correctionOfItemId?: string;
      supersedesItemId?: string;
    }
  >;
};

function contentHash(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

export async function writeEvidenceContext(params: {
  writer: EvidenceContextWriter;
  userId: string;
  workflowRunId?: string;
  subject: EvidenceSubject;
  phase?: string;
  metadata?: Record<string, unknown>;
  blocks: EvidenceBlockDraft[];
}) {
  const blocks: EvidenceContextBlock[] = params.blocks.map((block) => ({
    id: randomUUID(),
    blockKey: block.blockKey,
    status: block.status ?? (block.items.length ? "available" : "missing"),
    sourceType: block.sourceType,
    sourceId: block.sourceId,
    sourceName: block.sourceName,
    url: block.url,
    observedAt: block.observedAt,
    fetchedAt: block.fetchedAt,
    warnings: block.warnings ?? [],
    limitations: block.limitations ?? [],
    metadata: {},
    items: block.items.map((item) => ({
      ...item,
      id: randomUUID(),
      status: item.status ?? "available",
      sourceType: item.sourceType ?? block.sourceType ?? "unknown",
      warnings: item.warnings ?? [],
      limitations: item.limitations ?? [],
      metadata: item.metadata ?? {},
      recordKind: item.recordKind ?? "observation",
      lineageId: item.lineageId ?? randomUUID(),
      derivedFromItemIds: item.derivedFromItemIds ?? [],
      algorithmVersion: item.algorithmVersion,
      parameters: item.parameters,
      correctionOfItemId: item.correctionOfItemId,
      supersedesItemId: item.supersedesItemId,
      contentHash: contentHash({
        itemKey: item.itemKey,
        extractedFact: item.extractedFact,
        snippet: item.snippet,
        valueJson: item.valueJson,
        rawValueJson: item.rawValueJson,
        sourceType: item.sourceType ?? block.sourceType ?? "unknown",
      }),
    })),
  }));

  const context = await params.writer.create({
    userId: params.userId,
    workflowRunId: params.workflowRunId,
    context: {
      subject: params.subject,
      phase: params.phase,
      blocks,
      metadata: params.metadata ?? {},
    },
  });

  return {
    context,
    citations: blocks.flatMap((block) =>
      block.items.map((item) => ({
        evidenceItemId: item.id,
        relation: "support" as const,
        label: item.itemKey,
      })),
    ),
  };
}

export type EvidenceItemAppendDraft = Omit<
  EvidenceContextItem,
  "id" | "lineageId" | "contentHash"
> & {
  id?: string;
  lineageId?: string;
};

/** 证据只能追加；修正与派生必须通过显式血缘字段创建新 item。 */
export async function appendEvidenceItem(params: {
  writer: EvidenceContextWriter;
  userId: string;
  contextId: string;
  blockId: string;
  item: EvidenceItemAppendDraft;
}) {
  const id = params.item.id ?? randomUUID();
  const lineageId = params.item.lineageId ??
    (params.item.correctionOfItemId || params.item.supersedesItemId || id);
  const item: EvidenceContextItem = {
    ...params.item,
    id,
    lineageId,
    contentHash: contentHash({
      itemKey: params.item.itemKey,
      extractedFact: params.item.extractedFact,
      snippet: params.item.snippet,
      valueJson: params.item.valueJson,
      rawValueJson: params.item.rawValueJson,
      sourceType: params.item.sourceType,
      recordKind: params.item.recordKind,
    }),
  };
  return params.writer.appendItem({
    userId: params.userId,
    contextId: params.contextId,
    blockId: params.blockId,
    item,
  });
}
