import { createHash } from "node:crypto";
import type { Prisma, PrismaClient } from "@prisma/client";
import { enqueueHomePageTask } from "~/server/application/homepage/home-page-snapshot-service";
import {
  type HomepageDataAcquisitionPublisher,
  publishHomepageDataAcquisitionAttempt,
} from "~/server/application/homepage/homepage-data-acquisition-task-stream";
import { HomepageDataManifestService } from "~/server/application/homepage/homepage-data-manifest-service";

export type HomepageBaselinePhase =
  | "PRE_MARKET"
  | "INTRADAY"
  | "POST_MARKET"
  | "FORWARD";

export const HOMEPAGE_BASELINE_PHASES = [
  "PRE_MARKET",
  "INTRADAY",
  "POST_MARKET",
  "FORWARD",
] as const satisfies readonly HomepageBaselinePhase[];

type BaselineDomain =
  | "market"
  | "flow"
  | "company"
  | "news"
  | "expectation"
  | "calendar";

type BaselineDatasetDefinition = {
  baselineDomain: BaselineDomain;
  datasetKey: string;
  providerKey: "tushare" | "minishare";
  required: boolean;
  emptyPolicy: "ALLOW_EMPTY" | "REQUIRE_NON_EMPTY";
};

export const HOMEPAGE_BASELINE_DATASETS = [
  {
    baselineDomain: "market",
    datasetKey: "market_heatmap",
    providerKey: "tushare",
    required: true,
    emptyPolicy: "REQUIRE_NON_EMPTY",
  },
  {
    baselineDomain: "market",
    datasetKey: "market_snapshot",
    providerKey: "tushare",
    required: false,
    emptyPolicy: "REQUIRE_NON_EMPTY",
  },
  {
    baselineDomain: "flow",
    datasetKey: "market_money_flow",
    providerKey: "tushare",
    required: false,
    emptyPolicy: "ALLOW_EMPTY",
  },
  {
    baselineDomain: "company",
    datasetKey: "company_actions",
    providerKey: "tushare",
    required: false,
    emptyPolicy: "ALLOW_EMPTY",
  },
  {
    baselineDomain: "news",
    datasetKey: "news.major",
    providerKey: "minishare",
    required: false,
    emptyPolicy: "ALLOW_EMPTY",
  },
  {
    baselineDomain: "expectation",
    datasetKey: "expectation_changes",
    providerKey: "tushare",
    required: false,
    emptyPolicy: "ALLOW_EMPTY",
  },
  {
    baselineDomain: "calendar",
    datasetKey: "event_calendar",
    providerKey: "tushare",
    required: false,
    emptyPolicy: "ALLOW_EMPTY",
  },
] as const satisfies readonly BaselineDatasetDefinition[];

const DEFINITION_VERSION = "homepage-baseline-manifest.v3";
const REQUIREMENT_VERSION = "homepage-baseline-requirement.v3";
const PROVIDER_CONTRACT_VERSION = "1.0";
const NORMALIZATION_RULES_VERSION = "homepage-normalization.v1";

function stableJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  return `{${Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, nested]) => `${JSON.stringify(key)}:${stableJson(nested)}`)
    .join(",")}}`;
}

function sha256(value: unknown) {
  return `sha256:${createHash("sha256").update(stableJson(value), "utf8").digest("hex")}`;
}

function requestedScope(
  definition: BaselineDatasetDefinition,
  phase: HomepageBaselinePhase,
  targetTradeDate: string,
): Prisma.InputJsonObject {
  const common = {
    baselineDomain: definition.baselineDomain,
    phase,
    targetTradeDate,
  };
  if (definition.providerKey === "minishare") {
    return {
      ...common,
      startAt: `${targetTradeDate}T00:00:00+08:00`,
      endAt: `${targetTradeDate}T23:59:59+08:00`,
    };
  }
  return { ...common, tradeDate: targetTradeDate };
}

export function buildHomepageBaselineManifestItems(
  phase: HomepageBaselinePhase,
  targetTradeDate: string,
) {
  return HOMEPAGE_BASELINE_DATASETS.map((definition) => {
    const factScopeJson = requestedScope(definition, phase, targetTradeDate);
    const targetDataCutoffValue =
      definition.providerKey === "minishare"
        ? `${targetTradeDate}T23:59:59+08:00`
        : targetTradeDate;
    const targetDataCutoffJson = {
      key:
        definition.providerKey === "minishare" ? "published_at" : "trade_date",
      value: targetDataCutoffValue,
    };
    return {
      itemKey: `${REQUIREMENT_VERSION}:${definition.baselineDomain}:${definition.datasetKey}`,
      datasetKey: definition.datasetKey,
      factScopeKey: sha256(factScopeJson),
      factScopeJson,
      requirementVersion: REQUIREMENT_VERSION,
      required: definition.required,
      emptyPolicy: definition.emptyPolicy,
      targetDataCutoffKey: targetDataCutoffJson.key,
      targetDataCutoffJson,
      providerKey: definition.providerKey,
      providerContractVersion: PROVIDER_CONTRACT_VERSION,
      normalizationRulesVersion: NORMALIZATION_RULES_VERSION,
      requestFingerprint: sha256({
        datasetKey: definition.datasetKey,
        providerKey: definition.providerKey,
        factScopeJson,
        targetDataCutoffJson,
      }),
    };
  });
}

export function resolveHomepageBaselinePhase(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const values = Object.fromEntries(
    parts.map((part) => [part.type, part.value]),
  );
  const minutes = Number(values.hour) * 60 + Number(values.minute);
  if (minutes < 9 * 60 + 30) return "PRE_MARKET" as const;
  if (minutes < 15 * 60) return "INTRADAY" as const;
  if (minutes < 20 * 60) return "POST_MARKET" as const;
  return "FORWARD" as const;
}

type PublishResult = {
  publishedAttemptCount: number;
  publishFailures: Array<{ attemptId: string; message: string }>;
};

export class HomepageBaselineBootstrap {
  private readonly manifestService: HomepageDataManifestService;

  constructor(
    private readonly db: PrismaClient,
    private readonly publisher?: HomepageDataAcquisitionPublisher,
  ) {
    this.manifestService = new HomepageDataManifestService(db);
  }

  async ensureBaseline(input: {
    phase: HomepageBaselinePhase;
    targetTradeDate: string;
    requestNonce?: string;
    publishImmediately?: boolean;
  }) {
    const manifest = await this.manifestService.createManifest({
      scope: "BASELINE",
      definitionVersion: DEFINITION_VERSION,
      targetContextKey: `${input.targetTradeDate}:${input.phase}`,
      targetContextJson: {
        phase: input.phase,
        targetTradeDate: input.targetTradeDate,
      },
      requestNonce: input.requestNonce,
      items: buildHomepageBaselineManifestItems(
        input.phase,
        input.targetTradeDate,
      ),
    });
    const attempts = manifest.items.flatMap((item) => item.attempts);
    const published =
      input.publishImmediately === false
        ? { publishedAttemptCount: 0, publishFailures: [] }
        : await this.publishAttempts(attempts.map((attempt) => attempt.id));
    return {
      manifestId: manifest.id,
      attemptCount: attempts.length,
      ...published,
    };
  }

  async ensureTradingDay(input: {
    targetTradeDate: string;
    requestNonce?: string;
    publishImmediately?: boolean;
  }) {
    const manifests = [];
    for (const phase of HOMEPAGE_BASELINE_PHASES) {
      manifests.push(
        await this.ensureBaseline({
          phase,
          targetTradeDate: input.targetTradeDate,
          requestNonce: input.requestNonce,
          publishImmediately: input.publishImmediately,
        }),
      );
    }
    return {
      manifests,
      attemptCount: manifests.reduce(
        (total, manifest) => total + manifest.attemptCount,
        0,
      ),
      publishedAttemptCount: manifests.reduce(
        (total, manifest) => total + manifest.publishedAttemptCount,
        0,
      ),
      publishFailures: manifests.flatMap(
        (manifest) => manifest.publishFailures,
      ),
    };
  }

  async recoverReadyManifests(limit = 100) {
    const manifests = await this.db.homepageDataManifest.findMany({
      where: {
        scope: "BASELINE",
        gateStatus: { in: ["READY", "READY_WITH_LIMITATION"] },
        generationTask: { is: null },
      },
      select: { id: true },
      orderBy: { activationSequence: "asc" },
      take: limit,
    });
    let createdTaskCount = 0;
    for (const manifest of manifests) {
      const task = await enqueueHomePageTask(this.db, {
        scope: "BASELINE",
        manifestId: manifest.id,
        triggerReason: "MANIFEST_READY",
        publishImmediately: false,
      });
      if (task) createdTaskCount += 1;
    }
    return { createdTaskCount };
  }

  async recoverUnpublishedAttempts(limit = 100): Promise<PublishResult> {
    const attempts = await this.db.homepageDataManifestItemAttempt.findMany({
      where: {
        status: { in: ["PENDING", "RETRY_WAIT"] },
        eventPublishedAt: null,
        OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: new Date() } }],
      },
      select: { id: true },
      orderBy: { createdAt: "asc" },
      take: limit,
    });
    return this.publishAttempts(attempts.map((attempt) => attempt.id));
  }

  private async publishAttempts(attemptIds: string[]): Promise<PublishResult> {
    let publishedAttemptCount = 0;
    const publishFailures: PublishResult["publishFailures"] = [];
    for (const attemptId of attemptIds) {
      const eligible = await this.db.homepageDataManifestItemAttempt.findFirst({
        where: {
          id: attemptId,
          status: { in: ["PENDING", "RETRY_WAIT"] },
          eventPublishedAt: null,
          OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: new Date() } }],
        },
        select: { id: true },
      });
      if (!eligible) continue;
      try {
        const published = await publishHomepageDataAcquisitionAttempt(
          attemptId,
          this.publisher,
        );
        const updated =
          await this.db.homepageDataManifestItemAttempt.updateMany({
            where: { id: attemptId, eventPublishedAt: null },
            data: { eventPublishedAt: new Date(published.createdAt) },
          });
        publishedAttemptCount += updated.count;
      } catch (error) {
        publishFailures.push({
          attemptId,
          message: error instanceof Error ? error.message : String(error),
        });
      }
    }
    return { publishedAttemptCount, publishFailures };
  }
}
