-- CreateTable
CREATE TABLE "AgentToolCall" (
    "id" TEXT NOT NULL,
    "workflowRunId" TEXT NOT NULL,
    "skillId" TEXT NOT NULL,
    "externalToolCallId" TEXT,
    "toolName" TEXT NOT NULL,
    "inputSummary" JSONB,
    "outputSummary" JSONB,
    "status" TEXT NOT NULL,
    "durationMs" INTEGER,
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AgentToolCall_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgentArtifact" (
    "id" TEXT NOT NULL,
    "workflowRunId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "contentType" TEXT NOT NULL,
    "uri" TEXT,
    "payload" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AgentArtifact_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AgentToolCall_workflowRunId_createdAt_idx" ON "AgentToolCall"("workflowRunId", "createdAt");

-- CreateIndex
CREATE INDEX "AgentToolCall_workflowRunId_externalToolCallId_idx" ON "AgentToolCall"("workflowRunId", "externalToolCallId");

-- CreateIndex
CREATE INDEX "AgentToolCall_skillId_createdAt_idx" ON "AgentToolCall"("skillId", "createdAt");

-- CreateIndex
CREATE INDEX "AgentArtifact_workflowRunId_createdAt_idx" ON "AgentArtifact"("workflowRunId", "createdAt");

-- CreateIndex
CREATE INDEX "AgentArtifact_kind_createdAt_idx" ON "AgentArtifact"("kind", "createdAt");

-- AddForeignKey
ALTER TABLE "AgentToolCall" ADD CONSTRAINT "AgentToolCall_workflowRunId_fkey" FOREIGN KEY ("workflowRunId") REFERENCES "WorkflowRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentArtifact" ADD CONSTRAINT "AgentArtifact_workflowRunId_fkey" FOREIGN KEY ("workflowRunId") REFERENCES "WorkflowRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;
