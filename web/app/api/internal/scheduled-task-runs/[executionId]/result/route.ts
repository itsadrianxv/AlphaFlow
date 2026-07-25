import { Prisma } from "@prisma/client";
import { z } from "zod";
import { env } from "~/env";
import { db } from "~/server/db";

export const runtime = "nodejs";

const evidenceSchema = z.object({
  sourceType: z.string().min(1),
  sourceId: z.string().min(1),
  title: z.string().optional(),
  url: z.string().optional(),
  observedAt: z.string().datetime().optional(),
  content: z.string().optional(),
  metadata: z.record(z.unknown()).optional(),
});
const requestSchema = z.object({
  runId: z.string().min(1),
  status: z.enum(["SUCCEEDED", "FAILED", "CANCELLED"]),
  title: z.string().optional(),
  summary: z.string().optional(),
  body: z.string().optional(),
  evidence: z.array(evidenceSchema).default([]),
  quality: z.record(z.unknown()).optional(),
  error: z.record(z.unknown()).optional(),
});

export async function POST(
  request: Request,
  context: { params: Promise<{ executionId: string }> },
) {
  if (
    !env.ALPHAFLOW_INTERNAL_API_SECRET ||
    request.headers.get("X-Alphaflow-Internal-Secret") !==
      env.ALPHAFLOW_INTERNAL_API_SECRET
  )
    return Response.json({ error: "UNAUTHORIZED" }, { status: 401 });
  const parsed = requestSchema.safeParse(
    await request.json().catch(() => null),
  );
  if (!parsed.success)
    return Response.json(
      { error: "INVALID_REQUEST", details: parsed.error.flatten() },
      { status: 400 },
    );
  const { executionId } = await context.params;
  const existing = await db.scheduledTaskExecution.findUnique({
    where: { id: executionId },
  });
  if (!existing || existing.agentRunId !== parsed.data.runId)
    return Response.json({ error: "EXECUTION_NOT_FOUND" }, { status: 404 });
  if (["SUCCEEDED", "FAILED", "CANCELLED"].includes(existing.status))
    return Response.json({ ok: true, idempotent: true });
  const result = {
    title: parsed.data.title,
    summary: parsed.data.summary,
    body: parsed.data.body,
    quality: parsed.data.quality,
  };
  await db.$transaction(async (tx) => {
    const updated = await tx.scheduledTaskExecution.updateMany({
      where: {
        id: executionId,
        status: { in: ["SUBMITTED", "RUNNING", "RETRYING"] },
      },
      data: {
        status: parsed.data.status,
        result: result as unknown as Prisma.InputJsonObject,
        error: parsed.data.error
          ? (parsed.data.error as Prisma.InputJsonObject)
          : Prisma.JsonNull,
        completedAt: new Date(),
      },
    });
    if (updated.count === 1 && parsed.data.evidence.length)
      await tx.scheduledTaskEvidence.createMany({
        data: parsed.data.evidence.map((item) => ({
          executionId,
          sourceType: item.sourceType,
          sourceId: item.sourceId,
          title: item.title,
          url: item.url,
          observedAt: item.observedAt ? new Date(item.observedAt) : undefined,
          content: item.content,
          metadata: item.metadata
            ? (item.metadata as Prisma.InputJsonObject)
            : Prisma.JsonNull,
        })),
      });
  });
  return Response.json({ ok: true });
}
