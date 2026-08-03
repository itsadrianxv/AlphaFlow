ALTER TYPE "ScheduledTaskExecutionTrigger" ADD VALUE 'PREVIEW';

ALTER TABLE "ScheduledTaskExecution"
ADD COLUMN "executionPlanOverride" JSONB,
ADD COLUMN "previewSourceFingerprint" TEXT;
