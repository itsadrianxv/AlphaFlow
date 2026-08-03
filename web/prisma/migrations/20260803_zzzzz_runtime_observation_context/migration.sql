ALTER TABLE "ResearchRuntimeObservation"
ADD COLUMN "observationContextJson" JSONB;

CREATE INDEX "ResearchRuntimeObservation_task_context_idx"
ON "ResearchRuntimeObservation" (("observationContextJson" ->> 'taskId'), "recordedAt");
