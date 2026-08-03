-- F02：让调度运行时事实以 PostgreSQL 为权威来源。
-- 任务身份在准入后保持不可变；运行时状态由带 fencing 谓词的
-- claim/renew/settle adapter 修改。

ALTER TABLE "ResearchResourcePool"
  ADD COLUMN IF NOT EXISTS "healthySince" TIMESTAMPTZ(3),
  ADD COLUMN IF NOT EXISTS "successStreak" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "latencyBaselineMs" INTEGER;

ALTER TABLE "ResearchResourcePool"
  DROP CONSTRAINT IF EXISTS "ResearchResourcePool_adaptive_state_check";
ALTER TABLE "ResearchResourcePool"
  ADD CONSTRAINT "ResearchResourcePool_adaptive_state_check"
  CHECK ("successStreak" >= 0 AND ("latencyBaselineMs" IS NULL OR "latencyBaselineMs" >= 0));

CREATE INDEX IF NOT EXISTS "ResearchTask_pool_status_created_idx"
  ON "ResearchTask" ("resourcePoolId", "status", "createdAt");

CREATE INDEX IF NOT EXISTS "ResearchTask_pool_status_target_idx"
  ON "ResearchTask" ("resourcePoolId", "status", "targetCompletionAt", "fairnessKey", "createdAt");

CREATE INDEX IF NOT EXISTS "ResearchResourcePermit_active_task_idx"
  ON "ResearchResourcePermit" ("taskId", "status", "leaseExpiresAt");

INSERT INTO "ResearchCircuitBreaker" ("id", "resourcePoolId", "updatedAt")
SELECT 'circuit:' || "id", "id", CURRENT_TIMESTAMP
  FROM "ResearchResourcePool"
ON CONFLICT ("resourcePoolId") DO NOTHING;

CREATE OR REPLACE FUNCTION "ensure_research_pool_circuit"() RETURNS TRIGGER AS $$
BEGIN
    INSERT INTO "ResearchCircuitBreaker" ("id", "resourcePoolId", "updatedAt")
    VALUES ('circuit:' || NEW."id", NEW."id", CURRENT_TIMESTAMP)
    ON CONFLICT ("resourcePoolId") DO NOTHING;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS "ResearchResourcePool_circuit_seed" ON "ResearchResourcePool";
CREATE TRIGGER "ResearchResourcePool_circuit_seed"
AFTER INSERT ON "ResearchResourcePool"
FOR EACH ROW EXECUTE FUNCTION "ensure_research_pool_circuit"();

CREATE OR REPLACE FUNCTION "release_research_task_permits"() RETURNS TRIGGER AS $$
BEGIN
    IF NEW."status" <> 'RUNNING' AND OLD."status" = 'RUNNING' THEN
        UPDATE "ResearchResourcePermit"
           SET "status" = 'RELEASED',
               "releasedAt" = COALESCE(NEW."updatedAt", CURRENT_TIMESTAMP),
               "releaseReason" = 'task_' || LOWER(NEW."status")
         WHERE "taskId" = NEW."id" AND "status" = 'ACTIVE';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS "ResearchTask_release_permits" ON "ResearchTask";
CREATE TRIGGER "ResearchTask_release_permits"
AFTER UPDATE OF "status" ON "ResearchTask"
FOR EACH ROW EXECUTE FUNCTION "release_research_task_permits"();
