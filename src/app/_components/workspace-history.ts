import type { WorkspaceHistoryItem } from "~/app/_components/workspace-shell";

export function buildScreeningWorkspaceHistoryItems(
  workspaces: Array<{ id: string; name: string }>,
): WorkspaceHistoryItem[] {
  return workspaces.map((workspace) => ({
    id: workspace.id,
    title: workspace.name,
    href: `/screening?workspaceId=${workspace.id}`,
  }));
}

export function buildWorkflowRunHistoryItems(
  runs: Array<{ id: string; query: string }>,
): WorkspaceHistoryItem[] {
  return runs.map((run) => ({
    id: run.id,
    title: run.query,
    href: `/workflows/${run.id}`,
  }));
}
