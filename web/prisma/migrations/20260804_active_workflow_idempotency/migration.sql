CREATE UNIQUE INDEX "WorkflowRun_active_user_idempotency_key"
ON "WorkflowRun" ("userId", "idempotencyKey")
WHERE "idempotencyKey" IS NOT NULL
  AND "status" IN ('PENDING', 'RUNNING', 'PAUSED');
