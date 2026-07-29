CREATE TYPE "AgentConversationRoutingMode" AS ENUM ('AUTO', 'SCHEDULED_TASK_SETUP');

ALTER TABLE "ScheduledTask"
ADD COLUMN "setupConversationId" TEXT;

ALTER TABLE "ScheduledTaskVersion"
ADD COLUMN "dataSources" JSONB NOT NULL DEFAULT '[]',
ADD COLUMN "feasibility" JSONB NOT NULL DEFAULT '{}',
ADD COLUMN "idempotencyKey" TEXT;

ALTER TABLE "AgentConversation"
ADD COLUMN "routingMode" "AgentConversationRoutingMode" NOT NULL DEFAULT 'AUTO',
ADD COLUMN "activeScheduledTaskDraftId" TEXT;

CREATE INDEX "ScheduledTask_userId_status_setupConversationId_idx"
ON "ScheduledTask"("userId", "status", "setupConversationId");

CREATE UNIQUE INDEX "ScheduledTaskVersion_idempotencyKey_key"
ON "ScheduledTaskVersion"("idempotencyKey");
