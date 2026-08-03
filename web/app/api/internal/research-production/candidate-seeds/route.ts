import { ZodError } from "zod";
import { env } from "~/env";
import { enqueueResearchCandidateSeed } from "~/server/application/research-production/candidate-production";
import { db } from "~/server/db";

export const runtime = "nodejs";

export async function POST(request: Request) {
  if (
    !env.ALPHAFLOW_INTERNAL_API_SECRET ||
    request.headers.get("X-Alphaflow-Internal-Secret") !==
      env.ALPHAFLOW_INTERNAL_API_SECRET
  ) {
    return Response.json({ error: "UNAUTHORIZED" }, { status: 401 });
  }

  try {
    const result = await enqueueResearchCandidateSeed(
      db,
      await request.json().catch(() => null),
    );
    return Response.json(
      { contractVersion: "research-candidate-seed-result.v1", result },
      { status: result.created ? 202 : 200 },
    );
  } catch (error) {
    if (error instanceof ZodError) {
      return Response.json(
        { error: "CONTRACT_INCOMPATIBLE", details: error.flatten() },
        { status: 400 },
      );
    }
    return Response.json(
      {
        error: "CANDIDATE_SEED_ENQUEUE_FAILED",
        retryable: true,
        message: error instanceof Error ? error.message : String(error),
      },
      { status: 503 },
    );
  }
}
