import { ZodError } from "zod";
import { env } from "~/env";
import { runResearchProduction } from "~/server/application/research-production/production";
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
    const result = await runResearchProduction(
      db,
      await request.json().catch(() => null),
    );
    return Response.json({
      contractVersion: "research-production-result.v1",
      result,
    });
  } catch (error) {
    if (error instanceof ZodError) {
      return Response.json(
        {
          error: "CONTRACT_INCOMPATIBLE",
          details: error.flatten(),
        },
        { status: 400 },
      );
    }
    return Response.json(
      {
        error: "RESEARCH_PRODUCTION_FAILED",
        retryable: true,
        message: error instanceof Error ? error.message : String(error),
      },
      { status: 502 },
    );
  }
}
