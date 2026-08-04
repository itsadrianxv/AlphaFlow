import { describe, expect, it } from "vitest";
import {
  generateHomepageDraft,
  sha256Canonical,
  type HomepageGenerationInput,
} from "~/server/application/homepage/home-page-generation";

function input(items: HomepageGenerationInput["items"]): HomepageGenerationInput {
  const base = {
    contractVersion: "1.0",
    task: {
      id: "task-1",
      manifestId: "manifest-1",
      activationSequence: "42",
      promotionMode: "PROMOTABLE" as const,
      generationInputContractVersion: "1.0",
      generatorDefinitionVersion: "1.0",
      payloadSchemaVersion: "1.0",
    },
    manifest: {
      id: "manifest-1",
      manifestKey: "baseline:20260801",
      canonicalizationVersion: "jcs-1",
      scope: "BASELINE" as const,
      definitionVersion: "definition-v1",
      targetContextKey: "trade-date:20260801",
      targetContextJson: { tradeDate: "20260801" },
      activationSequence: "42",
      userId: null,
      baseManifestId: null,
      frozenPreferenceContractVersion: null,
      frozenPreferenceJson: null,
      gateStatus: "READY_WITH_LIMITATION" as const,
    },
    baseManifest: null,
    items: [...items].sort((a, b) => a.itemKey.localeCompare(b.itemKey)),
  };
  return { ...base, inputHash: sha256Canonical(base) };
}

function item(params: {
  itemKey: string;
  datasetKey: string;
  settlementStatus?: string;
  required?: boolean;
  revisionValue?: unknown;
}) {
  return {
    id: params.itemKey,
    itemKey: params.itemKey,
    sourceManifestId: "manifest-1",
    canonicalizationVersion: "jcs-1",
    datasetKey: params.datasetKey,
    factScopeKey: "scope",
    factScopeJson: { market: "CN_A" },
    requirementVersion: "1.0",
    required: params.required ?? true,
    emptyPolicy: "DISALLOW_EMPTY",
    targetDataCutoffKey: "20260801",
    targetDataCutoffJson: { tradeDate: "20260801" },
    settlement: {
      id: `${params.itemKey}:settlement`,
      settlementStatus: params.settlementStatus ?? "READY",
      providerResultStatus: params.settlementStatus === "DEGRADED" ? "degraded" : "success",
      requestedScopeJson: { market: "CN_A" },
      coveredScopeJson: { market: "CN_A" },
      missingScopeJson:
        params.settlementStatus === "DEGRADED"
          ? { concept: ["缺口"] }
          : ({} as Record<string, never>),
      targetDataCutoffKey: "20260801",
      targetDataCutoffJson: { tradeDate: "20260801" },
      actualDataCutoffKey: "20260801",
      actualDataCutoffJson: { tradeDate: "20260801" },
      qualityStatus: params.settlementStatus === "DEGRADED" ? "degraded" : "normal",
      qualityFlags: [],
      limitations: params.settlementStatus === "DEGRADED" ? ["可选数据降级"] : [],
      errorClass: null,
      retryability: null,
      revisions:
        params.revisionValue === undefined
          ? []
          : [
              {
                ordinal: 0,
                id: `${params.itemKey}:revision`,
                observationId: `${params.itemKey}:observation`,
                revisionNo: 1,
                revisionDedupKey: `${params.itemKey}:dedup`,
                canonicalizationVersion: "jcs-1",
                valueType: "json",
                valueText: null,
                valueJson: params.revisionValue as never,
                unit: null,
                precision: null,
                missingReason: null,
                qualityStatus: "normal",
                qualityFlags: [],
                valueHash: sha256Canonical(params.revisionValue),
                normalizationRulesVersion: "rules-v1",
                upstreamAsOf: "2026-08-01T00:00:00.000Z",
                sourcePublishedAt: "2026-08-01T00:00:00.000Z",
                normalizedAt: "2026-08-01T00:05:00.000Z",
              },
            ],
    },
  };
}

describe("首页固定输入与确定性生成", () => {
  it("相同固定输入产生相同 payload、payload hash 和覆盖摘要", () => {
    const fixed = input([
      item({
        itemKey: "b:optional-flow",
        datasetKey: "money_flow",
        required: false,
        settlementStatus: "DEGRADED",
      }),
      item({
        itemKey: "a:heatmap",
        datasetKey: "market_heatmap",
        revisionValue: { id: "concept-ai", name: "人工智能", score: 91 },
      }),
    ]);

    const first = generateHomepageDraft(fixed);
    const second = generateHomepageDraft(JSON.parse(JSON.stringify(fixed)));

    expect(second).toEqual(first);
    expect(first.inputHash).toBe(fixed.inputHash);
    expect(first.payloadHash).toBe(sha256Canonical(first.payload));
    expect(first.dataCoverage).toEqual([
      expect.objectContaining({ itemKey: "a:heatmap", settlementStatus: "READY" }),
      expect.objectContaining({
        itemKey: "b:optional-flow",
        settlementStatus: "DEGRADED",
        limitations: ["可选数据降级"],
      }),
    ]);
  });

  it("输入哈希覆盖冻结偏好和修订值", () => {
    const first = input([
      item({
        itemKey: "a:heatmap",
        datasetKey: "market_heatmap",
        revisionValue: { id: "concept-ai", score: 91 },
      }),
    ]);
    const changed = input([
      item({
        itemKey: "a:heatmap",
        datasetKey: "market_heatmap",
        revisionValue: { id: "concept-ai", score: 92 },
      }),
    ]);

    expect(first.inputHash).not.toBe(changed.inputHash);
    expect(generateHomepageDraft(first).payloadHash).not.toBe(
      generateHomepageDraft(changed).payloadHash,
    );
  });

  it("从首页清单中的整体概念快照恢复热力图", () => {
    const heatmap = {
      tradeDate: "20260801",
      marketCapAsOf: "20260801",
      priceSource: "daily",
      concepts: [
        {
          conceptCode: "885001.TI",
          conceptName: "算力",
          hotRank: 1,
          hotScore: 98,
          marketCap: 1000,
          changePercent: 2.5,
          stocks: [],
        },
      ],
    };
    const result = generateHomepageDraft(
      input([
        item({
          itemKey: "a:heatmap",
          datasetKey: "market_heatmap",
          revisionValue: heatmap,
        }),
      ]),
    );

    expect(result.payload.heatmap).toEqual(heatmap);
  });
});
