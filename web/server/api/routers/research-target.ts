import { TRPCError } from "@trpc/server";
import {
  createFinancialSnapshotInputSchema,
  createResearchNoteInputSchema,
  createSavedCompanyInputSchema,
  createSavedIndustryInputSchema,
  financialSnapshotSchema,
  formatResearchNoteInputSchema,
  generateComparisonArtifactInputSchema,
  listResearchTargetsInputSchema,
  listTargetContentInputSchema,
  type ResearchTargetRef,
  type ResearchTargetType,
  researchArtifactSchema,
  researchTargetNoteSchema,
  researchTargetRefSchema,
  researchTargetSummarySchema,
  savedCompanySchema,
  savedIndustrySchema,
  updateResearchNoteInputSchema,
  updateSavedCompanyInputSchema,
  updateSavedIndustryInputSchema,
} from "~/contracts/research-target";
import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";
import { DeepSeekClient } from "~/server/infrastructure/intelligence/deepseek-client";

type SavedCompanyRecord = {
  id: string;
  userId: string;
  stockCode: string;
  companyName: string;
  reason: string | null;
  tags: string[];
  metadataJson: unknown;
  archivedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

type SavedIndustryRecord = {
  id: string;
  userId: string;
  name: string;
  source: string;
  reason: string | null;
  tags: string[];
  relatedCompaniesJson: unknown;
  metadataJson: unknown;
  archivedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

type ResearchNoteRecord = {
  id: string;
  userId: string;
  targetType: string;
  targetId: string;
  title: string | null;
  kind: string | null;
  contentMarkdown: string;
  rawContent: string | null;
  sourceJson: unknown | null;
  tags: string[];
  createdAt: Date;
  updatedAt: Date;
};

type FinancialSnapshotRecord = {
  id: string;
  userId: string;
  targetType: string;
  targetId: string;
  companyRefsJson: unknown;
  metricSetJson: unknown;
  periodRangeJson: unknown;
  rawSnapshotJson: unknown;
  sourceJson: unknown;
  createdAt: Date;
};

type ResearchArtifactRecord = {
  id: string;
  userId: string;
  targetType: string;
  targetId: string;
  financialSnapshotId: string | null;
  artifactType: string;
  title: string;
  contentType: string;
  payloadJson: unknown;
  sourceJson: unknown | null;
  createdAt: Date;
  updatedAt: Date;
};

type ResearchTargetDbClient = {
  savedCompany: {
    create(args: {
      data: Record<string, unknown>;
    }): Promise<SavedCompanyRecord>;
    update(args: {
      where: { id: string };
      data: Record<string, unknown>;
    }): Promise<SavedCompanyRecord>;
    findFirst(args: {
      where: Record<string, unknown>;
    }): Promise<SavedCompanyRecord | null>;
    findMany(args: Record<string, unknown>): Promise<SavedCompanyRecord[]>;
  };
  savedIndustry: {
    create(args: {
      data: Record<string, unknown>;
    }): Promise<SavedIndustryRecord>;
    update(args: {
      where: { id: string };
      data: Record<string, unknown>;
    }): Promise<SavedIndustryRecord>;
    findFirst(args: {
      where: Record<string, unknown>;
    }): Promise<SavedIndustryRecord | null>;
    findMany(args: Record<string, unknown>): Promise<SavedIndustryRecord[]>;
  };
  researchNote: {
    create(args: {
      data: Record<string, unknown>;
    }): Promise<ResearchNoteRecord>;
    update(args: {
      where: { id: string };
      data: Record<string, unknown>;
    }): Promise<ResearchNoteRecord>;
    delete(args: { where: { id: string } }): Promise<ResearchNoteRecord>;
    findFirst(args: {
      where: Record<string, unknown>;
    }): Promise<ResearchNoteRecord | null>;
    findMany(args: Record<string, unknown>): Promise<ResearchNoteRecord[]>;
  };
  financialSnapshot: {
    create(args: {
      data: Record<string, unknown>;
    }): Promise<FinancialSnapshotRecord>;
    findFirst(args: {
      where: Record<string, unknown>;
    }): Promise<FinancialSnapshotRecord | null>;
    findMany(args: Record<string, unknown>): Promise<FinancialSnapshotRecord[]>;
  };
  researchArtifact: {
    create(args: {
      data: Record<string, unknown>;
    }): Promise<ResearchArtifactRecord>;
    findFirst(args: {
      where: Record<string, unknown>;
    }): Promise<ResearchArtifactRecord | null>;
    findMany(args: Record<string, unknown>): Promise<ResearchArtifactRecord[]>;
  };
  watchList: {
    findFirst(args: { where: Record<string, unknown> }): Promise<{
      id: string;
      userId: string;
      name: string;
      description: string | null;
      updatedAt?: Date;
    } | null>;
    findMany(args: Record<string, unknown>): Promise<
      Array<{
        id: string;
        name: string;
        description: string | null;
        updatedAt?: Date;
      }>
    >;
  };
  researchSpace: {
    findFirst(args: { where: Record<string, unknown> }): Promise<{
      id: string;
      name: string;
      description: string | null;
      updatedAt?: Date;
    } | null>;
    findMany(args: Record<string, unknown>): Promise<
      Array<{
        id: string;
        name: string;
        description: string | null;
        updatedAt?: Date;
      }>
    >;
  };
  workflowRun: {
    findFirst(args: { where: Record<string, unknown> }): Promise<{
      id: string;
      query: string;
      status: string;
      updatedAt?: Date;
      createdAt: Date;
    } | null>;
    findMany(args: Record<string, unknown>): Promise<
      Array<{
        id: string;
        query: string;
        status: string;
        updatedAt?: Date;
        createdAt: Date;
      }>
    >;
  };
};

function withResearchTargetDb<T extends object>(db: T) {
  return db as T & ResearchTargetDbClient;
}

function toIso(value: Date | null | undefined) {
  return value ? value.toISOString() : null;
}

function normalizeStringList(items: string[] | undefined, limit = 12) {
  return [
    ...new Set((items ?? []).map((item) => item.trim()).filter(Boolean)),
  ].slice(0, limit);
}

function asRecord(value: unknown) {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function asCompanyRefs(value: unknown) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter(
      (item): item is { stockCode: string; stockName: string } =>
        typeof item === "object" &&
        item !== null &&
        typeof (item as { stockCode?: unknown }).stockCode === "string" &&
        typeof (item as { stockName?: unknown }).stockName === "string",
    )
    .map((item) => ({
      stockCode: item.stockCode,
      stockName: item.stockName,
    }));
}

function buildCompany(record: SavedCompanyRecord) {
  return savedCompanySchema.parse({
    id: record.id,
    stockCode: record.stockCode,
    companyName: record.companyName,
    reason: record.reason,
    tags: record.tags,
    metadata: asRecord(record.metadataJson),
    archivedAt: toIso(record.archivedAt),
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  });
}

function buildIndustry(record: SavedIndustryRecord) {
  return savedIndustrySchema.parse({
    id: record.id,
    name: record.name,
    source: record.source,
    reason: record.reason,
    tags: record.tags,
    relatedCompanies: asCompanyRefs(record.relatedCompaniesJson),
    metadata: asRecord(record.metadataJson),
    archivedAt: toIso(record.archivedAt),
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  });
}

function buildNote(record: ResearchNoteRecord) {
  return researchTargetNoteSchema.parse({
    id: record.id,
    targetRef: { type: record.targetType, id: record.targetId },
    title: record.title,
    kind: record.kind,
    contentMarkdown: record.contentMarkdown,
    rawContent: record.rawContent,
    source: record.sourceJson ?? null,
    tags: record.tags,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  });
}

function buildSnapshot(record: FinancialSnapshotRecord) {
  return financialSnapshotSchema.parse({
    id: record.id,
    targetRef: { type: record.targetType, id: record.targetId },
    companyRefs: asCompanyRefs(record.companyRefsJson),
    metricSet: record.metricSetJson,
    periodRange: record.periodRangeJson,
    rawSnapshot: record.rawSnapshotJson,
    source: record.sourceJson,
    createdAt: record.createdAt.toISOString(),
  });
}

function buildArtifact(record: ResearchArtifactRecord) {
  return researchArtifactSchema.parse({
    id: record.id,
    targetRef: { type: record.targetType, id: record.targetId },
    financialSnapshotId: record.financialSnapshotId,
    artifactType: record.artifactType,
    title: record.title,
    contentType: record.contentType,
    payload: record.payloadJson,
    source: record.sourceJson ?? null,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  });
}

function matchesQuery(
  values: Array<string | null | undefined>,
  query?: string,
) {
  if (!query?.trim()) {
    return true;
  }

  const normalized = query.trim().toLowerCase();
  return values.some((value) => value?.toLowerCase().includes(normalized));
}

async function requireTarget(
  db: ResearchTargetDbClient,
  userId: string,
  targetRef: ResearchTargetRef,
  options?: { allowArchived?: boolean },
) {
  const allowArchived = options?.allowArchived ?? false;

  if (targetRef.type === "company") {
    const company = await db.savedCompany.findFirst({
      where: { id: targetRef.id, userId },
    });
    if (!company || (!allowArchived && company.archivedAt)) {
      throw new TRPCError({ code: "NOT_FOUND", message: "收藏公司不存在" });
    }
    return company;
  }

  if (targetRef.type === "industry") {
    const industry = await db.savedIndustry.findFirst({
      where: { id: targetRef.id, userId },
    });
    if (!industry || (!allowArchived && industry.archivedAt)) {
      throw new TRPCError({ code: "NOT_FOUND", message: "收藏行业不存在" });
    }
    return industry;
  }

  if (targetRef.type === "watchlist") {
    const watchList = await db.watchList.findFirst({
      where: { id: targetRef.id, userId },
    });
    if (!watchList) {
      throw new TRPCError({ code: "NOT_FOUND", message: "自选股列表不存在" });
    }
    return watchList;
  }

  if (targetRef.type === "space") {
    const space = await db.researchSpace.findFirst({
      where: { id: targetRef.id, userId },
    });
    if (!space) {
      throw new TRPCError({
        code: "NOT_FOUND",
        message: "Research Space 不存在",
      });
    }
    return space;
  }

  const run = await db.workflowRun.findFirst({
    where: { id: targetRef.id, userId },
  });
  if (!run) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Workflow run 不存在" });
  }
  return run;
}

function buildComparisonMarkdown(snapshot: FinancialSnapshotRecord) {
  const companyRefs = asCompanyRefs(snapshot.companyRefsJson);
  const raw = asRecord(snapshot.rawSnapshotJson);
  const rows = Array.isArray(raw.latestSnapshotRows)
    ? raw.latestSnapshotRows
    : [];
  const metricMeta = Array.isArray(raw.indicatorMeta) ? raw.indicatorMeta : [];
  const companyLines = companyRefs
    .map((item) => `- ${item.stockName}（${item.stockCode}）`)
    .join("\n");
  const metricLines = metricMeta
    .filter(
      (item): item is { id: string; name: string } =>
        typeof item === "object" &&
        item !== null &&
        typeof (item as { id?: unknown }).id === "string" &&
        typeof (item as { name?: unknown }).name === "string",
    )
    .slice(0, 12)
    .map((item) => `- ${item.name}（${item.id}）`)
    .join("\n");

  return [
    "# 财务快照比较报告",
    "",
    "## 比较对象",
    companyLines || "- 暂无公司",
    "",
    "## 指标范围",
    metricLines || "- 暂无指标",
    "",
    "## 初步结论",
    `本报告基于 ${rows.length} 条最新快照行生成。建议优先比较盈利质量、成长性、现金流和估值类指标的相对位置。`,
    "",
    "## 后续问题",
    "- 哪些公司指标领先但估值尚未充分反映？",
    "- 哪些公司存在单一指标好看但现金流或利润质量不足？",
    "- 当前筛选结果是否需要加入行业景气度和催化剂验证？",
  ].join("\n");
}

function formatPrompt(mode: string, content: string) {
  const modeLabel: Record<string, string> = {
    bullets: "要点",
    hypothesis: "核心假设",
    risk: "风险点",
    question: "待验证问题",
    indicator: "跟踪指标",
  };

  return [
    "你是投研笔记整理助手。请把用户保存的原始内容整理成中文 markdown。",
    `整理方向：${modeLabel[mode] ?? "要点"}`,
    "要求：保留事实边界，不新增未给出的结论；输出简洁、可后续追踪。",
    "",
    content,
  ].join("\n");
}

export const researchTargetRouter = createTRPCRouter({
  listTargets: protectedProcedure
    .input(listResearchTargetsInputSchema)
    .query(async ({ ctx, input }) => {
      const db = withResearchTargetDb(ctx.db);
      const userId = ctx.session.user.id;
      const types = new Set<ResearchTargetType>(
        input?.types ?? [
          "company",
          "industry",
          "watchlist",
          "space",
          "workflow_run",
        ],
      );
      const includeArchived = input?.includeArchived ?? false;
      const query = input?.query;
      const limit = input?.limit ?? 50;
      const items = [];

      if (types.has("company")) {
        const records = await db.savedCompany.findMany({
          where: includeArchived ? { userId } : { userId, archivedAt: null },
          orderBy: { updatedAt: "desc" },
          take: limit,
        });
        for (const record of records) {
          if (
            matchesQuery(
              [record.stockCode, record.companyName, record.reason],
              query,
            )
          ) {
            items.push(
              researchTargetSummarySchema.parse({
                ref: { type: "company", id: record.id },
                label: `${record.companyName} (${record.stockCode})`,
                description: record.reason,
                tags: record.tags,
                archived: Boolean(record.archivedAt),
                updatedAt: record.updatedAt.toISOString(),
              }),
            );
          }
        }
      }

      if (types.has("industry")) {
        const records = await db.savedIndustry.findMany({
          where: includeArchived ? { userId } : { userId, archivedAt: null },
          orderBy: { updatedAt: "desc" },
          take: limit,
        });
        for (const record of records) {
          if (
            matchesQuery([record.name, record.source, record.reason], query)
          ) {
            items.push(
              researchTargetSummarySchema.parse({
                ref: { type: "industry", id: record.id },
                label: record.name,
                description: record.source,
                tags: record.tags,
                archived: Boolean(record.archivedAt),
                updatedAt: record.updatedAt.toISOString(),
              }),
            );
          }
        }
      }

      if (types.has("watchlist")) {
        const records = await db.watchList.findMany({
          where: { userId },
          orderBy: { updatedAt: "desc" },
          take: limit,
        });
        for (const record of records) {
          if (matchesQuery([record.name, record.description], query)) {
            items.push(
              researchTargetSummarySchema.parse({
                ref: { type: "watchlist", id: record.id },
                label: record.name,
                description: record.description,
                tags: [],
                archived: false,
                updatedAt: toIso(record.updatedAt),
              }),
            );
          }
        }
      }

      if (types.has("space")) {
        const records = await db.researchSpace.findMany({
          where: { userId },
          orderBy: { updatedAt: "desc" },
          take: limit,
        });
        for (const record of records) {
          if (matchesQuery([record.name, record.description], query)) {
            items.push(
              researchTargetSummarySchema.parse({
                ref: { type: "space", id: record.id },
                label: record.name,
                description: record.description,
                tags: [],
                archived: false,
                updatedAt: toIso(record.updatedAt),
              }),
            );
          }
        }
      }

      if (types.has("workflow_run")) {
        const records = await db.workflowRun.findMany({
          where: { userId },
          orderBy: { createdAt: "desc" },
          take: limit,
        });
        for (const record of records) {
          if (matchesQuery([record.query, record.status], query)) {
            items.push(
              researchTargetSummarySchema.parse({
                ref: { type: "workflow_run", id: record.id },
                label: record.query,
                description: record.status,
                tags: [],
                archived: false,
                updatedAt: toIso(record.updatedAt ?? record.createdAt),
              }),
            );
          }
        }
      }

      return items
        .sort(
          (left, right) =>
            new Date(right.updatedAt ?? 0).getTime() -
            new Date(left.updatedAt ?? 0).getTime(),
        )
        .slice(0, limit);
    }),

  createCompany: protectedProcedure
    .input(createSavedCompanyInputSchema)
    .mutation(async ({ ctx, input }) => {
      const db = withResearchTargetDb(ctx.db);
      const created = await db.savedCompany.create({
        data: {
          userId: ctx.session.user.id,
          stockCode: input.stockCode,
          companyName: input.companyName,
          reason: input.reason ?? null,
          tags: normalizeStringList(input.tags),
          metadataJson: input.metadata,
        },
      });
      return buildCompany(created);
    }),

  updateCompany: protectedProcedure
    .input(updateSavedCompanyInputSchema)
    .mutation(async ({ ctx, input }) => {
      const db = withResearchTargetDb(ctx.db);
      await requireTarget(
        db,
        ctx.session.user.id,
        { type: "company", id: input.id },
        { allowArchived: true },
      );
      const updated = await db.savedCompany.update({
        where: { id: input.id },
        data: {
          ...(input.stockCode ? { stockCode: input.stockCode } : {}),
          ...(input.companyName ? { companyName: input.companyName } : {}),
          ...(input.reason !== undefined ? { reason: input.reason } : {}),
          ...(input.tags ? { tags: normalizeStringList(input.tags) } : {}),
          ...(input.metadata ? { metadataJson: input.metadata } : {}),
        },
      });
      return buildCompany(updated);
    }),

  archiveCompany: protectedProcedure
    .input(researchTargetRefSchema.pick({ id: true }))
    .mutation(async ({ ctx, input }) => {
      const db = withResearchTargetDb(ctx.db);
      await requireTarget(
        db,
        ctx.session.user.id,
        { type: "company", id: input.id },
        { allowArchived: true },
      );
      const updated = await db.savedCompany.update({
        where: { id: input.id },
        data: { archivedAt: new Date() },
      });
      return buildCompany(updated);
    }),

  listCompanies: protectedProcedure.query(async ({ ctx }) => {
    const db = withResearchTargetDb(ctx.db);
    const records = await db.savedCompany.findMany({
      where: { userId: ctx.session.user.id },
      orderBy: { updatedAt: "desc" },
    });
    return records.map(buildCompany);
  }),

  createIndustry: protectedProcedure
    .input(createSavedIndustryInputSchema)
    .mutation(async ({ ctx, input }) => {
      const db = withResearchTargetDb(ctx.db);
      const created = await db.savedIndustry.create({
        data: {
          userId: ctx.session.user.id,
          name: input.name,
          source: input.source,
          reason: input.reason ?? null,
          tags: normalizeStringList(input.tags),
          relatedCompaniesJson: input.relatedCompanies,
          metadataJson: input.metadata,
        },
      });
      return buildIndustry(created);
    }),

  updateIndustry: protectedProcedure
    .input(updateSavedIndustryInputSchema)
    .mutation(async ({ ctx, input }) => {
      const db = withResearchTargetDb(ctx.db);
      await requireTarget(
        db,
        ctx.session.user.id,
        { type: "industry", id: input.id },
        { allowArchived: true },
      );
      const updated = await db.savedIndustry.update({
        where: { id: input.id },
        data: {
          ...(input.name ? { name: input.name } : {}),
          ...(input.source ? { source: input.source } : {}),
          ...(input.reason !== undefined ? { reason: input.reason } : {}),
          ...(input.tags ? { tags: normalizeStringList(input.tags) } : {}),
          ...(input.relatedCompanies
            ? { relatedCompaniesJson: input.relatedCompanies }
            : {}),
          ...(input.metadata ? { metadataJson: input.metadata } : {}),
        },
      });
      return buildIndustry(updated);
    }),

  archiveIndustry: protectedProcedure
    .input(researchTargetRefSchema.pick({ id: true }))
    .mutation(async ({ ctx, input }) => {
      const db = withResearchTargetDb(ctx.db);
      await requireTarget(
        db,
        ctx.session.user.id,
        { type: "industry", id: input.id },
        { allowArchived: true },
      );
      const updated = await db.savedIndustry.update({
        where: { id: input.id },
        data: { archivedAt: new Date() },
      });
      return buildIndustry(updated);
    }),

  listIndustries: protectedProcedure.query(async ({ ctx }) => {
    const db = withResearchTargetDb(ctx.db);
    const records = await db.savedIndustry.findMany({
      where: { userId: ctx.session.user.id },
      orderBy: { updatedAt: "desc" },
    });
    return records.map(buildIndustry);
  }),

  createNote: protectedProcedure
    .input(createResearchNoteInputSchema)
    .mutation(async ({ ctx, input }) => {
      const db = withResearchTargetDb(ctx.db);
      await requireTarget(db, ctx.session.user.id, input.targetRef);
      const created = await db.researchNote.create({
        data: {
          userId: ctx.session.user.id,
          targetType: input.targetRef.type,
          targetId: input.targetRef.id,
          title: input.title ?? null,
          kind: input.kind ?? null,
          contentMarkdown: input.contentMarkdown,
          rawContent: input.rawContent ?? input.contentMarkdown,
          sourceJson: input.source ?? null,
          tags: normalizeStringList(input.tags),
        },
      });
      return buildNote(created);
    }),

  updateNote: protectedProcedure
    .input(updateResearchNoteInputSchema)
    .mutation(async ({ ctx, input }) => {
      const db = withResearchTargetDb(ctx.db);
      const existing = await db.researchNote.findFirst({
        where: { id: input.id, userId: ctx.session.user.id },
      });
      if (!existing) {
        throw new TRPCError({ code: "NOT_FOUND", message: "笔记不存在" });
      }
      const updated = await db.researchNote.update({
        where: { id: input.id },
        data: {
          ...(input.title !== undefined ? { title: input.title } : {}),
          ...(input.kind !== undefined ? { kind: input.kind } : {}),
          ...(input.contentMarkdown !== undefined
            ? { contentMarkdown: input.contentMarkdown }
            : {}),
          ...(input.tags !== undefined
            ? { tags: normalizeStringList(input.tags) }
            : {}),
        },
      });
      return buildNote(updated);
    }),

  deleteNote: protectedProcedure
    .input(researchTargetRefSchema.pick({ id: true }))
    .mutation(async ({ ctx, input }) => {
      const db = withResearchTargetDb(ctx.db);
      const existing = await db.researchNote.findFirst({
        where: { id: input.id, userId: ctx.session.user.id },
      });
      if (!existing) {
        throw new TRPCError({ code: "NOT_FOUND", message: "笔记不存在" });
      }
      await db.researchNote.delete({ where: { id: input.id } });
      return { success: true };
    }),

  listNotes: protectedProcedure
    .input(listTargetContentInputSchema)
    .query(async ({ ctx, input }) => {
      const db = withResearchTargetDb(ctx.db);
      if (input.targetRef) {
        await requireTarget(db, ctx.session.user.id, input.targetRef, {
          allowArchived: true,
        });
      }
      const records = await db.researchNote.findMany({
        where: {
          userId: ctx.session.user.id,
          ...(input.targetRef
            ? { targetType: input.targetRef.type, targetId: input.targetRef.id }
            : {}),
        },
        orderBy: { updatedAt: "desc" },
        take: input.limit,
        skip: input.offset,
      });
      return records.map(buildNote);
    }),

  formatNote: protectedProcedure
    .input(formatResearchNoteInputSchema)
    .mutation(async ({ ctx, input }) => {
      const db = withResearchTargetDb(ctx.db);
      const existing = await db.researchNote.findFirst({
        where: { id: input.id, userId: ctx.session.user.id },
      });
      if (!existing) {
        throw new TRPCError({ code: "NOT_FOUND", message: "笔记不存在" });
      }
      const fallback = `## 整理要点\n\n${existing.contentMarkdown}`;
      const formatted = await new DeepSeekClient().complete(
        [
          {
            role: "user",
            content: formatPrompt(input.mode, existing.contentMarkdown),
          },
        ],
        fallback,
        { model: "deepseek-chat", maxOutputTokens: 900 },
      );
      const updated = await db.researchNote.update({
        where: { id: input.id },
        data: { contentMarkdown: formatted, kind: input.mode },
      });
      return buildNote(updated);
    }),

  createFinancialSnapshot: protectedProcedure
    .input(createFinancialSnapshotInputSchema)
    .mutation(async ({ ctx, input }) => {
      const db = withResearchTargetDb(ctx.db);
      await requireTarget(db, ctx.session.user.id, input.targetRef);
      const created = await db.financialSnapshot.create({
        data: {
          userId: ctx.session.user.id,
          targetType: input.targetRef.type,
          targetId: input.targetRef.id,
          companyRefsJson: input.companyRefs,
          metricSetJson: input.metricSet,
          periodRangeJson: input.periodRange,
          rawSnapshotJson: input.rawSnapshot,
          sourceJson: input.source,
        },
      });
      return buildSnapshot(created);
    }),

  listFinancialSnapshots: protectedProcedure
    .input(listTargetContentInputSchema)
    .query(async ({ ctx, input }) => {
      const db = withResearchTargetDb(ctx.db);
      if (input.targetRef) {
        await requireTarget(db, ctx.session.user.id, input.targetRef, {
          allowArchived: true,
        });
      }
      const records = await db.financialSnapshot.findMany({
        where: {
          userId: ctx.session.user.id,
          ...(input.targetRef
            ? { targetType: input.targetRef.type, targetId: input.targetRef.id }
            : {}),
        },
        orderBy: { createdAt: "desc" },
        take: input.limit,
        skip: input.offset,
      });
      return records.map(buildSnapshot);
    }),

  generateComparisonArtifact: protectedProcedure
    .input(generateComparisonArtifactInputSchema)
    .mutation(async ({ ctx, input }) => {
      const db = withResearchTargetDb(ctx.db);
      const snapshot = await db.financialSnapshot.findFirst({
        where: { id: input.financialSnapshotId, userId: ctx.session.user.id },
      });
      if (!snapshot) {
        throw new TRPCError({ code: "NOT_FOUND", message: "财务快照不存在" });
      }
      await requireTarget(
        db,
        ctx.session.user.id,
        {
          type: snapshot.targetType as ResearchTargetType,
          id: snapshot.targetId,
        },
        { allowArchived: true },
      );
      const markdown = buildComparisonMarkdown(snapshot);
      const created = await db.researchArtifact.create({
        data: {
          userId: ctx.session.user.id,
          targetType: snapshot.targetType,
          targetId: snapshot.targetId,
          financialSnapshotId: snapshot.id,
          artifactType: "financial_comparison_report",
          title: input.title ?? "财务快照比较报告",
          contentType: "text/markdown",
          payloadJson: {
            markdown,
            companyRefs: asCompanyRefs(snapshot.companyRefsJson),
            snapshotId: snapshot.id,
          },
          sourceJson: { kind: "financial_snapshot" },
        },
      });
      return buildArtifact(created);
    }),

  listArtifacts: protectedProcedure
    .input(listTargetContentInputSchema)
    .query(async ({ ctx, input }) => {
      const db = withResearchTargetDb(ctx.db);
      if (input.targetRef) {
        await requireTarget(db, ctx.session.user.id, input.targetRef, {
          allowArchived: true,
        });
      }
      const records = await db.researchArtifact.findMany({
        where: {
          userId: ctx.session.user.id,
          ...(input.targetRef
            ? { targetType: input.targetRef.type, targetId: input.targetRef.id }
            : {}),
        },
        orderBy: { updatedAt: "desc" },
        take: input.limit,
        skip: input.offset,
      });
      return records.map(buildArtifact);
    }),
});
