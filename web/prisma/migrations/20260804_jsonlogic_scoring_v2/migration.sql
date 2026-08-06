TRUNCATE TABLE "ScheduledTaskScoreResult", "ScheduledTaskExecution", "ScheduledTaskVersion", "ScheduledTask" CASCADE;

ALTER TABLE "ScheduledTaskScoreResult"
  DROP COLUMN "maxScore",
  ADD COLUMN "minimumPossibleScore" DOUBLE PRECISION NOT NULL,
  ADD COLUMN "maximumPossibleScore" DOUBLE PRECISION NOT NULL;
