CREATE TABLE "ResearchRuntimeObservation" (
    "id" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "metricKind" TEXT NOT NULL,
    "sourceKey" TEXT,
    "datasetKey" TEXT,
    "stage" TEXT,
    "resourcePoolKey" TEXT,
    "tradingDate" TEXT,
    "sourceClockAt" TIMESTAMPTZ(3),
    "sourceClockKind" TEXT,
    "productClockAt" TIMESTAMPTZ(3),
    "readyAt" TIMESTAMPTZ(3) NOT NULL,
    "actualDataCutoff" TIMESTAMPTZ(3),
    "targetDataCutoff" TIMESTAMPTZ(3),
    "sourceLatencyMs" INTEGER,
    "productLatencyMs" INTEGER,
    "deliveryLatencyMs" INTEGER,
    "dataCutoffMet" BOOLEAN,
    "sourceTargetMs" INTEGER,
    "productTargetMs" INTEGER,
    "deliveryTargetMs" INTEGER,
    "backlogAgeMs" INTEGER,
    "backlogTargetMs" INTEGER,
    "success" BOOLEAN NOT NULL DEFAULT true,
    "degraded" BOOLEAN NOT NULL DEFAULT false,
    "permitState" TEXT,
    "permitWaitMs" INTEGER,
    "permitHeldMs" INTEGER,
    "circuitState" TEXT,
    "previousConcurrency" INTEGER,
    "currentConcurrency" INTEGER,
    "hardConcurrency" INTEGER,
    "adaptiveReason" TEXT,
    "cooldownUntil" TIMESTAMPTZ(3),
    "usageRequests" INTEGER NOT NULL DEFAULT 0,
    "usageInputTokens" INTEGER NOT NULL DEFAULT 0,
    "usageOutputTokens" INTEGER NOT NULL DEFAULT 0,
    "usageCostMicros" INTEGER NOT NULL DEFAULT 0,
    "deliveryChannel" TEXT,
    "deliveryStatus" TEXT,
    "deliveryAttempt" INTEGER,
    "errorClass" TEXT,
    "recordedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ResearchRuntimeObservation_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "ResearchRuntimeObservation_metric_kind_check"
      CHECK ("metricKind" IN ('DATA', 'PROCESSING', 'AGENT', 'DELIVERY', 'RESOURCE')),
    CONSTRAINT "ResearchRuntimeObservation_source_clock_check"
      CHECK (
        ("sourceClockAt" IS NULL AND "sourceClockKind" IS NULL)
        OR (
          "sourceClockAt" IS NOT NULL
          AND "sourceClockKind" IS NOT NULL
          AND "sourceClockKind" IN ('PUBLISHED_AT', 'UPSTREAM_AVAILABLE_AT')
        )
      ),
    CONSTRAINT "ResearchRuntimeObservation_non_negative_check"
      CHECK (
        ("sourceLatencyMs" IS NULL OR "sourceLatencyMs" >= 0)
        AND ("productLatencyMs" IS NULL OR "productLatencyMs" >= 0)
        AND ("deliveryLatencyMs" IS NULL OR "deliveryLatencyMs" >= 0)
        AND ("sourceTargetMs" IS NULL OR "sourceTargetMs" >= 0)
        AND ("productTargetMs" IS NULL OR "productTargetMs" >= 0)
        AND ("deliveryTargetMs" IS NULL OR "deliveryTargetMs" >= 0)
        AND ("backlogAgeMs" IS NULL OR "backlogAgeMs" >= 0)
        AND ("backlogTargetMs" IS NULL OR "backlogTargetMs" >= 0)
        AND ("permitWaitMs" IS NULL OR "permitWaitMs" >= 0)
        AND ("permitHeldMs" IS NULL OR "permitHeldMs" >= 0)
        AND "usageRequests" >= 0
        AND "usageInputTokens" >= 0
        AND "usageOutputTokens" >= 0
        AND "usageCostMicros" >= 0
        AND ("deliveryAttempt" IS NULL OR "deliveryAttempt" >= 0)
      ),
    CONSTRAINT "ResearchRuntimeObservation_adaptive_check"
      CHECK (
        ("previousConcurrency" IS NULL AND "currentConcurrency" IS NULL AND "hardConcurrency" IS NULL AND "adaptiveReason" IS NULL)
        OR (
          "previousConcurrency" IS NOT NULL
          AND "currentConcurrency" IS NOT NULL
          AND "hardConcurrency" IS NOT NULL
          AND "adaptiveReason" IS NOT NULL
          AND "previousConcurrency" BETWEEN 1 AND "hardConcurrency"
          AND "currentConcurrency" BETWEEN 1 AND "hardConcurrency"
          AND "hardConcurrency" > 0
          AND "adaptiveReason" IN (
            'HEALTHY_STREAK_INCREASED', 'RATE_LIMITED_HALVED', 'TIMEOUT_DECREASED',
            'LATENCY_HIGH_DECREASED', 'RESTART_CONSERVATIVE', 'NO_CHANGE'
          )
        )
      )
);

CREATE UNIQUE INDEX "ResearchRuntimeObservation_idempotencyKey_key"
  ON "ResearchRuntimeObservation" ("idempotencyKey");
CREATE INDEX "ResearchRuntimeObservation_segment_idx"
  ON "ResearchRuntimeObservation" ("sourceKey", "datasetKey", "stage", "recordedAt");
CREATE INDEX "ResearchRuntimeObservation_resource_idx"
  ON "ResearchRuntimeObservation" ("resourcePoolKey", "recordedAt");
CREATE INDEX "ResearchRuntimeObservation_trading_date_idx"
  ON "ResearchRuntimeObservation" ("tradingDate", "recordedAt");

CREATE TABLE "ResearchRuntimeBreach" (
    "id" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "observationId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "observedMs" INTEGER,
    "targetMs" INTEGER,
    "actualDataCutoff" TIMESTAMPTZ(3),
    "targetDataCutoff" TIMESTAMPTZ(3),
    "tradingDate" TEXT,
    "reason" TEXT NOT NULL,
    "occurredAt" TIMESTAMPTZ(3) NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ResearchRuntimeBreach_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "ResearchRuntimeBreach_kind_check"
      CHECK ("kind" IN ('SOURCE_CLOCK', 'PRODUCT_CLOCK', 'DATA_CUTOFF', 'BACKLOG', 'DELIVERY', 'PERMIT', 'CIRCUIT'))
);

CREATE UNIQUE INDEX "ResearchRuntimeBreach_idempotencyKey_key"
  ON "ResearchRuntimeBreach" ("idempotencyKey");
CREATE INDEX "ResearchRuntimeBreach_observation_idx"
  ON "ResearchRuntimeBreach" ("observationId");
CREATE INDEX "ResearchRuntimeBreach_kind_idx"
  ON "ResearchRuntimeBreach" ("kind", "tradingDate", "occurredAt");

CREATE TABLE "ResearchRuntimeAlert" (
    "id" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "observationId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "thresholdPercent" INTEGER NOT NULL,
    "observedMs" INTEGER,
    "targetMs" INTEGER,
    "tradingDate" TEXT,
    "message" TEXT NOT NULL,
    "occurredAt" TIMESTAMPTZ(3) NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ResearchRuntimeAlert_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "ResearchRuntimeAlert_kind_check"
      CHECK ("kind" IN ('SOURCE_CLOCK', 'PRODUCT_CLOCK', 'DATA_CUTOFF', 'BACKLOG', 'DELIVERY', 'PERMIT', 'CIRCUIT')),
    CONSTRAINT "ResearchRuntimeAlert_threshold_check"
      CHECK ("thresholdPercent" IN (50, 100))
);

CREATE UNIQUE INDEX "ResearchRuntimeAlert_idempotencyKey_key"
  ON "ResearchRuntimeAlert" ("idempotencyKey");
CREATE INDEX "ResearchRuntimeAlert_observation_idx"
  ON "ResearchRuntimeAlert" ("observationId");
CREATE INDEX "ResearchRuntimeAlert_threshold_idx"
  ON "ResearchRuntimeAlert" ("kind", "thresholdPercent", "tradingDate");

CREATE TABLE "ResearchReleaseEvaluation" (
    "id" TEXT NOT NULL,
    "evaluationKey" TEXT NOT NULL,
    "allowed" BOOLEAN NOT NULL,
    "checksJson" JSONB NOT NULL,
    "hardGateFailuresJson" JSONB NOT NULL,
    "manualChecksJson" JSONB NOT NULL,
    "runtimeBreachesJson" JSONB NOT NULL,
    "degradationJson" JSONB NOT NULL,
    "checkedAt" TIMESTAMPTZ(3) NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ResearchReleaseEvaluation_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ResearchReleaseEvaluation_evaluationKey_key"
  ON "ResearchReleaseEvaluation" ("evaluationKey");
CREATE INDEX "ResearchReleaseEvaluation_allowed_idx"
  ON "ResearchReleaseEvaluation" ("allowed", "checkedAt");
