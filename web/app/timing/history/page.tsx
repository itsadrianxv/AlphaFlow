import { TimingHistoryClient } from "~/app/timing/history/timing-history-client";
import { requireAuth } from "~/server/auth/require-auth";

export default async function TimingHistoryPage() {
  await requireAuth("/timing/history");

  return <TimingHistoryClient />;
}
