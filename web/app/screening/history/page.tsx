import { ScreeningHistoryClient } from "~/app/screening/history/screening-history-client";
import { requireAuth } from "~/server/auth/require-auth";

export default async function ScreeningHistoryPage() {
  await requireAuth("/screening/history");

  return <ScreeningHistoryClient />;
}
