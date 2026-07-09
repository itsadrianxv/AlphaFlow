import { z } from "zod";
import { env } from "~/env";
import { db } from "~/server/db";
import { PI_AGENT_RUN_TEMPLATE_CODE } from "~/server/domain/workflow/types";

export const runtime = "nodejs";

const TARGET_TYPES = ["company", "industry", "watchlist"] as const;

const targetRefSchema = z.object({
  type: z.enum(TARGET_TYPES),
  id: z.string().min(1),
});

const requestSchema = z.object({
  operation: z.enum([
    "internal_research_targets_list",
    "internal_research_target_detail",
    "internal_research_notes_list",
    "internal_research_artifacts_list",
    "internal_watchlist_detail",
  ]),
  runId: z.string().min(1),
  userId: z.string().min(1),
  params: z.record(z.unknown()).default({}),
});

type SavedCompanyRecord = {
  id: string;
  stockCode: string;
  companyName: string;
  reason: string | null;
  tags: string[];
  metadataJson: unknown;
  createdAt: Date;
  updatedAt: Date;
};

type SavedIndustryRecord = {
  id: string;
  name: string;
  source: string;
  reason: string | null;
  tags: string[];
  relatedCompaniesJson: unknown;
  metadataJson: unknown;
  createdAt: Date;
  updatedAt: Date;
};

type ResearchNoteRecord = {
  id: string;
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

type ResearchArtifactRecord = {
  id: string;
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

type ResearchToolDb = typeof db & {
  savedCompany: {
    findMany(args: Record<string, unknown>): Promise<SavedCompanyRecord[]>;
    findFirst(args: Record<string, unknown>): Promise<SavedCompanyRecord | null>;
  };
  savedIndustry: {
    findMany(args: Record<string, unknown>): Promise<SavedIndustryRecord[]>;
    findFirst(args: Record<string, unknown>): Promise<SavedIndustryRecord | null>;
  };
  researchNote: {
    count(args: Record<string, unknown>): Promise<number>;
    findMany(args: Record<string, unknown>): Promise<ResearchNoteRecord[]>;
  };
  researchArtifact: {
    count(args: Record<string, unknown>): Promise<number>;
    findMany(args: Record<string, unknown>): Promise<ResearchArtifactRecord[]>;
  };
  financialSnapshot: {
    count(args: Record<string, unknown>): Promise<number>;
  };
};

const researchDb = db as ResearchToolDb;

function jsonResponse(status: number, body: unknown) {
  return Response.json(body, { status });
}

function toIso(value: Date | null | undefined) {
  return value ? value.toISOString() : null;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function asStringArray(value: unknown) {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function asCompanyRefs(value: unknown) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((item) => {
    const record = asRecord(item);
    return typeof record.stockCode === "string" &&
      typeof record.companyName === "string"
      ? [{ stockCode: record.stockCode, companyName: record.companyName }]
      : [];
  });
}

function asStocks(value: unknown) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((item) => {
    const record = asRecord(item);
    if (
      typeof record.stockCode !== "string" ||
      typeof record.stockName !== "string"
    ) {
      return [];
    }

    return [
      {
        stockCode: record.stockCode,
        stockName: record.stockName,
        addedAt: typeof record.addedAt === "string" ? record.addedAt : null,
        note: typeof record.note === "string" ? record.note : null,
        tags: asStringArray(record.tags),
      },
    ];
  });
}

function normalizeLimit(value: unknown, fallback: number, max: number) {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed)
    ? Math.min(Math.max(Math.trunc(parsed), 1), max)
    : fallback;
}

function normalizeOffset(value: unknown) {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? Math.max(Math.trunc(parsed), 0) : 0;
}

function truncate(value: string, maxLength: number) {
  if (value.length <= maxLength) {
    return { preview: value, truncated: false };
  }

  return {
    preview: `${value.slice(0, maxLength)}...[truncated]`,
    truncated: true,
  };
}

function matchesQuery(values: Array<string | null | undefined>, query?: string) {
  if (!query?.trim()) {
    return true;
  }

  const normalized = query.trim().toLowerCase();
  return values.some((value) => value?.toLowerCase().includes(normalized));
}

function parseTypes(value: unknown) {
  if (!Array.isArray(value)) {
    return new Set<(typeof TARGET_TYPES)[number]>(TARGET_TYPES);
  }

  const allowed = new Set(TARGET_TYPES);
  const types = value.filter(
    (item): item is (typeof TARGET_TYPES)[number] =>
      typeof item === "string" && allowed.has(item as never),
  );
  return new Set(types.length > 0 ? types : TARGET_TYPES);
}

function artifactPreview(value: unknown, contentLimit: number) {
  const payload = asRecord(value);
  const markdown =
    typeof payload.markdown === "string"
      ? payload.markdown
      : typeof value === "string"
        ? value
        : JSON.stringify(value);

  return truncate(markdown ?? "", contentLimit);
}

async function requirePiAgentRun(runId: string, userId: string) {
  const run = await db.workflowRun.findFirst({
    where: {
      id: runId,
      userId,
      template: {
        is: {
          code: PI_AGENT_RUN_TEMPLATE_CODE,
        },
      },
    },
    select: {
      id: true,
      status: true,
      template: {
        select: {
          code: true,
        },
      },
    },
  });

  if (!run) {
    return null;
  }

  return run;
}

async function listTargets(userId: string, params: Record<string, unknown>) {
  const limit = normalizeLimit(params.limit, 50, 100);
  const query = typeof params.query === "string" ? params.query : undefined;
  const types = parseTypes(params.types);
  const items = [];

  if (types.has("company")) {
    const records = await researchDb.savedCompany.findMany({
      where: { userId, archivedAt: null },
      orderBy: { updatedAt: "desc" },
      take: limit,
    });
    for (const record of records) {
      if (matchesQuery([record.stockCode, record.companyName, record.reason], query)) {
        items.push({
          ref: { type: "company", id: record.id },
          label: `${record.companyName} (${record.stockCode})`,
          description: record.reason,
          tags: record.tags,
          updatedAt: record.updatedAt.toISOString(),
        });
      }
    }
  }

  if (types.has("industry")) {
    const records = await researchDb.savedIndustry.findMany({
      where: { userId, archivedAt: null },
      orderBy: { updatedAt: "desc" },
      take: limit,
    });
    for (const record of records) {
      if (matchesQuery([record.name, record.source, record.reason], query)) {
        items.push({
          ref: { type: "industry", id: record.id },
          label: record.name,
          description: record.reason ?? record.source,
          tags: record.tags,
          updatedAt: record.updatedAt.toISOString(),
        });
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
        items.push({
          ref: { type: "watchlist", id: record.id },
          label: record.name,
          description: record.description,
          tags: [],
          stockCount: asStocks(record.stocks).length,
          updatedAt: record.updatedAt.toISOString(),
        });
      }
    }
  }

  return {
    items: items
      .sort(
        (left, right) =>
          new Date(right.updatedAt ?? 0).getTime() -
          new Date(left.updatedAt ?? 0).getTime(),
      )
      .slice(0, limit),
    warnings: [],
    diagnostics: { limit, query: query ?? null, types: [...types] },
  };
}

async function getTargetDetail(userId: string, params: Record<string, unknown>) {
  const targetRef = targetRefSchema.parse(params.targetRef);
  const [noteCount, artifactCount, snapshotCount] = await Promise.all([
    researchDb.researchNote.count({
      where: { userId, targetType: targetRef.type, targetId: targetRef.id },
    }),
    researchDb.researchArtifact.count({
      where: { userId, targetType: targetRef.type, targetId: targetRef.id },
    }),
    researchDb.financialSnapshot.count({
      where: { userId, targetType: targetRef.type, targetId: targetRef.id },
    }),
  ]);

  if (targetRef.type === "company") {
    const record = await researchDb.savedCompany.findFirst({
      where: { id: targetRef.id, userId, archivedAt: null },
    });
    if (!record) {
      return { item: null, warnings: ["投研对象不存在或无权限访问"], diagnostics: { targetRef } };
    }

    return {
      item: {
        ref: targetRef,
        stockCode: record.stockCode,
        companyName: record.companyName,
        reason: record.reason,
        tags: record.tags,
        metadata: asRecord(record.metadataJson),
        contentCounts: { notes: noteCount, artifacts: artifactCount, snapshots: snapshotCount },
        createdAt: record.createdAt.toISOString(),
        updatedAt: record.updatedAt.toISOString(),
      },
      warnings: [],
      diagnostics: { targetRef },
    };
  }

  if (targetRef.type === "industry") {
    const record = await researchDb.savedIndustry.findFirst({
      where: { id: targetRef.id, userId, archivedAt: null },
    });
    if (!record) {
      return { item: null, warnings: ["投研对象不存在或无权限访问"], diagnostics: { targetRef } };
    }

    return {
      item: {
        ref: targetRef,
        name: record.name,
        source: record.source,
        reason: record.reason,
        tags: record.tags,
        relatedCompanies: asCompanyRefs(record.relatedCompaniesJson),
        metadata: asRecord(record.metadataJson),
        contentCounts: { notes: noteCount, artifacts: artifactCount, snapshots: snapshotCount },
        createdAt: record.createdAt.toISOString(),
        updatedAt: record.updatedAt.toISOString(),
      },
      warnings: [],
      diagnostics: { targetRef },
    };
  }

  const record = await db.watchList.findFirst({
    where: { id: targetRef.id, userId },
  });
  if (!record) {
    return { item: null, warnings: ["投研对象不存在或无权限访问"], diagnostics: { targetRef } };
  }

  const stocks = asStocks(record.stocks);
  return {
    item: {
      ref: targetRef,
      name: record.name,
      description: record.description,
      stockCount: stocks.length,
      stockPreview: stocks.slice(0, 10),
      contentCounts: { notes: noteCount, artifacts: artifactCount, snapshots: snapshotCount },
      createdAt: record.createdAt.toISOString(),
      updatedAt: record.updatedAt.toISOString(),
    },
    warnings: stocks.length > 10 ? ["自选股详情仅返回前 10 只股票预览，完整成员请调用 internal_watchlist_detail"] : [],
    diagnostics: { targetRef },
  };
}

async function listNotes(userId: string, params: Record<string, unknown>) {
  const limit = normalizeLimit(params.limit, 20, 50);
  const contentLimit = normalizeLimit(params.contentLimit, 800, 2000);
  const query = typeof params.query === "string" ? params.query : undefined;
  const parsedTargetRef = params.targetRef
    ? targetRefSchema.parse(params.targetRef)
    : undefined;
  const records = await researchDb.researchNote.findMany({
    where: {
      userId,
      ...(parsedTargetRef
        ? { targetType: parsedTargetRef.type, targetId: parsedTargetRef.id }
        : {}),
    },
    orderBy: { updatedAt: "desc" },
    take: limit,
  });

  const items = records
    .filter((record) =>
      matchesQuery(
        [record.title, record.kind, record.contentMarkdown, record.rawContent],
        query,
      ),
    )
    .map((record) => {
      const content = truncate(record.contentMarkdown, contentLimit);
      return {
        id: record.id,
        targetRef: { type: record.targetType, id: record.targetId },
        title: record.title,
        kind: record.kind,
        contentPreview: content.preview,
        truncated: content.truncated,
        tags: record.tags,
        source: record.sourceJson ?? null,
        createdAt: record.createdAt.toISOString(),
        updatedAt: record.updatedAt.toISOString(),
      };
    });

  return {
    items,
    warnings: items.some((item) => item.truncated) ? ["部分笔记内容已截断"] : [],
    diagnostics: { limit, contentLimit, query: query ?? null, targetRef: parsedTargetRef ?? null },
  };
}

async function listArtifacts(userId: string, params: Record<string, unknown>) {
  const limit = normalizeLimit(params.limit, 20, 50);
  const contentLimit = normalizeLimit(params.contentLimit, 800, 2000);
  const query = typeof params.query === "string" ? params.query : undefined;
  const artifactType =
    typeof params.artifactType === "string" ? params.artifactType : undefined;
  const parsedTargetRef = params.targetRef
    ? targetRefSchema.parse(params.targetRef)
    : undefined;
  const records = await researchDb.researchArtifact.findMany({
    where: {
      userId,
      ...(parsedTargetRef
        ? { targetType: parsedTargetRef.type, targetId: parsedTargetRef.id }
        : {}),
      ...(artifactType ? { artifactType } : {}),
    },
    orderBy: { updatedAt: "desc" },
    take: limit,
  });

  const items = records
    .filter((record) =>
      matchesQuery([record.title, record.artifactType, record.contentType], query),
    )
    .map((record) => {
      const preview = artifactPreview(record.payloadJson, contentLimit);
      return {
        id: record.id,
        targetRef: { type: record.targetType, id: record.targetId },
        financialSnapshotId: record.financialSnapshotId,
        artifactType: record.artifactType,
        title: record.title,
        contentType: record.contentType,
        contentPreview: preview.preview,
        truncated: preview.truncated,
        source: record.sourceJson ?? null,
        createdAt: record.createdAt.toISOString(),
        updatedAt: record.updatedAt.toISOString(),
      };
    });

  return {
    items,
    warnings: items.some((item) => item.truncated) ? ["部分研究报告内容已截断"] : [],
    diagnostics: {
      limit,
      contentLimit,
      query: query ?? null,
      artifactType: artifactType ?? null,
      targetRef: parsedTargetRef ?? null,
    },
  };
}

async function getWatchlistDetail(userId: string, params: Record<string, unknown>) {
  const watchListId =
    typeof params.watchListId === "string" ? params.watchListId : "";
  if (!watchListId) {
    throw new Error("watchListId 不能为空");
  }

  const stockLimit = normalizeLimit(params.stockLimit, 50, 100);
  const stockOffset = normalizeOffset(params.stockOffset);
  const record = await db.watchList.findFirst({
    where: { id: watchListId, userId },
  });
  if (!record) {
    return {
      item: null,
      warnings: ["自选股列表不存在或无权限访问"],
      diagnostics: { watchListId, stockLimit, stockOffset },
    };
  }

  const stocks = asStocks(record.stocks);
  return {
    item: {
      id: record.id,
      targetRef: { type: "watchlist", id: record.id },
      name: record.name,
      description: record.description,
      stockCount: stocks.length,
      stocks: stocks.slice(stockOffset, stockOffset + stockLimit),
      createdAt: record.createdAt.toISOString(),
      updatedAt: record.updatedAt.toISOString(),
    },
    warnings:
      stockOffset + stockLimit < stocks.length
        ? ["自选股列表还有更多成员，可调整 stockOffset 继续读取"]
        : [],
    diagnostics: { watchListId, stockLimit, stockOffset },
  };
}

async function dispatch(operation: string, userId: string, params: Record<string, unknown>) {
  switch (operation) {
    case "internal_research_targets_list":
      return listTargets(userId, params);
    case "internal_research_target_detail":
      return getTargetDetail(userId, params);
    case "internal_research_notes_list":
      return listNotes(userId, params);
    case "internal_research_artifacts_list":
      return listArtifacts(userId, params);
    case "internal_watchlist_detail":
      return getWatchlistDetail(userId, params);
    default:
      return null;
  }
}

export async function POST(request: Request) {
  const configuredSecret = env.ALPHAFLOW_INTERNAL_API_SECRET;
  const providedSecret = request.headers.get("X-Alphaflow-Internal-Secret");

  if (!configuredSecret || providedSecret !== configuredSecret) {
    return jsonResponse(401, { error: "UNAUTHORIZED" });
  }

  const parsed = requestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return jsonResponse(400, {
      error: "INVALID_REQUEST",
      details: parsed.error.flatten(),
    });
  }

  const run = await requirePiAgentRun(parsed.data.runId, parsed.data.userId);
  if (!run) {
    return jsonResponse(403, { error: "RUN_FORBIDDEN" });
  }

  try {
    const result = await dispatch(
      parsed.data.operation,
      parsed.data.userId,
      parsed.data.params,
    );
    return jsonResponse(200, {
      provider: "alphaflow",
      operation: parsed.data.operation,
      request: {
        runId: parsed.data.runId,
        userId: parsed.data.userId,
        params: parsed.data.params,
      },
      ...result,
      diagnostics: {
        ...(asRecord(result).diagnostics ?? {}),
        runStatus: run.status,
        generatedAt: new Date().toISOString(),
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "内部投研对象工具失败";
    return jsonResponse(400, { error: "TOOL_FAILED", message });
  }
}
