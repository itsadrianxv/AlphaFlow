import { createHash, randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { afterAll, describe, expect, it } from "vitest";
import { readHomepageMarketBaseline } from "~/server/application/homepage/homepage-market-baseline-read-model";

const contractDatabaseUrl = process.env.RESEARCH_POSTGRES_CONTRACT_URL;
const describePostgres = contractDatabaseUrl ? describe : describe.skip;

const phases = ["PRE_MARKET", "INTRADAY", "POST_MARKET", "FORWARD"] as const;
const domains = [
  ["market", "market_snapshot"],
  ["flow", "market_money_flow"],
  ["company", "company_actions"],
  ["news", "news.major"],
  ["expectation", "expectation_changes"],
  ["calendar", "event_calendar"],
] as const;

function key(prefix: string) {
  return `${prefix}-${randomUUID()}`;
}

function sha256(value: string) {
  return `sha256:${createHash("sha256").update(value, "utf8").digest("hex")}`;
}

describePostgres("正式首页四阶段六域读模型 PostgreSQL 契约", () => {
  const db = new PrismaClient({
    datasources: {
      db: {
        url:
          contractDatabaseUrl ??
          "postgresql://unused:unused@127.0.0.1:1/unused",
      },
    },
  });

  afterAll(async () => {
    await db.$disconnect();
  });

  async function seedPhaseSnapshot(input: {
    phase: (typeof phases)[number];
    activationSequence: bigint;
    titleSuffix: string;
  }) {
    const manifestId = key(`manifest-${input.phase}`);
    const snapshotId = key(`snapshot-${input.phase}`);
    const targetTradeDate = "2097-08-03";
    await db.homepageDataManifest.create({
      data: {
        id: manifestId,
        manifestKey: key("manifest-key"),
        canonicalizationVersion: "homepage-manifest-key.v1",
        scope: "BASELINE",
        definitionVersion: "homepage-baseline-manifest.v1",
        targetContextKey: `${targetTradeDate}:${input.phase}`,
        targetContextJson: { phase: input.phase, targetTradeDate },
        activationSequence: input.activationSequence,
        gateStatus:
          input.phase === "POST_MARKET"
            ? "READY_WITH_LIMITATION"
            : "READY",
      },
    });

    for (const [domain, datasetKey] of domains) {
      const itemId = key(`item-${input.phase}-${domain}`);
      const attemptId = key(`attempt-${input.phase}-${domain}`);
      const settlementId = key(`settlement-${input.phase}-${domain}`);
      const observationId = key(`observation-${input.phase}-${domain}`);
      const observationIdentityKey = key(`identity-${input.phase}-${domain}`);
      const revisionId = key(`revision-${input.phase}-${domain}`);
      const assertionId = key(`assertion-${input.phase}-${domain}`);
      const sourceUrl = `https://example.test/${input.phase.toLowerCase()}/${domain}`;
      const title = `${input.phase}-${domain}-${input.titleSuffix}`;
      const degraded = input.phase === "POST_MARKET" && domain === "flow";

      await db.homepageDataManifestItem.create({
        data: {
          id: itemId,
          manifestId,
          itemKey: `homepage-baseline-requirement.v1:${domain}`,
          canonicalizationVersion: "homepage-manifest-item-key.v1",
          datasetKey,
          factScopeKey: key("scope"),
          factScopeJson: {
            baselineDomain: domain,
            phase: input.phase,
            targetTradeDate,
          },
          requirementVersion: "homepage-baseline-requirement.v1",
          required: domain === "market",
          emptyPolicy: domain === "market" ? "REQUIRE_NON_EMPTY" : "ALLOW_EMPTY",
          targetDataCutoffKey: targetTradeDate,
          targetDataCutoffJson: { key: "trade_date", value: targetTradeDate },
        },
      });
      await db.homepageDataManifestItemAttempt.create({
        data: {
          id: attemptId,
          manifestItemId: itemId,
          attemptNo: 1,
          idempotencyKey: key("attempt-key"),
          providerKey: domain === "news" ? "minishare" : "tushare",
          providerContractVersion: "1.0",
          normalizationRulesVersion: "homepage-normalization.v1",
          requestFingerprint: sha256(key("request")),
          status: "RUNNING",
          workerId: key("worker"),
          fencingToken: 1n,
          leaseExpiresAt: new Date("2097-08-03T09:00:00.000Z"),
        },
      });
      await db.sourceAssertion.create({
        data: {
          id: assertionId,
          assertionKey: key("assertion-key"),
          canonicalizationVersion: "provider-source-assertion.v1",
          sourceKey: domain === "news" ? "minishare" : "tushare",
          datasetKey,
          sourceRecordKey: key("source-record"),
          observationIdentityKey,
          rawRecordJson: {
            title,
            summary: `${title} 的权威摘要`,
            url: sourceUrl,
          },
          contentHash: sha256(key("content-hash")),
          requestParamsHash: sha256(key("request-hash")),
          providerVersion: "provider-v1",
          sourcePublishedAt: new Date("2097-08-03T07:55:00.000Z"),
          fetchedAt: new Date("2097-08-03T08:00:00.000Z"),
        },
      });
      await db.dataObservation.create({
        data: {
          id: observationId,
          identityKey: observationIdentityKey,
          canonicalizationVersion: "provider-observation.v1",
          subjectType: domain === "market" ? "market" : "stock",
          subjectKey: domain === "market" ? "CN-A" : "000001.SZ",
          metricCatalogId: datasetKey,
          dimensionsJson: { phase: input.phase },
          observationKind: "INSTANT",
          observationDate: new Date(`${targetTradeDate}T00:00:00.000Z`),
        },
      });
      await db.dataObservationRevision.create({
        data: {
          id: revisionId,
          observationId,
          revisionNo: 1,
          revisionDedupKey: key("revision-dedup"),
          canonicalizationVersion: "provider-observation-revision.v1",
          valueType: "json",
          valueJson: {
            title,
            summary: `${title} 的规范化结果`,
            value: domain === "flow" ? 120000000 : 12.5,
          },
          unit: domain === "flow" ? "CNY" : null,
          qualityStatus: degraded ? "DEGRADED" : "NORMAL",
          qualityFlags: degraded ? ["PARTIAL_SCOPE"] : [],
          valueHash: sha256(key("value-hash")),
          normalizationRulesVersion: "homepage-normalization.v1",
          sourcePublishedAt: new Date("2097-08-03T07:55:00.000Z"),
          normalizedAt: new Date("2097-08-03T08:00:00.000Z"),
        },
      });
      await db.dataObservation.update({
        where: { id: observationId },
        data: { currentRevisionId: revisionId },
      });
      await db.dataObservationRevisionSource.create({
        data: {
          revisionId,
          sourceAssertionId: assertionId,
          role: "SELECTED",
          authorityStrategyVersion: "authority-v1",
          selectionReason: "生产 Provider 选择的权威来源",
        },
      });
      await db.homepageDataManifestItemSettlement.create({
        data: {
          id: settlementId,
          manifestItemId: itemId,
          settledAttemptId: attemptId,
          settledFencingToken: 1n,
          selectedRevisionId: revisionId,
          settlementStatus: degraded ? "DEGRADED" : "READY",
          providerResultStatus: degraded ? "degraded" : "success",
          requestedScopeJson: { targetTradeDate },
          coveredScopeJson: degraded ? { market: "CN-A" } : { targetTradeDate },
          missingScopeJson: degraded ? { concept: ["部分资金分类"] } : {},
          targetDataCutoffKey: targetTradeDate,
          targetDataCutoffJson: { key: "trade_date", value: targetTradeDate },
          actualDataCutoffKey: `${targetTradeDate}:${domain}`,
          actualDataCutoffJson: {
            key: "trade_date",
            value: targetTradeDate,
            domain,
          },
          qualityStatus: degraded ? "DEGRADED" : "NORMAL",
          qualityFlags: degraded ? ["PARTIAL_SCOPE"] : [],
          limitations: degraded ? ["部分资金分类缺失"] : [],
          settledAt: new Date("2097-08-03T08:00:00.000Z"),
        },
      });
      await db.homepageDataManifestItemSettlementRevision.create({
        data: {
          settlementId,
          observationRevisionId: revisionId,
          ordinal: 0,
        },
      });
      await db.homepageDataManifestItemAttempt.update({
        where: { id: attemptId },
        data: {
          status: "SUCCEEDED",
          resultStatus: degraded ? "degraded" : "success",
          workerId: null,
          leaseExpiresAt: null,
          completedAt: new Date("2097-08-03T08:00:00.000Z"),
        },
      });
    }

    const generationTaskId = key(`generation-${input.phase}`);
    await db.homepageGenerationTask.create({
      data: {
        id: generationTaskId,
        generationKey: key("generation-key"),
        manifestId,
        activationSequence: input.activationSequence,
        generationInputContractVersion: "1.0",
        generatorDefinitionVersion: "1.0",
        payloadSchemaVersion: "1.0",
        promotionMode: "PROMOTABLE",
        schedulingTier: "TIME_CRITICAL",
        resourcePoolKey: "homepage-generation",
        fairnessKey: "baseline",
        status: "SUCCEEDED",
        completedAt: new Date("2097-08-03T08:05:00.000Z"),
      },
    });
    await db.homepageSnapshot.create({
      data: {
        id: snapshotId,
        manifestId,
        generationTaskId,
        scope: "BASELINE",
        activationSequence: input.activationSequence,
        generationInputContractVersion: "1.0",
        generatorDefinitionVersion: "1.0",
        payloadSchemaVersion: "1.0",
        inputHash: sha256(key("input-hash")),
        payloadHash: sha256(key("payload-hash")),
        dataCoverageJson: [],
        payloadJson: {
          heatmap: {
            tradeDate: "20970803",
            marketCapAsOf: "20970803",
            priceSource: "daily",
            concepts: [],
          },
          overviewInsights: {},
          moneyFlow: {},
          impactMapping: null,
        },
        generatedAt: new Date("2097-08-03T08:05:00.000Z"),
      },
    });
    return { manifestId, snapshotId };
  }

  it("从最近的阶段快照投影真实覆盖、观测修订与来源断言", async () => {
    const base = BigInt(Date.now()) * 100n;
    const seeded = new Map<string, Awaited<ReturnType<typeof seedPhaseSnapshot>>>();
    for (const [index, phase] of phases.entries()) {
      seeded.set(
        phase,
        await seedPhaseSnapshot({
          phase,
          activationSequence: base + BigInt(index),
          titleSuffix: "current",
        }),
      );
    }
    await seedPhaseSnapshot({
      phase: "POST_MARKET",
      activationSequence: base - 1n,
      titleSuffix: "obsolete",
    });

    const model = await readHomepageMarketBaseline(db);

    expect(model.contractVersion).toBe("professional-market-baseline.v1");
    expect(model.phases.map((phase) => phase.id)).toEqual(phases);
    expect(model.phases.every((phase) => phase.domains.length === 6)).toBe(true);
    expect(model.phases.find((phase) => phase.id === "POST_MARKET")).toMatchObject({
      snapshotId: seeded.get("POST_MARKET")?.snapshotId,
      state: "READY_WITH_LIMITATION",
    });

    const market = model.phases[0]?.domains.find(
      (domain) => domain.id === "market",
    );
    expect(market).toMatchObject({
      datasetKey: "market_snapshot",
      coverage: {
        actualDataCutoff: {
          key: "trade_date",
          value: "2097-08-03",
          domain: "market",
        },
        settlementStatus: "READY",
        qualityStatus: "NORMAL",
      },
    });
    expect(market?.observations[0]).toMatchObject({
      revisionNo: 1,
      subjectType: "market",
      subjectKey: "CN-A",
      title: "PRE_MARKET-market-current",
      sources: [
        {
          role: "SELECTED",
          sourceKey: "tushare",
          providerVersion: "provider-v1",
          url: "https://example.test/pre_market/market",
        },
      ],
    });
    expect(model).not.toHaveProperty("globalActualDataCutoff");
    expect(
      JSON.stringify(model).includes("POST_MARKET-market-obsolete"),
    ).toBe(false);
  });
});
