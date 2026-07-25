import type { Prisma } from "@prisma/client";
import { writeEvidenceContext } from "~/server/application/evidence-context/evidence-context-writer";
import { db } from "~/server/db";
import { PrismaEvidenceContextRepository } from "~/server/infrastructure/evidence-context/prisma-evidence-context-repository";

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asText(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function asArray(value: unknown) {
  return Array.isArray(value) ? value.filter(isRecord) : [];
}

function toJson(value: unknown): Prisma.InputJsonValue {
  return value as Prisma.InputJsonValue;
}

async function main() {
  const repository = new PrismaEvidenceContextRepository(db);
  const runs = await db.workflowRun.findMany({
    where: {},
    select: { id: true, userId: true, input: true, result: true },
    orderBy: { createdAt: "asc" },
  });
  let migrated = 0;

  for (const run of runs) {
    if (!isRecord(run.result) || run.result.evidenceContextMigrationVersion) {
      continue;
    }

    const result = run.result;
    const sourceItems = [
      ...asArray(result.references),
      ...asArray(result.evidence),
    ];
    if (sourceItems.length === 0) continue;

    const evidence = await writeEvidenceContext({
      writer: repository,
      userId: run.userId,
      workflowRunId: run.id,
      subject: {
        subjectType: "legacy",
        subjectId: run.id,
        label: asText(result.brief) ?? `历史工作流 ${run.id}`,
      },
      phase: "legacy_migration",
      metadata: { migration: "legacy-evidence-context-v1" },
      blocks: [
        {
          blockKey: "legacy_evidence",
          sourceType: "legacy_workflow_result",
          sourceId: run.id,
          sourceName: "历史工作流结果",
          items: sourceItems.map((item, index) => ({
            itemKey:
              asText(item.id) ??
              asText(item.referenceId) ??
              `legacy-${index + 1}`,
            status: "available" as const,
            extractedFact:
              asText(item.extractedFact) ??
              asText(item.evidenceSummary) ??
              asText(item.summary),
            snippet: asText(item.snippet) ?? asText(item.title),
            sourceType: asText(item.sourceType) ?? "legacy",
            sourceId: asText(item.id) ?? asText(item.referenceId),
            sourceName: asText(item.sourceName) ?? "历史来源",
            url: asText(item.url),
            publishedAt: asText(item.publishedAt) ?? asText(item.updatedAt),
            observedAt: new Date().toISOString(),
            fetchedAt: new Date().toISOString(),
            valueJson: item,
          })),
        },
      ],
    });

    const nextResult = {
      ...result,
      evidenceCitations: evidence.citations,
      evidenceContextMigrationVersion: "1",
      evidenceContextIds: [evidence.context.id],
    };
    await db.workflowRun.update({
      where: { id: run.id },
      data: { result: toJson(nextResult) },
    });
    migrated += 1;
  }

  console.log(`迁移完成：${migrated} 个工作流结果`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
