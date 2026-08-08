export const SCHEDULING_TIERS = [
  "INTERACTIVE",
  "TIME_CRITICAL",
  "BACKGROUND",
] as const;

export type SchedulingTier = (typeof SCHEDULING_TIERS)[number];

export const RESEARCH_TASK_STATUSES = [
  "PENDING",
  "RUNNING",
  "RETRY_WAIT",
  "SUCCEEDED",
  "FAILED",
  "CANCELLED",
  "REJECTED",
  "MERGED",
] as const;

export type ResearchTaskStatus = (typeof RESEARCH_TASK_STATUSES)[number];

export const RESOURCE_PERMIT_STATUSES = [
  "ACTIVE",
  "RELEASED",
  "EXPIRED",
  "REVOKED",
] as const;

export type ResourcePermitStatus = (typeof RESOURCE_PERMIT_STATUSES)[number];

export const CIRCUIT_STATES = [
  "CLOSED",
  "OPEN",
  "HALF_OPEN",
  "CONFIG_BLOCKED",
] as const;

export type CircuitState = (typeof CIRCUIT_STATES)[number];

export interface ResourcePool {
  id: string;
  poolKey: string;
  resourceKind: string;
  hardConcurrency: number;
  currentConcurrency: number;
  controlVersion: bigint;
  lastHealthyAt: Date | null;
  healthySince: Date | null;
  successStreak: number;
  latencyBaselineMs: number | null;
  cooldownUntil: Date | null;
}

export interface ResearchTask {
  id: string;
  taskType: string;
  idempotencyKey: string;
  inputHash: string;
  inputContractVersion: string;
  input: unknown;
  schedulingTier: SchedulingTier;
  resourcePoolId: string;
  fairnessKey: string;
  userId: string | null;
  parentTaskId: string | null;
  externalCopyId: string | null;
  targetCompletionAt: Date | null;
  status: ResearchTaskStatus;
  attempts: number;
  maxAttempts: number;
  retryDeadline: Date;
  nextAttemptAt: Date | null;
  workerId: string | null;
  fencingToken: bigint;
  leaseExpiresAt: Date | null;
  heartbeatAt: Date | null;
  resultContractVersion: string | null;
  resultHash: string | null;
  result: unknown | null;
  errorClass: string | null;
  retryability: "RETRYABLE" | "NON_RETRYABLE" | null;
  terminalReason: string | null;
  oldestBacklogAgeMs: bigint | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface ResourcePermit {
  id: string;
  resourcePoolId: string;
  taskId: string;
  permitKey: string;
  holderId: string;
  fencingToken: bigint;
  status: ResourcePermitStatus;
  acquiredAt: Date;
  leaseExpiresAt: Date;
  releasedAt: Date | null;
  releaseReason: string | null;
}

export interface CircuitBreaker {
  resourcePoolId: string;
  state: CircuitState;
  version: bigint;
  consecutiveFailures: number;
  windowAttempts: number;
  windowFailures: number;
  openCount: number;
  retryAfter: Date | null;
  halfOpenProbeTaskId: string | null;
  blockedReason: string | null;
  updatedAt: Date;
}

export interface EnqueueTaskInput {
  taskType: string;
  idempotencyKey: string;
  inputHash: string;
  inputContractVersion: string;
  input: unknown;
  schedulingTier: SchedulingTier;
  resourcePoolId: string;
  fairnessKey: string;
  userId?: string | null;
  parentTaskId?: string | null;
  externalCopyId?: string | null;
  targetCompletionAt?: Date | null;
  maxAttempts?: number;
  retryDeadline?: Date;
}

export type AdmissionDecision =
  | "ACCEPTED"
  | "DEDUPLICATED"
  | "BUSY"
  | "MERGED"
  | "PAUSED"
  | "REJECTED";

export interface AdmissionResult {
  decision: AdmissionDecision;
  reason: string;
  task: ResearchTask | null;
  oldestBacklogAgeMs: bigint | null;
}

export interface ClaimedTask {
  task: ResearchTask;
  permit: ResourcePermit;
}

export interface RetrySettlement {
  disposition: "RETRY";
  errorClass: string;
  retryAfterMs?: number;
  retryable?: boolean;
  resultContractVersion?: never;
  result?: never;
}

export interface CompletedSettlement {
  disposition: "COMPLETED";
  result: unknown;
  resultContractVersion: string;
}

export interface TerminalSettlement {
  disposition: "FAILED" | "CANCELLED";
  errorClass: string;
  terminalReason: string;
  retryable?: never;
  retryAfterMs?: never;
  resultContractVersion?: never;
  result?: never;
}

export type TaskSettlement =
  | CompletedSettlement
  | RetrySettlement
  | TerminalSettlement;

export interface BacklogSnapshot {
  resourcePoolId: string;
  limits: Record<SchedulingTier, number>;
  counts: Record<SchedulingTier, number>;
  oldestAgeMs: bigint | null;
  total: number;
}

export type ResourceOutcome =
  | { kind: "SUCCESS"; latencyMs?: number; at?: Date }
  | { kind: "FAILURE"; latencyMs?: number; at?: Date }
  | { kind: "RATE_LIMITED"; retryAfterMs?: number; at?: Date }
  | { kind: "TIMEOUT"; latencyMs?: number; at?: Date }
  | { kind: "LATENCY_HIGH"; latencyMs?: number; at?: Date };

export interface AdaptiveConcurrencyResult {
  previous: number;
  current: number;
  changed: boolean;
  reason: string;
  cooldownUntil: Date | null;
}

export class SchedulingInvariantError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SchedulingInvariantError";
  }
}

export class LeaseLostError extends SchedulingInvariantError {
  constructor(message = "任务租约或 fencing token 已失效") {
    super(message);
    this.name = "LeaseLostError";
  }
}

export class ResourcePermitUnavailableError extends SchedulingInvariantError {
  constructor(message = "资源许可暂不可用") {
    super(message);
    this.name = "ResourcePermitUnavailableError";
  }
}
