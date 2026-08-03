CREATE TABLE "ResearchExternalCopy" (
  "id" TEXT NOT NULL,
  "entryId" TEXT NOT NULL,
  "idempotencyKey" TEXT NOT NULL,
  "channel" TEXT NOT NULL DEFAULT 'FEISHU',
  "payloadJson" JSONB NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'PENDING',
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "firstAttemptAt" TIMESTAMPTZ(3),
  "retryDeadline" TIMESTAMPTZ(3) NOT NULL,
  "nextAttemptAt" TIMESTAMPTZ(3),
  "sentAt" TIMESTAMPTZ(3),
  "lastErrorCode" TEXT,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ResearchExternalCopy_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ResearchExternalCopy_attempts_check" CHECK ("attempts" >= 0 AND "attempts" <= 5),
  CONSTRAINT "ResearchExternalCopy_status_check" CHECK ("status" IN ('PENDING', 'RETRY_WAIT', 'DEFERRED_CIRCUIT', 'SENT', 'FAILED', 'CONFIG_BLOCKED')),
  CONSTRAINT "ResearchExternalCopy_entryId_fkey" FOREIGN KEY ("entryId") REFERENCES "ResearchInboxEntry"("id") ON DELETE RESTRICT ON UPDATE RESTRICT
);

CREATE UNIQUE INDEX "ResearchExternalCopy_entryId_key" ON "ResearchExternalCopy"("entryId");
CREATE UNIQUE INDEX "ResearchExternalCopy_idempotencyKey_key" ON "ResearchExternalCopy"("idempotencyKey");
CREATE INDEX "ResearchExternalCopy_delivery_idx" ON "ResearchExternalCopy"("channel", "status", "nextAttemptAt");

CREATE TABLE "ResearchDeliveryCircuit" (
  "id" TEXT NOT NULL,
  "channel" TEXT NOT NULL,
  "state" TEXT NOT NULL DEFAULT 'CLOSED',
  "consecutiveFailures" INTEGER NOT NULL DEFAULT 0,
  "openCount" INTEGER NOT NULL DEFAULT 0,
  "retryAfter" TIMESTAMPTZ(3),
  "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ResearchDeliveryCircuit_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ResearchDeliveryCircuit_state_check" CHECK ("state" IN ('CLOSED', 'OPEN', 'HALF_OPEN')),
  CONSTRAINT "ResearchDeliveryCircuit_failures_check" CHECK ("consecutiveFailures" >= 0 AND "openCount" >= 0)
);

CREATE UNIQUE INDEX "ResearchDeliveryCircuit_channel_key" ON "ResearchDeliveryCircuit"("channel");

INSERT INTO "ResearchDeliveryCircuit" (
  "id", "channel", "state", "consecutiveFailures", "openCount", "updatedAt"
) VALUES ('research-delivery-circuit-feishu', 'FEISHU', 'CLOSED', 0, 0, CURRENT_TIMESTAMP);
