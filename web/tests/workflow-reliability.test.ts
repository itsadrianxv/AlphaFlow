import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const workerSource = readFileSync(
  "tooling/workers/workflow-worker.ts",
  "utf8",
);
const executionSource = readFileSync(
  "server/application/workflow/execution-service.ts",
  "utf8",
);
const repositorySource = readFileSync(
  "server/infrastructure/workflow/prisma/workflow-run-repository.ts",
  "utf8",
);
const conversationSource = readFileSync(
  "server/infrastructure/agent-runtime/prisma-agent-conversation-repository.ts",
  "utf8",
);
const commandSource = readFileSync(
  "server/application/workflow/command-service.ts",
  "utf8",
);
const schemaSource = readFileSync("prisma/schema.prisma", "utf8");

describe("workflow reliability guards", () => {
  it("只恢复超过节点超时且被原子领取的运行", () => {
    expect(workerSource).toContain("void recoverLegacyRuns();");
    expect(workerSource.indexOf("void recoverLegacyRuns();")).toBeLessThan(
      workerSource.indexOf("await Promise.all("),
    );
    expect(workerSource).toContain("Array.from({ length: concurrency }");
    expect(executionSource).toContain("claimRecoverableRunningRun");
    expect(executionSource).not.toContain("listRunningRuns(10)");
    expect(repositorySource).toContain('"updatedAt" < ${params.staleBefore}');
    expect(repositorySource).toContain("FOR UPDATE SKIP LOCKED");
  });

  it("claims pending runs with database row locking", () => {
    expect(repositorySource).toContain("FOR UPDATE SKIP LOCKED");
    expect(repositorySource).toContain('CAST(${WorkflowRunStatus.PENDING} AS "WorkflowRunStatus")');
  });

  it("pauses timed-out nodes and propagates cancellation to graph execution", () => {
    expect(executionSource).toContain("WORKFLOW_NODE_TIMEOUT");
    expect(executionSource).toContain("WORKFLOW_NODE_TIMEOUT_MS");
    expect(executionSource).toContain("executionAbortController.abort");
    expect(executionSource).toContain('reason: "node_timeout"');
    expect(executionSource).toContain("markAssistantFailedByRun");
  });

  it("把会话仓储注入顶层 workflow 执行服务", () => {
    expect(workerSource).toMatch(
      /new WorkflowExecutionService\(\{[\s\S]*agentConversationRepository,\s*\}\);/,
    );
  });

  it("uses one binding per workflow run and per assistant message", () => {
    expect(conversationSource).toContain("FOR UPDATE");
    expect(conversationSource).toContain("AGENT_WORKFLOW_RUN_ALREADY_BOUND");
    expect(schemaSource).toContain("workflowRunId  String?                        @unique");
    expect(commandSource).toContain("pi-agent-message:${command.userId}:${command.assistantMessageId}");
  });

  it("串行分配事件序号并清理不可恢复的等待消息", () => {
    expect(repositorySource).toContain("pg_advisory_xact_lock");
    expect(conversationSource).toContain("pg_advisory_xact_lock");
    expect(conversationSource).toContain(
      "AgentConversationMessageStatus.WAITING_FOR_INPUT",
    );
    expect(conversationSource).toContain("AGENT_WAITING_RUN_NOT_RESUMABLE");
    expect(executionSource).toContain("markAssistantFailedByRun");
  });
});
