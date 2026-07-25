export const EVIDENCE_CONTEXT_SCHEMA_VERSION = "1.0" as const;

export const EVIDENCE_STATUSES = [
  "available",
  "missing",
  "not_supported",
  "fallback",
  "stale",
  "estimated",
  "partial",
  "fetch_failed",
] as const;

export type EvidenceStatus = (typeof EVIDENCE_STATUSES)[number];
export type CollectionEvidenceStatus = Exclude<EvidenceStatus, "stale">;
export const EVIDENCE_RECORD_KINDS = [
  "observation",
  "manual_input",
  "derived",
  "model_derived",
  "correction",
] as const;
export type EvidenceRecordKind = (typeof EVIDENCE_RECORD_KINDS)[number];
export type EvidenceSubject = {
  subjectType: string;
  subjectId: string;
  label?: string;
};

export type EvidenceSource = {
  sourceType?: string;
  sourceId?: string;
  sourceName?: string;
  url?: string;
};

export type EvidenceCitation = {
  evidenceItemId: string;
  relation?: "support" | "risk" | "context" | "contradiction";
  label?: string;
};

export type EvidenceContextItem = EvidenceSource & {
  id: string;
  itemKey: string;
  status: CollectionEvidenceStatus;
  sourceType: string;
  effectiveStatus?: EvidenceStatus;
  extractedFact?: string;
  snippet?: string;
  valueJson?: unknown;
  rawValueJson?: unknown;
  publishedAt?: string;
  observedAt?: string;
  fetchedAt?: string;
  fallbackFrom?: string;
  missingReason?: string;
  warnings: string[];
  limitations: string[];
  metadata: Record<string, unknown>;
  recordKind: EvidenceRecordKind;
  lineageId: string;
  derivedFromItemIds: string[];
  algorithmVersion?: string;
  parameters?: Record<string, unknown>;
  correctionOfItemId?: string;
  supersedesItemId?: string;
  contentHash: string;
};

export type ResearchContextPolicy = "evidence_required" | "transformation";
export type ResearchContextSnapshotItem = {
  evidenceItemId: string;
  ordinal: number;
  projection: Record<string, unknown>;
  projectionHash: string;
  truncationReason?: string;
};

export type ResearchContextSnapshot = {
  id: string;
  userId: string;
  workflowRunId?: string;
  requestGroupId: string;
  requestSequence: number;
  attempt: number;
  purpose: string;
  policy: ResearchContextPolicy;
  model?: string;
  requestOptions?: Record<string, unknown>;
  messages: Array<{ role: string; content: string }>;
  quality: EvidenceQualitySummary;
  projectionVersion: string;
  contentHash: string;
  status: "prepared" | "sent" | "succeeded" | "failed";
  errorMessage?: string;
  createdAt: string;
  sentAt?: string;
  completedAt?: string;
  items: ResearchContextSnapshotItem[];
};

export type ResearchClaim = {
  id: string;
  snapshotId: string;
  artifactKey: string;
  ordinal: number;
  text: string;
  status: "supported" | "insufficient_evidence";
  qualityFlags: string[];
  citations: EvidenceCitation[];
  createdAt: string;
};

export type EvidenceContextBlock = EvidenceSource & {
  id: string;
  blockKey: string;
  status: CollectionEvidenceStatus;
  effectiveStatus?: EvidenceStatus;
  items: EvidenceContextItem[];
  observedAt?: string;
  fetchedAt?: string;
  warnings: string[];
  limitations: string[];
  metadata: Record<string, unknown>;
};

export type EvidenceContext = {
  id: string;
  userId: string;
  workflowRunId?: string;
  subject: EvidenceSubject;
  phase?: string;
  blocks: EvidenceContextBlock[];
  createdAt: string;
  metadata: Record<string, unknown>;
};

export type FreshnessWindow = {
  blockKey: string;
  maxAgeDays: number;
};

export type EvidenceQualityPolicy = {
  policyVersion: string;
  blockWeights: Record<string, number>;
  freshnessWindows: FreshnessWindow[];
};

export type EvidenceContextView = {
  subject: EvidenceSubject;
  phase?: string;
  blocks: EvidenceContextBlock[];
  quality: EvidenceQualitySummary;
  contextIds: string[];
  policyVersion: string;
};

export type EvidenceQualitySummary = {
  overallScore: number;
  level: "good" | "usable" | "limited" | "poor";
  blockScores: Record<string, number>;
  limitations: string[];
  warnings: string[];
  confidenceCap: "high" | "medium" | "low";
};

export const STATUS_SCORES: Record<EvidenceStatus, number> = {
  available: 100,
  partial: 75,
  estimated: 75,
  not_supported: 70,
  fallback: 65,
  stale: 50,
  missing: 35,
  fetch_failed: 25,
};

export const DEFAULT_FRESHNESS_WINDOWS: FreshnessWindow[] = [
  { blockKey: "quote", maxAgeDays: 1 },
  { blockKey: "daily_bars", maxAgeDays: 1 },
  { blockKey: "technical", maxAgeDays: 1 },
  { blockKey: "market_context", maxAgeDays: 1 },
  { blockKey: "timing", maxAgeDays: 1 },
  { blockKey: "screening", maxAgeDays: 1 },
  { blockKey: "news", maxAgeDays: 30 },
  { blockKey: "fundamentals", maxAgeDays: 180 },
  { blockKey: "financial", maxAgeDays: 180 },
];

const CORE_BLOCKS = new Set([
  "quote",
  "daily_bars",
  "technical",
  "market_context",
  "screening",
  "timing",
]);

const DEGRADED_CORE_STATUSES = new Set<EvidenceStatus>([
  "stale",
  "fallback",
  "missing",
  "fetch_failed",
  "partial",
  "estimated",
]);

function asDate(value?: string) {
  if (!value) return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

function freshnessWindowFor(blockKey: string, windows: FreshnessWindow[]) {
  return (
    windows.find((item) => item.blockKey === blockKey)?.maxAgeDays ??
    DEFAULT_FRESHNESS_WINDOWS.find((item) => item.blockKey === blockKey)
      ?.maxAgeDays ??
    30
  );
}

function effectiveStatus(
  blockKey: string,
  status: CollectionEvidenceStatus,
  observedAt: string | undefined,
  fetchedAt: string | undefined,
  publishedAt: string | undefined,
  now: Date,
  windows: FreshnessWindow[],
): EvidenceStatus {
  if (status !== "available" && status !== "not_supported") {
    return status;
  }

  const reference =
    asDate(publishedAt) ?? asDate(observedAt) ?? asDate(fetchedAt);
  if (!reference) return status;

  const ageDays = (now.getTime() - reference.getTime()) / 86_400_000;
  return ageDays > freshnessWindowFor(blockKey, windows) ? "stale" : status;
}

function scoreFor(status: EvidenceStatus) {
  return STATUS_SCORES[status];
}

export function buildEvidenceContextView(params: {
  contexts: EvidenceContext[];
  policy?: Partial<EvidenceQualityPolicy>;
  now?: Date;
}): EvidenceContextView {
  const contexts = params.contexts;
  const windows = params.policy?.freshnessWindows ?? DEFAULT_FRESHNESS_WINDOWS;
  const blockWeights = params.policy?.blockWeights ?? {};
  const now = params.now ?? new Date();
  const byKey = new Map<string, EvidenceContextBlock[]>();

  for (const context of contexts) {
    for (const block of context.blocks) {
      const list = byKey.get(block.blockKey) ?? [];
      list.push(block);
      byKey.set(block.blockKey, list);
    }
  }

  const blocks: EvidenceContextBlock[] = [...byKey.entries()].map(
    ([blockKey, candidates]) => {
      const items = candidates
        .flatMap((block) => block.items)
        .map((item) => ({
          ...item,
          effectiveStatus: effectiveStatus(
            blockKey,
            item.status,
            item.observedAt ?? candidates[0]?.observedAt,
            item.fetchedAt ?? candidates[0]?.fetchedAt,
            item.publishedAt,
            now,
            windows,
          ),
        }));
      const statuses = candidates.map((block) =>
        effectiveStatus(
          blockKey,
          block.status,
          block.observedAt,
          block.fetchedAt,
          undefined,
          now,
          windows,
        ),
      );
      const itemStatuses = items.map(
        (item) => item.effectiveStatus ?? item.status,
      );
      const effectiveStatuses =
        itemStatuses.length > 0 ? itemStatuses : statuses;
      const status = effectiveStatuses.includes("available")
        ? "available"
        : (effectiveStatuses[0] ?? "missing");
      const conflict =
        new Set(
          [...statuses, ...itemStatuses].filter(
            (item) => item !== status && item !== "not_supported",
          ),
        ).size > 0;

      return {
        id: candidates[0]?.id ?? `view-${blockKey}`,
        blockKey,
        status: candidates[0]?.status ?? "missing",
        effectiveStatus: status,
        sourceType: candidates[0]?.sourceType,
        sourceId: candidates[0]?.sourceId,
        sourceName: candidates[0]?.sourceName,
        url: candidates[0]?.url,
        observedAt: candidates[0]?.observedAt,
        fetchedAt: candidates[0]?.fetchedAt,
        metadata: candidates[0]?.metadata ?? {},
        items,
        warnings: [
          ...new Set(candidates.flatMap((block) => block.warnings)),
          ...(conflict ? ["conflicting_context_statuses"] : []),
        ],
        limitations: [
          ...new Set(candidates.flatMap((block) => block.limitations)),
        ],
      };
    },
  );

  const weights =
    Object.keys(blockWeights).length > 0
      ? blockWeights
      : Object.fromEntries(blocks.map((block) => [block.blockKey, 1]));
  const totalWeight = Object.values(weights).reduce(
    (sum, value) => sum + value,
    0,
  );
  const blockScores = Object.fromEntries(
    blocks.map((block) => [
      block.blockKey,
      scoreFor(block.effectiveStatus ?? block.status),
    ]),
  );
  const overallScore = totalWeight
    ? Math.round(
        blocks.reduce(
          (sum, block) =>
            sum +
            (weights[block.blockKey] ?? 0) *
              scoreFor(block.effectiveStatus ?? block.status),
          0,
        ) / totalWeight,
      )
    : 0;
  const limitations = blocks
    .filter((block) => block.effectiveStatus !== "available")
    .map((block) => `${block.blockKey}:${block.effectiveStatus}`);
  const warnings = [...new Set(blocks.flatMap((block) => block.warnings))];
  const hasDegradedCore = blocks.some(
    (block) =>
      CORE_BLOCKS.has(block.blockKey) &&
      DEGRADED_CORE_STATUSES.has(block.effectiveStatus ?? block.status),
  );

  return {
    subject: contexts[0]?.subject ?? {
      subjectType: "unknown",
      subjectId: "unknown",
    },
    phase: contexts.find((context) => context.phase)?.phase,
    blocks,
    quality: {
      overallScore,
      level:
        overallScore >= 85
          ? "good"
          : overallScore >= 70
            ? "usable"
            : overallScore >= 50
              ? "limited"
              : "poor",
      blockScores,
      limitations,
      warnings,
      confidenceCap:
        overallScore < 50 ? "low" : hasDegradedCore ? "medium" : "high",
    },
    contextIds: contexts.map((context) => context.id),
    policyVersion: params.policy?.policyVersion ?? "evidence-quality-v1",
  };
}

const SENSITIVE_KEYS = new Set([
  "api_key",
  "apikey",
  "access_token",
  "refresh_token",
  "authorization",
  "cookie",
  "password",
  "secret",
  "token",
  "webhook",
  "sendkey",
  "license_key",
]);

export function sanitizeEvidenceRawValue(
  value: unknown,
  maxBytes = 128_000,
): unknown {
  const seen = new WeakSet<object>();
  const visit = (input: unknown): unknown => {
    if (
      typeof input === "string" ||
      typeof input === "number" ||
      typeof input === "boolean" ||
      input === null
    ) {
      return input;
    }
    if (input instanceof Date) return input.toISOString();
    if (typeof input !== "object") return undefined;
    if (seen.has(input)) return "[Circular]";
    seen.add(input);
    if (Array.isArray(input)) return input.map(visit).slice(0, 2000);
    return Object.fromEntries(
      Object.entries(input).map(([key, child]) => [
        key,
        SENSITIVE_KEYS.has(key.toLowerCase()) ? "[REDACTED]" : visit(child),
      ]),
    );
  };
  const sanitized = visit(value);
  const serialized = JSON.stringify(sanitized);
  if (!serialized || Buffer.byteLength(serialized, "utf8") <= maxBytes)
    return sanitized;
  return {
    truncated: true,
    preview: serialized.slice(0, Math.max(0, maxBytes - 80)),
  };
}
