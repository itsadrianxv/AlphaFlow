import { createHash, randomUUID } from "node:crypto";
import type { Prisma, PrismaClient } from "@prisma/client";
import {
  type EvidenceContext,
  type EvidenceContextBlock,
  type EvidenceContextItem,
  type ResearchClaim,
  type ResearchContextSnapshot,
  sanitizeEvidenceRawValue,
} from "~/server/domain/evidence-context/types";

const toJson = (value: unknown): Prisma.InputJsonValue =>
  value === undefined ? {} : (value as Prisma.InputJsonValue);

function toDate(value?: string) {
  return value ? new Date(value) : undefined;
}

function hash(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

export class PrismaEvidenceContextRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async create(params: {
    userId: string;
    workflowRunId?: string;
    context: Omit<EvidenceContext, "id" | "userId" | "createdAt">;
  }) {
    const contextId = randomUUID();
    const record = await this.prisma.$transaction(async (tx) => {
      await tx.evidenceContext.create({
        data: {
          id: contextId,
          userId: params.userId,
          workflowRunId: params.workflowRunId,
          schemaVersion: "1.0",
          subjectType: params.context.subject.subjectType,
          subjectId: params.context.subject.subjectId,
          subjectLabel: params.context.subject.label,
          phase: params.context.phase,
          metadataJson: toJson(params.context.metadata),
        },
      });

      for (const sourceBlock of params.context.blocks) {
        const blockId = sourceBlock.id || randomUUID();
        await tx.evidenceContextBlock.create({
          data: {
            id: blockId,
            contextId,
            blockKey: sourceBlock.blockKey,
            status: sourceBlock.status,
            sourceType: sourceBlock.sourceType,
            sourceId: sourceBlock.sourceId,
            sourceName: sourceBlock.sourceName,
            sourceUrl: sourceBlock.url,
            observedAt: toDate(sourceBlock.observedAt),
            fetchedAt: toDate(sourceBlock.fetchedAt),
            warnings: sourceBlock.warnings,
            limitations: sourceBlock.limitations,
            metadataJson: toJson(sourceBlock.metadata),
          },
        });

        for (const item of sourceBlock.items) {
          await tx.evidenceContextItem.create({
            data: {
              id: item.id || randomUUID(),
              contextId,
              blockId,
              userId: params.userId,
              itemKey: item.itemKey,
              status: item.status,
              extractedFact: item.extractedFact,
              snippet: item.snippet,
              valueJson:
                item.valueJson === undefined
                  ? undefined
                  : toJson(item.valueJson),
              rawValueJson:
                item.rawValueJson === undefined
                  ? undefined
                  : toJson(sanitizeEvidenceRawValue(item.rawValueJson)),
              sourceType: item.sourceType,
              sourceId: item.sourceId,
              sourceName: item.sourceName,
              sourceUrl: item.url,
              publishedAt: toDate(item.publishedAt),
              observedAt: toDate(item.observedAt),
              fetchedAt: toDate(item.fetchedAt),
              fallbackFrom: item.fallbackFrom,
              missingReason: item.missingReason,
              warnings: item.warnings,
              limitations: item.limitations,
              metadataJson: toJson(item.metadata),
              recordKind: item.recordKind,
              lineageId: item.lineageId,
              derivedFromItemIds: item.derivedFromItemIds,
              algorithmVersion: item.algorithmVersion,
              parametersJson:
                item.parameters === undefined ? undefined : toJson(item.parameters),
              correctionOfItemId: item.correctionOfItemId,
              supersedesItemId: item.supersedesItemId,
              contentHash: item.contentHash,
            },
          });
        }
      }

      return tx.evidenceContext.findUniqueOrThrow({
        where: { id: contextId },
        include: { blocks: { include: { items: true } } },
      });
    });

    return mapContext(record);
  }

  async getItemForUser(userId: string, itemId: string) {
    const record = await this.prisma.evidenceContextItem.findFirst({
      where: { id: itemId, userId },
      include: { context: true, block: true },
    });
    return record ? mapDetail(record) : null;
  }

  async listItemsForUser(userId: string, itemIds: string[]) {
    if (itemIds.length === 0) return [];
    const records = await this.prisma.evidenceContextItem.findMany({
      where: { userId, id: { in: itemIds } },
      include: { context: true, block: true },
      orderBy: { createdAt: "asc" },
    });
    return records.map(mapDetail);
  }

  async listContextsForRun(userId: string, workflowRunId: string) {
    const records = await this.prisma.evidenceContext.findMany({
      where: { userId, workflowRunId },
      include: { blocks: { include: { items: true } } },
      orderBy: { createdAt: "asc" },
    });
    return records.map(mapContext);
  }

  async getLineageForUser(userId: string, itemId: string) {
    const item = await this.prisma.evidenceContextItem.findFirst({
      where: { id: itemId, userId },
      select: { lineageId: true },
    });
    if (!item) return [];
    const records = await this.prisma.evidenceContextItem.findMany({
      where: { userId, lineageId: item.lineageId },
      include: { context: true, block: true },
      orderBy: { createdAt: "asc" },
    });
    return records.map(mapDetail);
  }

  async getSnapshotForUser(userId: string, snapshotId: string) {
    return this.prisma.researchContextSnapshot.findFirst({
      where: { id: snapshotId, userId },
      include: {
        items: { include: { evidenceItem: { include: { context: true, block: true } } }, orderBy: { ordinal: "asc" } },
        claims: { include: { citations: true }, orderBy: [{ artifactKey: "asc" }, { ordinal: "asc" }] },
      },
    });
  }

  async getClaimForUser(userId: string, claimId: string) {
    return this.prisma.researchClaim.findFirst({
      where: { id: claimId, snapshot: { userId } },
      include: { citations: { include: { evidenceItem: { include: { context: true, block: true } } } }, snapshot: true },
    });
  }

  async listItemsForContext(params: {
    userId: string;
    contextIds: string[];
  }) {
    if (params.contextIds.length === 0) return [];
    const records = await this.prisma.evidenceContextItem.findMany({
      where: { userId: params.userId, contextId: { in: params.contextIds } },
      include: { context: true, block: true },
      orderBy: { createdAt: "asc" },
    });
    return records.map(mapDetail);
  }

  async appendItem(params: {
    userId: string;
    contextId: string;
    blockId: string;
    item: EvidenceContextItem;
  }) {
    const block = await this.prisma.evidenceContextBlock.findFirst({
      where: { id: params.blockId, contextId: params.contextId, context: { userId: params.userId } },
    });
    if (!block) throw new Error("证据上下文或数据块不存在");
    const record = await this.prisma.evidenceContextItem.create({
      data: itemToCreateData(params, params.item),
      include: { context: true, block: true },
    });
    return mapDetail(record);
  }

  async createSnapshot(params: {
    userId: string;
    workflowRunId?: string;
    requestGroupId: string;
    requestSequence: number;
    attempt: number;
    purpose: string;
    policy: "evidence_required" | "transformation";
    model?: string;
    requestOptions?: Record<string, unknown>;
    messages: Array<{ role: string; content: string }>;
    quality: Record<string, unknown>;
    items: Array<{
      evidenceItemId: string;
      ordinal: number;
      projection: Record<string, unknown>;
      truncationReason?: string;
    }>;
  }) {
    const evidenceIds = params.items.map((item) => item.evidenceItemId);
    const ownedCount = await this.prisma.evidenceContextItem.count({
      where: { userId: params.userId, id: { in: evidenceIds } },
    });
    if (ownedCount !== evidenceIds.length) {
      throw new Error("快照包含无权访问的证据项");
    }
    const payload = { messages: params.messages, items: params.items.map((item) => item.projection) };
    const record = await this.prisma.researchContextSnapshot.create({
      data: {
        userId: params.userId,
        workflowRunId: params.workflowRunId,
        requestGroupId: params.requestGroupId,
        requestSequence: params.requestSequence,
        attempt: params.attempt,
        purpose: params.purpose,
        policy: params.policy,
        model: params.model,
        requestOptionsJson: params.requestOptions ? toJson(params.requestOptions) : undefined,
        messagesJson: toJson(params.messages),
        qualityJson: toJson(params.quality),
        projectionVersion: "evidence-prompt-v1",
        contentHash: hash(payload),
        items: {
          create: params.items.map((item) => ({
            evidenceItemId: item.evidenceItemId,
            ordinal: item.ordinal,
            projectionJson: toJson(item.projection),
            projectionHash: hash(item.projection),
            truncationReason: item.truncationReason,
          })),
        },
      },
      include: { items: true },
    });
    return record;
  }

  async markSnapshot(params: {
    snapshotId: string;
    status: "sent" | "succeeded" | "failed";
    errorMessage?: string;
  }) {
    const now = new Date();
    return this.prisma.researchContextSnapshot.update({
      where: { id: params.snapshotId },
      data: {
        status: params.status,
        errorMessage: params.errorMessage,
        sentAt: params.status === "sent" ? now : undefined,
        completedAt: params.status === "succeeded" || params.status === "failed" ? now : undefined,
      },
    });
  }

  async createClaims(params: {
    snapshotId: string;
    claims: Array<{
      artifactKey: string;
      ordinal: number;
      text: string;
      citations: Array<{ evidenceItemId: string; relation?: string }>;
    }>;
  }): Promise<ResearchClaim[]> {
    const snapshot = await this.prisma.researchContextSnapshot.findUnique({
      where: { id: params.snapshotId },
      include: { items: true },
    });
    if (!snapshot) throw new Error("研究上下文快照不存在");
    const allowed = new Set(snapshot.items.map((item) => item.evidenceItemId));
    const records: ResearchClaim[] = [];
    for (const claim of params.claims) {
      const citations = claim.citations.filter((citation) => allowed.has(citation.evidenceItemId));
      const supported = citations.length > 0;
      const record = await this.prisma.researchClaim.create({
        data: {
          snapshotId: params.snapshotId,
          artifactKey: claim.artifactKey,
          ordinal: claim.ordinal,
          text: supported ? claim.text : "证据不足，无法形成可发布的事实结论。",
          status: supported ? "supported" : "insufficient_evidence",
          qualityFlags: supported ? [] : ["missing_valid_snapshot_citation"],
          citations: { create: citations.map((citation) => ({ evidenceItemId: citation.evidenceItemId, relation: citation.relation ?? "support" })) },
        },
        include: { citations: true },
      });
      records.push({
        id: record.id,
        snapshotId: record.snapshotId,
        artifactKey: record.artifactKey,
        ordinal: record.ordinal,
        text: record.text,
        status: record.status as ResearchClaim["status"],
        qualityFlags: record.qualityFlags,
        citations: record.citations.map((citation) => ({ evidenceItemId: citation.evidenceItemId, relation: citation.relation as "support" | "risk" | "context" | "contradiction" })),
        createdAt: record.createdAt.toISOString(),
      });
    }
    return records;
  }
}

function itemToCreateData(
  params: { userId: string; contextId: string; blockId: string },
  item: EvidenceContextItem,
) {
  return {
    id: item.id || randomUUID(),
    contextId: params.contextId,
    blockId: params.blockId,
    userId: params.userId,
    itemKey: item.itemKey,
    status: item.status,
    extractedFact: item.extractedFact,
    snippet: item.snippet,
    valueJson: item.valueJson === undefined ? undefined : toJson(item.valueJson),
    rawValueJson: item.rawValueJson === undefined ? undefined : toJson(sanitizeEvidenceRawValue(item.rawValueJson)),
    sourceType: item.sourceType,
    sourceId: item.sourceId,
    sourceName: item.sourceName,
    sourceUrl: item.url,
    publishedAt: toDate(item.publishedAt),
    observedAt: toDate(item.observedAt),
    fetchedAt: toDate(item.fetchedAt),
    fallbackFrom: item.fallbackFrom,
    missingReason: item.missingReason,
    warnings: item.warnings,
    limitations: item.limitations,
    metadataJson: toJson(item.metadata),
    recordKind: item.recordKind,
    lineageId: item.lineageId,
    derivedFromItemIds: item.derivedFromItemIds,
    algorithmVersion: item.algorithmVersion,
    parametersJson: item.parameters === undefined ? undefined : toJson(item.parameters),
    correctionOfItemId: item.correctionOfItemId,
    supersedesItemId: item.supersedesItemId,
    contentHash: item.contentHash,
  };
}

function mapContext(record: {
  id: string;
  userId: string;
  workflowRunId: string | null;
  subjectType: string;
  subjectId: string;
  subjectLabel: string | null;
  phase: string | null;
  metadataJson: unknown;
  createdAt: Date;
  blocks: Array<{
    id: string;
    blockKey: string;
    status: string;
    sourceType: string | null;
    sourceId: string | null;
    sourceName: string | null;
    sourceUrl: string | null;
    observedAt: Date | null;
    fetchedAt: Date | null;
    warnings: string[];
    limitations: string[];
    metadataJson: unknown;
    items: Array<Parameters<typeof mapItem>[0]>;
  }>;
}): EvidenceContext {
  return {
    id: record.id,
    userId: record.userId,
    workflowRunId: record.workflowRunId ?? undefined,
    subject: {
      subjectType: record.subjectType,
      subjectId: record.subjectId,
      label: record.subjectLabel ?? undefined,
    },
    phase: record.phase ?? undefined,
    blocks: record.blocks.map((block) => ({
      id: block.id,
      blockKey: block.blockKey,
      status: block.status as EvidenceContextBlock["status"],
      sourceType: block.sourceType ?? undefined,
      sourceId: block.sourceId ?? undefined,
      sourceName: block.sourceName ?? undefined,
      url: block.sourceUrl ?? undefined,
      observedAt: block.observedAt?.toISOString(),
      fetchedAt: block.fetchedAt?.toISOString(),
      warnings: block.warnings,
      limitations: block.limitations,
      metadata: (block.metadataJson as Record<string, unknown>) ?? {},
      items: block.items.map(mapItem),
    })),
    createdAt: record.createdAt.toISOString(),
    metadata: (record.metadataJson as Record<string, unknown>) ?? {},
  };
}

function mapItem(record: {
  id: string;
  itemKey: string;
  status: string;
  extractedFact: string | null;
  snippet: string | null;
  valueJson: unknown;
  rawValueJson: unknown;
  sourceType: string;
  sourceId: string | null;
  sourceName: string | null;
  sourceUrl: string | null;
  publishedAt: Date | null;
  observedAt: Date | null;
  fetchedAt: Date | null;
  fallbackFrom: string | null;
  missingReason: string | null;
  warnings: string[];
  limitations: string[];
  metadataJson: unknown;
  recordKind: string;
  lineageId: string;
  derivedFromItemIds: string[];
  algorithmVersion: string | null;
  parametersJson: unknown;
  correctionOfItemId: string | null;
  supersedesItemId: string | null;
  contentHash: string;
}): EvidenceContextItem {
  return {
    id: record.id,
    itemKey: record.itemKey,
    status: record.status as EvidenceContextItem["status"],
    extractedFact: record.extractedFact ?? undefined,
    snippet: record.snippet ?? undefined,
    valueJson: record.valueJson ?? undefined,
    rawValueJson: record.rawValueJson ?? undefined,
    sourceType: record.sourceType,
    sourceId: record.sourceId ?? undefined,
    sourceName: record.sourceName ?? undefined,
    url: record.sourceUrl ?? undefined,
    publishedAt: record.publishedAt?.toISOString(),
    observedAt: record.observedAt?.toISOString(),
    fetchedAt: record.fetchedAt?.toISOString(),
    fallbackFrom: record.fallbackFrom ?? undefined,
    missingReason: record.missingReason ?? undefined,
    warnings: record.warnings,
    limitations: record.limitations,
    metadata: (record.metadataJson as Record<string, unknown>) ?? {},
    recordKind: record.recordKind as EvidenceContextItem["recordKind"],
    lineageId: record.lineageId,
    derivedFromItemIds: record.derivedFromItemIds,
    algorithmVersion: record.algorithmVersion ?? undefined,
    parameters: (record.parametersJson as Record<string, unknown>) ?? undefined,
    correctionOfItemId: record.correctionOfItemId ?? undefined,
    supersedesItemId: record.supersedesItemId ?? undefined,
    contentHash: record.contentHash,
  };
}

function mapDetail(
  record: {
    id: string;
    createdAt: Date;
    context: {
      id: string;
      subjectType: string;
      subjectId: string;
      subjectLabel: string | null;
      phase: string | null;
    };
    block: { blockKey: string };
  } & Parameters<typeof mapItem>[0],
) {
  return {
    id: record.id,
    contextId: record.context.id,
    subjectType: record.context.subjectType,
    subjectId: record.context.subjectId,
    subjectLabel: record.context.subjectLabel ?? undefined,
    phase: record.context.phase ?? undefined,
    blockKey: record.block.blockKey,
    item: {
      ...mapItem(record),
      blockKey: record.block.blockKey,
    },
    createdAt: record.createdAt.toISOString(),
  };
}
