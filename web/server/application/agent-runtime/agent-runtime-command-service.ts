import type { WorkflowCommandService } from "~/server/application/workflow/command-service";

export type StartAgentRuntimeRunCommand = {
  userId: string;
  skillId: string;
  prompt: string;
  title?: string;
  context?: Record<string, unknown>;
  idempotencyKey?: string;
};

export class AgentRuntimeCommandService {
  constructor(private readonly workflowCommandService: WorkflowCommandService) {}

  async startRun(command: StartAgentRuntimeRunCommand) {
    return this.workflowCommandService.startPiAgentRun(command);
  }

  async cancelRun(userId: string, runId: string) {
    return this.workflowCommandService.cancelRun(userId, runId);
  }
}
