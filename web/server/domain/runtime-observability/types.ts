export const RUNTIME_METRIC_KINDS = [
  "DATA",
  "PROCESSING",
  "AGENT",
  "DELIVERY",
  "RESOURCE",
] as const;

export type RuntimeMetricKind = (typeof RUNTIME_METRIC_KINDS)[number];

export type RuntimeDimension = {
  source: string | null;
  dataset: string | null;
  stage: string | null;
  resourcePool: string | null;
};

export type PermitObservation = {
  state: "ACQUIRED" | "UNAVAILABLE" | "RELEASED" | "EXPIRED" | "REVOKED";
  waitMs?: number;
  heldMs?: number;
};

export type CircuitObservation = {
  state: "CLOSED" | "OPEN" | "HALF_OPEN" | "CONFIG_BLOCKED";
};

export type AdaptiveConcurrencyObservation = {
  previous: number;
  current: number;
  hardLimit: number;
  reason:
    | "HEALTHY_STREAK_INCREASED"
    | "RATE_LIMITED_HALVED"
    | "TIMEOUT_DECREASED"
    | "LATENCY_HIGH_DECREASED"
    | "RESTART_CONSERVATIVE"
    | "NO_CHANGE";
  cooldownUntil?: Date | null;
};

export type RuntimeUsage = {
  requests?: number;
  inputTokens?: number;
  outputTokens?: number;
  costMicros?: number;
};

export type DeliveryObservation = {
  channel: string;
  status: "SENT" | "PENDING" | "RETRY" | "FAILED" | "SKIPPED";
  attempt?: number;
  latencyMs?: number;
};

export type RuntimeObservationInput = Partial<RuntimeDimension> & {
  idempotencyKey: string;
  metricKind?: RuntimeMetricKind;
  tradingDate?: string | null;
  sourceClockAt?: Date | null;
  sourceClockKind?: "PUBLISHED_AT" | "UPSTREAM_AVAILABLE_AT" | null;
  productClockAt?: Date | null;
  readyAt: Date;
  actualDataCutoff?: Date | null;
  targetDataCutoff?: Date | null;
  sourceTargetMs?: number | null;
  productTargetMs?: number | null;
  deliveryTargetMs?: number | null;
  backlogAgeMs?: number | null;
  backlogTargetMs?: number | null;
  success?: boolean;
  degraded?: boolean;
  permit?: PermitObservation | null;
  circuit?: CircuitObservation | null;
  adaptive?: AdaptiveConcurrencyObservation | null;
  usage?: RuntimeUsage | null;
  delivery?: DeliveryObservation | null;
  errorClass?: string | null;
  recordedAt?: Date;
};

export type RuntimeObservation = {
  id: string;
  idempotencyKey: string;
  metricKind: RuntimeMetricKind;
  dimension: RuntimeDimension;
  tradingDate: string | null;
  sourceClockAt: Date | null;
  sourceClockKind: "PUBLISHED_AT" | "UPSTREAM_AVAILABLE_AT" | null;
  productClockAt: Date | null;
  readyAt: Date;
  actualDataCutoff: Date | null;
  targetDataCutoff: Date | null;
  sourceLatencyMs: number | null;
  productLatencyMs: number | null;
  deliveryLatencyMs: number | null;
  dataCutoffMet: boolean | null;
  sourceTargetMs: number | null;
  productTargetMs: number | null;
  deliveryTargetMs: number | null;
  backlogAgeMs: number | null;
  backlogTargetMs: number | null;
  success: boolean;
  degraded: boolean;
  permit: PermitObservation | null;
  circuit: CircuitObservation | null;
  adaptive: AdaptiveConcurrencyObservation | null;
  usage: Required<RuntimeUsage>;
  delivery: DeliveryObservation | null;
  errorClass: string | null;
  recordedAt: Date;
};

export type RuntimeBreachKind =
  | "SOURCE_CLOCK"
  | "PRODUCT_CLOCK"
  | "DATA_CUTOFF"
  | "BACKLOG"
  | "DELIVERY"
  | "PERMIT"
  | "CIRCUIT";

export type RuntimeBreach = {
  id: string;
  idempotencyKey: string;
  observationId: string;
  kind: RuntimeBreachKind;
  observedMs: number | null;
  targetMs: number | null;
  actualDataCutoff: Date | null;
  targetDataCutoff: Date | null;
  tradingDate: string | null;
  reason: string;
  occurredAt: Date;
};

export type RuntimeAlertThreshold = 50 | 100;

export type RuntimeAlert = {
  id: string;
  idempotencyKey: string;
  observationId: string;
  kind: RuntimeBreachKind;
  thresholdPercent: RuntimeAlertThreshold;
  observedMs: number | null;
  targetMs: number | null;
  tradingDate: string | null;
  message: string;
  occurredAt: Date;
};

export type PercentileSummary = {
  p50: number | null;
  p95: number | null;
  max: number | null;
};

export type RuntimeMetric = {
  segment: RuntimeDimension;
  sampleCount: number;
  successRate: number;
  targetMetRate: number | null;
  degradedRate: number;
  dataCutoffRate: number | null;
  sourceLatencyMs: PercentileSummary;
  productLatencyMs: PercentileSummary;
  backlogAgeMs: PercentileSummary;
  breachCount: number;
  alertCount: number;
  rollingTradingDays: string[];
  permit: {
    acquired: number;
    unavailable: number;
    released: number;
    expired: number;
    revoked: number;
    averageWaitMs: number | null;
    p95WaitMs: number | null;
    averageHeldMs: number | null;
  };
  circuit: {
    closed: number;
    open: number;
    halfOpen: number;
    configBlocked: number;
  };
  usage: {
    requests: number;
    inputTokens: number;
    outputTokens: number;
    costMicros: number;
  };
  delivery: {
    attempts: number;
    sent: number;
    failed: number;
    p95LatencyMs: number | null;
  };
  adaptive: {
    samples: number;
    increased: number;
    decreased: number;
    rateLimitedHalves: number;
    restartConservative: number;
    cooldownSamples: number;
    maxCurrentConcurrency: number | null;
    hardLimit: number | null;
  };
};

export type RuntimeMetricFilter = Partial<RuntimeDimension> & {
  from?: Date;
  to?: Date;
  asOfTradingDate?: string;
  rollingTradingDays?: number;
};

export type RuntimeReleaseCheckStatus =
  | "PASS"
  | "FAIL"
  | "NOT_RUN"
  | "MANUAL_REQUIRED";

export type RuntimeReleaseCheck = {
  id: string;
  status: RuntimeReleaseCheckStatus;
  evidence?: string;
  reason?: string;
};
