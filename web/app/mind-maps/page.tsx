import { MindMapsClient } from "~/app/mind-maps/mind-maps-client";
import { requireAuth } from "~/server/auth/require-auth";

export default async function MindMapsPage() {
  await requireAuth("/mind-maps");
  return <MindMapsClient />;
}
