import { createHash } from "node:crypto";
import {
  type ResearchGlobalAssessmentOutput,
  type ResearchRelevanceAssessmentOutput,
  researchGlobalAssessmentOutputSchema,
  researchRelevanceAssessmentOutputSchema,
} from "~/contracts/research-assessment";
import type {
  ResearchPreferenceItem,
  ResearchPreferenceMatch,
  ResearchPreferenceSnapshot,
} from "~/contracts/research-preference";
import {
  canonicalJson,
  hasDirectFocusMatch,
  resolvePreferenceMatches,
} from "~/server/domain/research-preference/research-preference";

export const RESEARCH_ASSESSMENT_CONTRACT_VERSION =
  "research-assessment.v1" as const;
export const RESEARCH_ASSESSMENT_PROMPT_VERSION =
  "research-assessment.prompt.v1" as const;
export const RESEARCH_ASSESSMENT_SCHEMA_VERSION =
  "research-assessment.schema.v1" as const;
export const RESEARCH_ASSESSMENT_VALIDATION_VERSION =
  "research-assessment.validation.v1" as const;
export const RESEARCH_ASSESSMENT_MODEL = "deepseek-v4-flash" as const;

export type ResearchAssessmentKind = "GLOBAL" | "RELEVANCE";

export type FrozenResearchEvidence = {
  id: string;
  summary: string;
};

export type FrozenResearchClaim = {
  id: string;
  text: string;
  evidenceRefs: string[];
};

export type FrozenResearchImpact = {
  id: string;
  subjectType: ResearchPreferenceItem["targetType"];
  subjectKey: string;
  relation: "DIRECT" | "WEAK";
  materiality: "LOW" | "MEDIUM" | "HIGH";
  path?: string[];
};

export type FrozenCognitiveBaselineItem = {
  id: string;
  summary: string;
};

export type FrozenResearchEventRevisionInput = {
  revisionId: string;
  eventKey: string;
  title: string;
  summary: string;
  claims: FrozenResearchClaim[];
  evidence: FrozenResearchEvidence[];
  impacts: FrozenResearchImpact[];
  cognitiveBaseline: FrozenCognitiveBaselineItem[];
};

export type ResearchAssessmentUsage = {
  credentialId?: string;
  inputTokens?: number;
  cachedInputTokens?: number;
  outputTokens?: number;
  attempts: number;
};

export type ResearchAssessmentLlmRequest = {
  kind: ResearchAssessmentKind;
  model: typeof RESEARCH_ASSESSMENT_MODEL;
  temperature: 0;
  maxInputTokens: number;
  maxOutputTokens: number;
  messages: Array<{ role: "system" | "user"; content: string }>;
  repairOf?: { rawOutput: string; validationErrors: string[] };
};

export type ResearchAssessmentLlmResponse = {
  rawOutput: string;
  usage?: Omit<ResearchAssessmentUsage, "attempts">;
};

export interface ResearchAssessmentLlmAdapter {
  complete(
    request: ResearchAssessmentLlmRequest,
  ): Promise<ResearchAssessmentLlmResponse>;
}

export type SavedGlobalAssessment = {
  id: string;
  eventRevisionId: string;
  inputHash: string;
  output: ResearchGlobalAssessmentOutput;
  usage: ResearchAssessmentUsage;
  createdAt: string;
};

export type SavedRelevanceAssessment = {
  id: string;
  eventRevisionId: string;
  userId: string;
  preferenceSnapshotId: string;
  inputHash: string;
  output: ResearchRelevanceAssessmentOutput;
  matchedPreferences: ResearchPreferenceMatch[];
  directFocusMatch: boolean;
  usage: ResearchAssessmentUsage;
  createdAt: string;
};

export type AssessmentResult<T> = {
  status: "CREATED" | "CACHED" | "STALE_RETAINED";
  assessment: T;
  validationErrors?: string[];
};

export class InMemoryResearchAssessmentStore {
  private readonly globalByHash = new Map<string, SavedGlobalAssessment>();
  private readonly globalByRevision = new Map<string, SavedGlobalAssessment>();
  private readonly relevanceByHash = new Map<
    string,
    SavedRelevanceAssessment
  >();
  private readonly relevanceByRevisionUser = new Map<
    string,
    SavedRelevanceAssessment
  >();
  private sequence = 0;

  saveGlobal(input: Omit<SavedGlobalAssessment, "id" | "createdAt">) {
    const assessment: SavedGlobalAssessment = {
      ...input,
      id: this.nextId("global_assessment"),
      createdAt: new Date().toISOString(),
    };
    this.globalByHash.set(input.inputHash, assessment);
    this.globalByRevision.set(input.eventRevisionId, assessment);
    return assessment;
  }

  getGlobalByHash(inputHash: string) {
    return this.globalByHash.get(inputHash);
  }

  getLatestGlobal(eventRevisionId: string) {
    return this.globalByRevision.get(eventRevisionId);
  }

  saveRelevance(input: Omit<SavedRelevanceAssessment, "id" | "createdAt">) {
    const assessment: SavedRelevanceAssessment = {
      ...input,
      id: this.nextId("relevance_assessment"),
      createdAt: new Date().toISOString(),
    };
    this.relevanceByHash.set(input.inputHash, assessment);
    this.relevanceByRevisionUser.set(
      this.relevanceKey(input.eventRevisionId, input.userId),
      assessment,
    );
    return assessment;
  }

  getRelevanceByHash(inputHash: string) {
    return this.relevanceByHash.get(inputHash);
  }

  getLatestRelevance(eventRevisionId: string, userId: string) {
    return this.relevanceByRevisionUser.get(
      this.relevanceKey(eventRevisionId, userId),
    );
  }

  private relevanceKey(eventRevisionId: string, userId: string) {
    return `${eventRevisionId}:${userId}`;
  }

  private nextId(prefix: string) {
    this.sequence += 1;
    return `${prefix}_${this.sequence}`;
  }
}

export class ResearchAssessmentContractError extends Error {
  constructor(
    message: string,
    readonly validationErrors: string[],
  ) {
    super(message);
    this.name = "ResearchAssessmentContractError";
  }
}

export class ResearchAssessmentService {
  constructor(
    private readonly llm: ResearchAssessmentLlmAdapter,
    private readonly store = new InMemoryResearchAssessmentStore(),
  ) {}

  async assessGlobal(
    eventRevision: FrozenResearchEventRevisionInput,
  ): Promise<AssessmentResult<SavedGlobalAssessment>> {
    const inputSnapshot = buildGlobalInputSnapshot(eventRevision);
    const inputHash = hashAssessmentInput({
      kind: "GLOBAL",
      inputSnapshot,
      route: routeIdentity("GLOBAL"),
    });
    const cached = this.store.getGlobalByHash(inputHash);
    if (cached) return { status: "CACHED", assessment: cached };

    try {
      const assessed = await this.callWithSingleRepair(
        "GLOBAL",
        inputSnapshot,
        (output) => validateGlobalOutput(output, eventRevision),
      );
      return {
        status: "CREATED",
        assessment: this.store.saveGlobal({
          eventRevisionId: eventRevision.revisionId,
          inputHash,
          output: assessed.output,
          usage: assessed.usage,
        }),
      };
    } catch (error) {
      const previous = this.store.getLatestGlobal(eventRevision.revisionId);
      if (previous) {
        return {
          status: "STALE_RETAINED",
          assessment: previous,
          validationErrors:
            error instanceof ResearchAssessmentContractError
              ? error.validationErrors
              : [String((error as Error).message ?? error)],
        };
      }
      throw error;
    }
  }

  async assessRelevance(input: {
    userId: string;
    eventRevision: FrozenResearchEventRevisionInput;
    preferenceSnapshot: ResearchPreferenceSnapshot;
  }): Promise<AssessmentResult<SavedRelevanceAssessment>> {
    const matches = resolvePreferenceMatches(
      input.preferenceSnapshot.enabled ? input.preferenceSnapshot.items : [],
      input.eventRevision.impacts.map((impact) => ({
        targetType: impact.subjectType,
        targetKey: impact.subjectKey,
        relation: impact.relation,
        path: impact.path,
      })),
    );
    const inputSnapshot = buildRelevanceInputSnapshot({
      eventRevision: input.eventRevision,
      preferenceSnapshot: input.preferenceSnapshot,
      deterministicMatches: matches,
    });
    const inputHash = hashAssessmentInput({
      kind: "RELEVANCE",
      inputSnapshot,
      route: routeIdentity("RELEVANCE"),
    });
    const cached = this.store.getRelevanceByHash(inputHash);
    if (cached) return { status: "CACHED", assessment: cached };

    try {
      const assessed = await this.callWithSingleRepair(
        "RELEVANCE",
        inputSnapshot,
        (output) =>
          validateRelevanceOutput(
            output,
            input.eventRevision,
            input.preferenceSnapshot.items,
          ),
      );
      const outputMatches = resolvePreferenceMatches(
        input.preferenceSnapshot.enabled ? input.preferenceSnapshot.items : [],
        assessed.output.matchedPreferences,
      );
      return {
        status: "CREATED",
        assessment: this.store.saveRelevance({
          eventRevisionId: input.eventRevision.revisionId,
          userId: input.userId,
          preferenceSnapshotId: input.preferenceSnapshot.id,
          inputHash,
          output: { ...assessed.output, matchedPreferences: outputMatches },
          matchedPreferences: outputMatches,
          directFocusMatch: hasDirectFocusMatch(outputMatches),
          usage: assessed.usage,
        }),
      };
    } catch (error) {
      const previous = this.store.getLatestRelevance(
        input.eventRevision.revisionId,
        input.userId,
      );
      if (previous) {
        return {
          status: "STALE_RETAINED",
          assessment: previous,
          validationErrors:
            error instanceof ResearchAssessmentContractError
              ? error.validationErrors
              : [String((error as Error).message ?? error)],
        };
      }
      throw error;
    }
  }

  buildPersonalizedRadar(input: {
    baselineEvents: Array<{
      eventRevisionId: string;
      title: string;
      rank: number;
      globalAssessment?: SavedGlobalAssessment;
    }>;
    relevanceAssessments: SavedRelevanceAssessment[];
  }) {
    const baselineEvents = [...input.baselineEvents].sort(
      (left, right) => left.rank - right.rank,
    );
    const relevantByRevision = new Map(
      input.relevanceAssessments
        .filter(
          (assessment) =>
            assessment.output.relevance.score !== null &&
            assessment.output.relevance.score > 0 &&
            assessment.matchedPreferences.length > 0,
        )
        .map((assessment) => [assessment.eventRevisionId, assessment]),
    );
    return {
      baselineEvents,
      radarItems: baselineEvents
        .map((event) => {
          const assessment = relevantByRevision.get(event.eventRevisionId);
          if (!assessment) return undefined;
          return {
            eventRevisionId: event.eventRevisionId,
            title: event.title,
            relevance: assessment.output.relevance,
            matchedPreferences: assessment.matchedPreferences,
            directFocusMatch: assessment.directFocusMatch,
            baselineRank: event.rank,
          };
        })
        .filter((item): item is NonNullable<typeof item> => Boolean(item))
        .sort((left, right) => {
          const scoreOrder =
            (right.relevance.score ?? -1) - (left.relevance.score ?? -1);
          if (scoreOrder !== 0) return scoreOrder;
          return left.baselineRank - right.baselineRank;
        }),
    };
  }

  private async callWithSingleRepair<
    T extends
      | ResearchGlobalAssessmentOutput
      | ResearchRelevanceAssessmentOutput,
  >(
    kind: ResearchAssessmentKind,
    inputSnapshot: unknown,
    validate: (output: unknown) => T,
  ): Promise<{
    output: T;
    usage: ResearchAssessmentUsage;
  }> {
    let repairOf: ResearchAssessmentLlmRequest["repairOf"];
    let attempts = 0;
    let lastErrors: string[] = [];
    while (attempts < 2) {
      attempts += 1;
      const response = await this.llm.complete({
        kind,
        ...routeIdentity(kind),
        messages: buildMessages(kind, inputSnapshot),
        repairOf,
      });
      const parsed = parseJsonObject(response.rawOutput);
      if (parsed.ok) {
        const schema =
          kind === "GLOBAL"
            ? researchGlobalAssessmentOutputSchema
            : researchRelevanceAssessmentOutputSchema;
        const checked = schema.safeParse(parsed.value);
        if (checked.success && !containsForbiddenField(parsed.value)) {
          try {
            const output = validate(checked.data);
            return {
              output,
              usage: { ...response.usage, attempts },
            };
          } catch (error) {
            lastErrors =
              error instanceof ResearchAssessmentContractError
                ? error.validationErrors
                : [String((error as Error).message ?? error)];
            repairOf = {
              rawOutput: response.rawOutput,
              validationErrors: lastErrors,
            };
            continue;
          }
        }
        if (checked.success) {
          lastErrors = ["输出包含禁止字段"];
        } else {
          lastErrors = checked.error.issues.map((issue) => issue.message);
        }
      } else {
        lastErrors = [parsed.error];
      }
      repairOf = {
        rawOutput: response.rawOutput,
        validationErrors: lastErrors,
      };
    }
    throw new ResearchAssessmentContractError(
      "四维评估输出未通过机器契约",
      lastErrors,
    );
  }
}

function routeIdentity(kind: ResearchAssessmentKind) {
  return {
    model: RESEARCH_ASSESSMENT_MODEL,
    temperature: 0 as const,
    maxInputTokens: kind === "GLOBAL" ? 32_000 : 8_000,
    maxOutputTokens: kind === "GLOBAL" ? 3_000 : 1_500,
  };
}

function buildGlobalInputSnapshot(
  eventRevision: FrozenResearchEventRevisionInput,
) {
  return {
    contractVersion: RESEARCH_ASSESSMENT_CONTRACT_VERSION,
    eventRevision,
  };
}

function buildRelevanceInputSnapshot(input: {
  eventRevision: FrozenResearchEventRevisionInput;
  preferenceSnapshot: ResearchPreferenceSnapshot;
  deterministicMatches: ResearchPreferenceMatch[];
}) {
  return {
    contractVersion: RESEARCH_ASSESSMENT_CONTRACT_VERSION,
    eventRevision: input.eventRevision,
    preferenceSnapshot: input.preferenceSnapshot,
    deterministicMatches: input.deterministicMatches,
  };
}

function buildMessages(kind: ResearchAssessmentKind, inputSnapshot: unknown) {
  const dimensions =
    kind === "GLOBAL"
      ? "importance、confidence、informationNovelty"
      : "relevance、matchedPreferences";
  return [
    {
      role: "system" as const,
      content: [
        "你只根据输入中的冻结研究事件、证据、相关研究认知基线和研究偏好评分。",
        "返回 JSON；分数只能是 0、1、2、3、4 或 null。",
        "不得输出总分、渠道建议、买卖动作、仓位、价格指令或输入外事实。",
      ].join("\n"),
    },
    {
      role: "user" as const,
      content: `评估维度：${dimensions}\n冻结输入：${canonicalJson(inputSnapshot)}`,
    },
  ];
}

function hashAssessmentInput(value: unknown) {
  return `sha256:${createHash("sha256")
    .update(canonicalJson(value), "utf8")
    .digest("hex")}`;
}

function parseJsonObject(
  rawOutput: string,
): { ok: true; value: unknown } | { ok: false; error: string } {
  try {
    return { ok: true, value: JSON.parse(rawOutput) as unknown };
  } catch (error) {
    return { ok: false, error: String((error as Error).message) };
  }
}

function validateGlobalOutput(
  output: unknown,
  eventRevision: FrozenResearchEventRevisionInput,
) {
  const parsed = researchGlobalAssessmentOutputSchema.parse(output);
  assertCitationClosure(parsed, allowedRefs(eventRevision, []));
  return parsed;
}

function validateRelevanceOutput(
  output: unknown,
  eventRevision: FrozenResearchEventRevisionInput,
  preferenceItems: ResearchPreferenceItem[],
) {
  const parsed = researchRelevanceAssessmentOutputSchema.parse(output);
  assertCitationClosure(parsed, allowedRefs(eventRevision, preferenceItems));
  return parsed;
}

function allowedRefs(
  eventRevision: FrozenResearchEventRevisionInput,
  preferenceItems: ResearchPreferenceItem[],
) {
  return new Set([
    eventRevision.revisionId,
    ...eventRevision.claims.map((claim) => claim.id),
    ...eventRevision.evidence.map((evidence) => evidence.id),
    ...eventRevision.impacts.map((impact) => impact.id),
    ...eventRevision.cognitiveBaseline.map((item) => item.id),
    ...preferenceItems.map((item) => preferenceRefId(item)),
  ]);
}

function assertCitationClosure(output: unknown, refs: Set<string>) {
  const citations = collectCitations(output);
  for (const citation of citations) {
    if (!refs.has(citation.refId)) {
      throw new ResearchAssessmentContractError(
        `引用不闭合：${citation.refId}`,
        [`引用不闭合：${citation.refId}`],
      );
    }
  }
}

function collectCitations(value: unknown): Array<{ refId: string }> {
  if (Array.isArray(value)) return value.flatMap(collectCitations);
  if (!value || typeof value !== "object") return [];
  const record = value as Record<string, unknown>;
  const own = typeof record.refId === "string" ? [{ refId: record.refId }] : [];
  return [
    ...own,
    ...Object.entries(record)
      .filter(([key]) => key !== "refId")
      .flatMap(([, child]) => collectCitations(child)),
  ];
}

function containsForbiddenField(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(containsForbiddenField);
  if (!value || typeof value !== "object") return false;
  const forbidden = new Set([
    "totalScore",
    "overallScore",
    "channel",
    "channelAdvice",
    "recommendation",
    "tradeAction",
    "position",
    "targetPrice",
    "stopLoss",
  ]);
  return Object.entries(value as Record<string, unknown>).some(
    ([key, child]) => forbidden.has(key) || containsForbiddenField(child),
  );
}

function preferenceRefId(item: ResearchPreferenceItem) {
  return `preference:${item.targetType}:${item.targetKey}`;
}
