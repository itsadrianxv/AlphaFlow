import { handleResearchRunEventsRequest } from "~/modules/research/server/http/research-run-events-route";

export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{
    runId: string;
  }>;
};

export async function GET(request: Request, context: RouteContext) {
  return handleResearchRunEventsRequest(request, context);
}
