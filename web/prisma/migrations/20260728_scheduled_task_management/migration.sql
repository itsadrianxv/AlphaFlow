CREATE TYPE "ScheduledTaskExecutionTrigger" AS ENUM ('SCHEDULED', 'MANUAL');
CREATE TYPE "ScheduledTaskEditDraftSource" AS ENUM ('STRUCTURED', 'AGENT');
CREATE TYPE "ScheduledTaskEditDraftStatus" AS ENUM ('PENDING', 'CONFIRMED', 'DISCARDED');

ALTER TYPE "AgentConversationRoutingMode" ADD VALUE 'SCHEDULED_TASK_EDIT';
ALTER TYPE "ScheduledTaskDeliveryStatus" ADD VALUE 'SKIPPED';

ALTER TABLE "AgentConversation"
ADD COLUMN "activeScheduledTaskEditTaskId" TEXT;

ALTER TABLE "ScheduledTaskExecution"
ADD COLUMN "trigger" "ScheduledTaskExecutionTrigger" NOT NULL DEFAULT 'SCHEDULED',
ADD COLUMN "deliveryRequested" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "idempotencyKey" TEXT;

CREATE UNIQUE INDEX "ScheduledTaskExecution_idempotencyKey_key"
ON "ScheduledTaskExecution"("idempotencyKey");

CREATE TABLE "ScheduledTaskEditDraft" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "conversationId" TEXT,
    "source" "ScheduledTaskEditDraftSource" NOT NULL,
    "status" "ScheduledTaskEditDraftStatus" NOT NULL DEFAULT 'PENDING',
    "baseVersion" INTEGER NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "name" TEXT NOT NULL,
    "userPrompt" TEXT NOT NULL,
    "scheduleSpec" JSONB NOT NULL,
    "dataSources" JSONB NOT NULL DEFAULT '[]',
    "executionPlan" JSONB NOT NULL,
    "outputSpec" JSONB NOT NULL,
    "deliverySpec" JSONB NOT NULL,
    "feasibility" JSONB NOT NULL DEFAULT '{}',
    "changes" JSONB NOT NULL DEFAULT '[]',
    "nextRunAt" TIMESTAMP(3),
    "idempotencyKey" TEXT,
    "confirmedAt" TIMESTAMP(3),
    "discardedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ScheduledTaskEditDraft_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ScheduledTaskEditDraft_idempotencyKey_key"
ON "ScheduledTaskEditDraft"("idempotencyKey");
CREATE INDEX "ScheduledTaskEditDraft_taskId_status_updatedAt_idx"
ON "ScheduledTaskEditDraft"("taskId", "status", "updatedAt");
CREATE INDEX "ScheduledTaskEditDraft_userId_status_updatedAt_idx"
ON "ScheduledTaskEditDraft"("userId", "status", "updatedAt");
CREATE INDEX "ScheduledTaskEditDraft_conversationId_status_idx"
ON "ScheduledTaskEditDraft"("conversationId", "status");

ALTER TABLE "ScheduledTaskEditDraft"
ADD CONSTRAINT "ScheduledTaskEditDraft_taskId_fkey"
FOREIGN KEY ("taskId") REFERENCES "ScheduledTask"("id") ON DELETE CASCADE ON UPDATE CASCADE;
