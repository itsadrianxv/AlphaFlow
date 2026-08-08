-- 飞书投递深模块：共享熔断由 ResearchCircuitBreaker 统一管理。
DROP TABLE IF EXISTS "ResearchDeliveryCircuit";

ALTER TABLE "ResearchExternalCopy"
  DROP CONSTRAINT IF EXISTS "ResearchExternalCopy_status_check";
ALTER TABLE "ResearchExternalCopy"
  ADD COLUMN IF NOT EXISTS "failureClass" TEXT;
ALTER TABLE "ResearchExternalCopy"
  ADD CONSTRAINT "ResearchExternalCopy_status_check"
  CHECK ("status" IN ('PENDING', 'SENDING', 'RETRY_WAIT', 'SENT', 'FAILED'));

ALTER TABLE "ResearchTask"
  ADD COLUMN IF NOT EXISTS "externalCopyId" TEXT;
CREATE INDEX IF NOT EXISTS "ResearchTask_external_copy_idx"
  ON "ResearchTask" ("externalCopyId", "createdAt");
CREATE UNIQUE INDEX IF NOT EXISTS "ResearchTask_external_copy_attempt_unique"
  ON "ResearchTask" ("externalCopyId", "attempts");
ALTER TABLE "ResearchTask"
  ADD CONSTRAINT "ResearchTask_externalCopyId_fkey"
  FOREIGN KEY ("externalCopyId") REFERENCES "ResearchExternalCopy"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
