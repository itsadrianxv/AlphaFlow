import { ScheduledTasksClient } from "~/app/scheduled-tasks/scheduled-tasks-client";
import { requireAuth } from "~/server/auth/require-auth";

export default async function ScheduledTasksPage() {
  await requireAuth("/scheduled-tasks");
  return <ScheduledTasksClient />;
}
