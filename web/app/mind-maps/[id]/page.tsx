import { MindMapEditorPage } from "~/app/mind-maps/[id]/mind-map-editor-page";
import { requireAuth } from "~/server/auth/require-auth";

export default async function MindMapPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  await requireAuth(`/mind-maps/${id}`);
  return <MindMapEditorPage id={id} />;
}
