import {
  WORKFLOW_ERROR_CODES,
  WorkflowDomainError,
} from "~/modules/research/server/domain/workflow/errors";
import type { WorkflowGraphRunner } from "~/modules/research/server/workflows/langgraph/workflow-graph";

function buildGraphKey(templateCode: string, templateVersion: number) {
  return `${templateCode}@${templateVersion}`;
}

export class WorkflowGraphRegistry {
  private readonly graphsByCode: Map<string, WorkflowGraphRunner>;
  private readonly graphsByVersion: Map<string, WorkflowGraphRunner>;

  constructor(graphs: WorkflowGraphRunner[]) {
    this.graphsByCode = new Map();
    this.graphsByVersion = new Map();

    for (const graph of graphs) {
      if (typeof graph.templateVersion === "number") {
        this.graphsByVersion.set(
          buildGraphKey(graph.templateCode, graph.templateVersion),
          graph,
        );
      }

      const current = this.graphsByCode.get(graph.templateCode);
      const currentVersion = current?.templateVersion ?? 0;
      const nextVersion = graph.templateVersion ?? 0;

      if (!current || nextVersion >= currentVersion) {
        this.graphsByCode.set(graph.templateCode, graph);
      }
    }
  }

  get(templateCode: string, templateVersion?: number): WorkflowGraphRunner {
    if (typeof templateVersion === "number") {
      const versionedGraph = this.graphsByVersion.get(
        buildGraphKey(templateCode, templateVersion),
      );

      if (versionedGraph) {
        return versionedGraph;
      }

      throw new WorkflowDomainError(
        WORKFLOW_ERROR_CODES.WORKFLOW_TEMPLATE_NOT_FOUND,
        `未注册的工作流模板版本: ${templateCode}@${templateVersion}`,
      );
    }

    const graph = this.graphsByCode.get(templateCode);

    if (!graph) {
      throw new WorkflowDomainError(
        WORKFLOW_ERROR_CODES.WORKFLOW_TEMPLATE_NOT_FOUND,
        `未注册的工作流模板: ${templateCode}${typeof templateVersion === "number" ? `@${templateVersion}` : ""}`,
      );
    }

    return graph;
  }
}
