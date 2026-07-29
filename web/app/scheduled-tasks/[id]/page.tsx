import { ScheduledTaskDetailClient } from "~/app/scheduled-tasks/[id]/scheduled-task-detail-client";
import { requireAuth } from "~/server/auth/require-auth";

export default async function ScheduledTaskDetailPage(props: {
  params: Promise<{ id: string }>;
}) {
  await requireAuth("/scheduled-tasks");
  const { id } = await props.params;
  return <ScheduledTaskDetailClient taskId={id} />;
}
