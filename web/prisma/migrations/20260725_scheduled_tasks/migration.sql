CREATE TYPE "ScheduledTaskStatus" AS ENUM ('DRAFT', 'ACTIVE', 'PAUSED', 'CANCELLED');
CREATE TYPE "ScheduledTaskExecutionStatus" AS ENUM ('PENDING', 'CLAIMED', 'SUBMITTED', 'RUNNING', 'SUCCEEDED', 'FAILED', 'RETRYING', 'CANCELLED');
CREATE TYPE "ScheduledTaskDeliveryStatus" AS ENUM ('PENDING', 'SENT', 'FAILED', 'RETRYING');

CREATE TABLE "ScheduledTask" (
  "id" TEXT NOT NULL, "userId" TEXT NOT NULL, "name" TEXT NOT NULL,
  "status" "ScheduledTaskStatus" NOT NULL DEFAULT 'DRAFT', "currentVersion" INTEGER NOT NULL DEFAULT 1,
  "timezone" TEXT NOT NULL DEFAULT 'Asia/Shanghai', "nextRunAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ScheduledTask_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "ScheduledTaskVersion" (
  "id" TEXT NOT NULL, "taskId" TEXT NOT NULL, "version" INTEGER NOT NULL, "userPrompt" TEXT NOT NULL,
  "scheduleSpec" JSONB NOT NULL, "executionPlan" JSONB NOT NULL, "outputSpec" JSONB NOT NULL,
  "deliverySpec" JSONB NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ScheduledTaskVersion_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "ScheduledTaskExecution" (
  "id" TEXT NOT NULL, "taskId" TEXT NOT NULL, "taskVersionId" TEXT NOT NULL, "scheduledAt" TIMESTAMP(3) NOT NULL,
  "status" "ScheduledTaskExecutionStatus" NOT NULL DEFAULT 'PENDING', "workerId" TEXT, "agentRunId" TEXT,
  "result" JSONB, "error" JSONB, "attempts" INTEGER NOT NULL DEFAULT 0, "claimedAt" TIMESTAMP(3),
  "startedAt" TIMESTAMP(3), "completedAt" TIMESTAMP(3), "eventPublishedAt" TIMESTAMP(3), "lastEventError" JSONB, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL, CONSTRAINT "ScheduledTaskExecution_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "ScheduledTaskEvidence" (
  "id" TEXT NOT NULL, "executionId" TEXT NOT NULL, "sourceType" TEXT NOT NULL, "sourceId" TEXT NOT NULL,
  "title" TEXT, "url" TEXT, "observedAt" TIMESTAMP(3), "content" TEXT, "metadata" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, CONSTRAINT "ScheduledTaskEvidence_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "ScheduledTaskDelivery" (
  "id" TEXT NOT NULL, "executionId" TEXT NOT NULL, "targetType" TEXT NOT NULL, "targetRef" TEXT,
  "status" "ScheduledTaskDeliveryStatus" NOT NULL DEFAULT 'PENDING', "attempts" INTEGER NOT NULL DEFAULT 0,
  "error" TEXT, "sentAt" TIMESTAMP(3), "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL, CONSTRAINT "ScheduledTaskDelivery_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ScheduledTaskVersion_taskId_version_key" ON "ScheduledTaskVersion"("taskId", "version");
CREATE UNIQUE INDEX "ScheduledTaskExecution_taskId_taskVersionId_scheduledAt_key" ON "ScheduledTaskExecution"("taskId", "taskVersionId", "scheduledAt");
CREATE UNIQUE INDEX "ScheduledTaskDelivery_executionId_targetType_targetRef_key" ON "ScheduledTaskDelivery"("executionId", "targetType", "targetRef");
CREATE INDEX "ScheduledTask_status_nextRunAt_idx" ON "ScheduledTask"("status", "nextRunAt");
CREATE INDEX "ScheduledTask_userId_status_idx" ON "ScheduledTask"("userId", "status");
CREATE INDEX "ScheduledTaskExecution_status_scheduledAt_idx" ON "ScheduledTaskExecution"("status", "scheduledAt");
CREATE INDEX "ScheduledTaskExecution_taskId_status_idx" ON "ScheduledTaskExecution"("taskId", "status");
CREATE INDEX "ScheduledTaskExecution_status_eventPublishedAt_idx" ON "ScheduledTaskExecution"("status", "eventPublishedAt");
CREATE INDEX "ScheduledTaskExecution_completedAt_eventPublishedAt_idx" ON "ScheduledTaskExecution"("completedAt", "eventPublishedAt");
CREATE INDEX "ScheduledTaskDelivery_status_createdAt_idx" ON "ScheduledTaskDelivery"("status", "createdAt");
ALTER TABLE "ScheduledTask" ADD CONSTRAINT "ScheduledTask_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ScheduledTaskVersion" ADD CONSTRAINT "ScheduledTaskVersion_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "ScheduledTask"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ScheduledTaskExecution" ADD CONSTRAINT "ScheduledTaskExecution_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "ScheduledTask"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ScheduledTaskExecution" ADD CONSTRAINT "ScheduledTaskExecution_taskVersionId_fkey" FOREIGN KEY ("taskVersionId") REFERENCES "ScheduledTaskVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ScheduledTaskEvidence" ADD CONSTRAINT "ScheduledTaskEvidence_executionId_fkey" FOREIGN KEY ("executionId") REFERENCES "ScheduledTaskExecution"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ScheduledTaskDelivery" ADD CONSTRAINT "ScheduledTaskDelivery_executionId_fkey" FOREIGN KEY ("executionId") REFERENCES "ScheduledTaskExecution"("id") ON DELETE CASCADE ON UPDATE CASCADE;
