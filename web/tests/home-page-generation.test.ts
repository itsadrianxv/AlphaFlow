import { describe, expect, it } from "vitest";
import {
  HOMEPAGE_INFORMATION_DOMAIN_KEYS,
  HOMEPAGE_PAYLOAD_SCHEMA_VERSION,
  HOMEPAGE_STAGE_KEYS,
  versionedHomePagePayloadSchema,
  type HomePageJsonValue,
} from "~/contracts/homepage";
import {
  generateHomepageDraft,
  sha256Canonical,
  type HomepageGenerationInput,
  type HomepageGenerationInputItem,
} from "~/server/application/homepage/home-page-generation";

function makeInput(
  items: HomepageGenerationInput["items"],
  frozenPreferenceJson: HomepageGenerationInput["manifest"]["frozenPreferenceJson"] = null,
): HomepageGenerationInput {
  const base = {
    contractVersion: "homepage-generation-input.v1",
    task: {
      id: "task-1",
      manifestId: "manifest-1",
      activationSequence: "42",
      promotionMode: "PROMOTABLE" as const,
      generationInputContractVersion: "homepage-generation-input.v1",
      generatorDefinitionVersion: "homepage-generator.v1",
      payloadSchemaVersion: HOMEPAGE_PAYLOAD_SCHEMA_VERSION,
    },
    manifest: {
      id: "manifest-1",
      manifestKey: "baseline:20260801",
      canonicalizationVersion: "homepage-manifest-key.v1",
      scope: "BASELINE" as const,
      definitionVersion: "homepage-definition.v1",
      targetContextKey: "trade-date:20260801",
      targetContextJson: { tradeDate: "20260801" },
      activationSequence: "42",
      userId: null,
      baseManifestId: null,
      frozenPreferenceContractVersion:
        frozenPreferenceJson === null ? null : "research-preference.v1",
      frozenPreferenceJson,
      gateStatus: "READY_WITH_LIMITATION" as const,
    },
    baseManifest: null,
    items: [...items].sort((a, b) => a.itemKey.localeCompare(b.itemKey)),
  };
  return { ...base, inputHash: sha256Canonical(base) };
}

function makeItem(params: {
  itemKey: string;
  datasetKey: string;
  stageKey: string;
  domainKey: string;
  actualDataCutoffKey: string;
  settlementStatus?: "READY" | "DEGRADED" | "EMPTY" | "FAILED";
  required?: boolean;
  revisionValue?: unknown;
  missingScopeJson?: HomePageJsonValue;
}): HomepageGenerationInputItem {
  const settlementStatus = params.settlementStatus ?? "READY";
  const factScopeJson: Record<string, string> = {
    market: "CN_A",
    stageKey: params.stageKey,
    domainKey: params.domainKey,
  };
  const revision =
    params.revisionValue === undefined
      ? []
      : [
          {
            ordinal: 0,
            id: `${params.itemKey}:revision`,
            observationId: `${params.itemKey}:observation`,
            revisionNo: 1,
            revisionDedupKey: `${params.itemKey}:dedup`,
            canonicalizationVersion: "observation.v1",
            valueType: "json",
            valueText: null,
            valueJson: params.revisionValue as never,
            unit: null,
            precision: null,
            missingReason: null,
            qualityStatus: "NORMAL",
            qualityFlags: [],
            valueHash: sha256Canonical(params.revisionValue),
            normalizationRulesVersion: "normalization.v1",
            upstreamAsOf: "2026-08-01T00:00:00.000Z",
            sourcePublishedAt: "2026-08-01T00:00:00.000Z",
            normalizedAt: "2026-08-01T00:05:00.000Z",
          },
        ];

  return {
    id: params.itemKey,
    itemKey: params.itemKey,
    sourceManifestId: "manifest-1",
    canonicalizationVersion: "homepage-manifest-item-key.v1",
    datasetKey: params.datasetKey,
    factScopeKey: `${params.stageKey}:${params.domainKey}`,
    factScopeJson,
    requirementVersion: "homepage-requirements.v1",
    required: params.required ?? true,
    emptyPolicy: "DISALLOW_EMPTY",
    targetDataCutoffKey: "20260801",
    targetDataCutoffJson: { tradeDate: "20260801" },
    settlement: {
      id: `${params.itemKey}:settlement`,
      settlementStatus,
      providerResultStatus:
        settlementStatus === "FAILED"
          ? "error"
          : settlementStatus === "EMPTY"
            ? "empty"
            : settlementStatus === "DEGRADED"
              ? "degraded"
              : "success",
      requestedScopeJson: { market: "CN_A" },
      coveredScopeJson:
        settlementStatus === "DEGRADED"
          ? { market: "CN_A", partial: true }
          : { market: "CN_A" },
      missingScopeJson: params.missingScopeJson ?? {},
      targetDataCutoffKey: "20260801",
      targetDataCutoffJson: { tradeDate: "20260801" },
      actualDataCutoffKey: params.actualDataCutoffKey,
      actualDataCutoffJson: {
        tradeDate: params.actualDataCutoffKey,
      },
      qualityStatus: settlementStatus === "DEGRADED" ? "DEGRADED" : "NORMAL",
      qualityFlags: settlementStatus === "DEGRADED" ? ["PARTIAL_SCOPE"] : [],
      limitations:
        settlementStatus === "DEGRADED" ? ["资金流存在范围缺口"] : [],
      errorClass: settlementStatus === "FAILED" ? "UPSTREAM_UNAVAILABLE" : null,
      retryability: settlementStatus === "FAILED" ? "RETRYABLE" : null,
      revisions: revision,
    },
  };
}

describe("首页固定输入与确定性生成", () => {
  it("生成 versioned payload，并固定四阶段六信息域结构", () => {
    const result = generateHomepageDraft(
      makeInput([
        makeItem({
          itemKey: "a:market-heatmap",
          datasetKey: "market_heatmap",
          stageKey: "POST_MARKET",
          domainKey: "MARKET_STRUCTURE",
          actualDataCutoffKey: "20260801",
          revisionValue: {
            conceptCode: "concept-ai",
            conceptName: "人工智能",
            hotRank: 1,
            hotScore: 91,
            marketCap: 100,
            changePercent: 2.5,
            stocks: [],
          },
        }),
      ]),
    );

    expect(result.payload.schemaVersion).toBe(HOMEPAGE_PAYLOAD_SCHEMA_VERSION);
    expect(Object.keys(result.payload.stages)).toEqual(
      [...HOMEPAGE_STAGE_KEYS],
    );
    for (const stageKey of HOMEPAGE_STAGE_KEYS) {
      expect(Object.keys(result.payload.stages[stageKey].domains)).toEqual(
        [...HOMEPAGE_INFORMATION_DOMAIN_KEYS],
      );
    }
    expect(versionedHomePagePayloadSchema.safeParse(result.payload).success).toBe(
      true,
    );
  });

  it("按数据集和信息域使用自己的 actual cutoff，不被其他数据集的较新日期污染", () => {
    const result = generateHomepageDraft(
      makeInput([
        makeItem({
          itemKey: "a:market-heatmap",
          datasetKey: "market_heatmap",
          stageKey: "POST_MARKET",
          domainKey: "MARKET_STRUCTURE",
          actualDataCutoffKey: "20260801",
          revisionValue: {
            conceptCode: "concept-ai",
            conceptName: "人工智能",
            hotRank: 1,
            hotScore: 91,
            marketCap: 100,
            changePercent: 2.5,
            stocks: [],
          },
        }),
        makeItem({
          itemKey: "b:money-flow",
          datasetKey: "money_flow",
          stageKey: "POST_MARKET",
          domainKey: "FUND_FLOW_TRADING",
          actualDataCutoffKey: "20260803",
          required: false,
          settlementStatus: "DEGRADED",
          missingScopeJson: { industries: ["申万一级行业"] },
        }),
      ]),
    );

    expect(result.payload.heatmap.tradeDate).toBe("20260801");
    expect(result.payload.heatmap.marketCapAsOf).toBe("20260801");
    expect(
      result.payload.stages.POST_MARKET.domains.FUND_FLOW_TRADING.coverage
        .actualDataCutoffKey,
    ).toBe("20260803");
    expect(result.dataCoverage.items).toEqual([
      expect.objectContaining({
        itemKey: "a:market-heatmap",
        actualDataCutoffKey: "20260801",
      }),
      expect.objectContaining({
        itemKey: "b:money-flow",
        actualDataCutoffKey: "20260803",
        missingScope: { industries: ["申万一级行业"] },
        limitations: ["资金流存在范围缺口"],
      }),
    ]);
  });

  it("保留无数据域的 unknown cutoff 与限制，不把缺失伪装成已覆盖", () => {
    const result = generateHomepageDraft(
      makeInput([
        makeItem({
          itemKey: "a:market-heatmap",
          datasetKey: "market_heatmap",
          stageKey: "POST_MARKET",
          domainKey: "MARKET_STRUCTURE",
          actualDataCutoffKey: "20260801",
          revisionValue: {
            conceptCode: "concept-ai",
            conceptName: "人工智能",
            hotRank: 1,
            hotScore: 91,
            marketCap: 100,
            changePercent: 2.5,
            stocks: [],
          },
        }),
      ]),
    );

    const emptyDomain =
      result.payload.stages.PRE_MARKET.domains.EVENT_CALENDAR;
    expect(emptyDomain.status).toBe("UNAVAILABLE");
    expect(emptyDomain.coverage.actualDataCutoffKey).toBe("unknown");
    expect(emptyDomain.coverage.limitations).toContain(
      "该阶段该信息域没有已结算清单项",
    );
  });

  it("固定输入包含冻结偏好，内容变化会改变输入和 payload hash", () => {
    const items = [
      makeItem({
        itemKey: "a:market-heatmap",
        datasetKey: "market_heatmap",
        stageKey: "PRE_MARKET",
        domainKey: "MARKET_STRUCTURE",
        actualDataCutoffKey: "20260801",
        revisionValue: {
          conceptCode: "concept-ai",
          conceptName: "人工智能",
          hotRank: 1,
          hotScore: 91,
          marketCap: 100,
          changePercent: 2.5,
          stocks: [],
        },
      }),
    ];
    const first = makeInput(items, {
      enabled: true,
      followedObjects: ["industry:semiconductor"],
    });
    const changed = makeInput(items, {
      enabled: true,
      followedObjects: ["industry:banking"],
    });

    expect(first.inputHash).not.toBe(changed.inputHash);
    expect(generateHomepageDraft(first).payloadHash).not.toBe(
      generateHomepageDraft(changed).payloadHash,
    );
  });
});
