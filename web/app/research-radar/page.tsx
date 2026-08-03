import { ResearchRadarClient } from "~/app/research-radar/research-radar-client";
import { requireAuth } from "~/server/auth/require-auth";

export default async function ResearchRadarPage() {
  await requireAuth("/research-radar");
  return <ResearchRadarClient />;
}
