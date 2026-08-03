import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { MarketBaselineWorkspace } from "~/app/_components/market-baseline-workspace";
import {
  homepageMarketBaselineSchema,
  homepageMarketDomainIds,
  homepageMarketPhaseIds,
  type HomepageMarketBaseline,
} from "~/contracts/homepage-market-baseline";

function baseline(): HomepageMarketBaseline {
  return homepageMarketBaselineSchema.parse({
    contractVersion: "professional-market-baseline.v1",
    defaultPhase: "PRE_MARKET",
    phases: homepageMarketPhaseIds.map((phase, phaseIndex) => ({
      id: phase,
      label: ["盘前", "盘中", "盘后", "前瞻"][phaseIndex],
      snapshotId: `snapshot-${phase}`,
      manifestId: `manifest-${phase}`,
      activationSequence: String(phaseIndex + 1),
      generatedAt: "2026-08-03T08:05:00.000Z",
      targetTradeDate: "2026-08-03",
      state: phase === "POST_MARKET" ? "READY_WITH_LIMITATION" : "READY",
      domains: homepageMarketDomainIds.map((domain, domainIndex) => ({
        id: domain,
        label: [
          "市场结构",
          "资金与交易行为",
          "公司信息",
          "新闻与政策",
          "预期变化",
          "事件日历",
        ][domainIndex],
        datasetKey: `${domain}_dataset`,
        required: domain === "market",
        coverage: {
          targetDataCutoff: { key: "trade_date", value: "2026-08-03" },
          actualDataCutoff: {
            key: "trade_date",
            value: `2026-08-03 ${String(8 + domainIndex).padStart(2, "0")}:00`,
          },
          settlementStatus: domain === "flow" ? "DEGRADED" : "READY",
          providerResultStatus: domain === "flow" ? "degraded" : "success",
          qualityStatus: domain === "flow" ? "DEGRADED" : "NORMAL",
          qualityFlags: domain === "flow" ? ["PARTIAL_SCOPE"] : [],
          limitations: domain === "flow" ? ["部分资金分类缺失"] : [],
          requestedScope: { market: "CN-A" },
          coveredScope: { market: "CN-A" },
          missingScope: domain === "flow" ? { concept: ["部分分类"] } : {},
        },
        observations: [
          {
            observationId: `${phase}-${domain}-observation`,
            revisionId: `${phase}-${domain}-revision`,
            revisionNo: 2,
            subjectType: "market",
            subjectKey: "CN-A",
            metricCatalogId: `${domain}_dataset`,
            title: `${phase}-${domain}-权威观测`,
            summary: `${domain} 的规范化摘要`,
            value: { value: domainIndex + 1 },
            displayValue: `${domainIndex + 1}`,
            unit: null,
            qualityStatus: "NORMAL",
            qualityFlags: [],
            upstreamAsOf: "2026-08-03T07:50:00.000Z",
            sourcePublishedAt: "2026-08-03T07:55:00.000Z",
            normalizedAt: "2026-08-03T08:00:00.000Z",
            sources: [
              {
                assertionId: `${phase}-${domain}-assertion`,
                role: "SELECTED",
                sourceKey: domain === "news" ? "minishare" : "tushare",
                datasetKey: `${domain}_dataset`,
                sourceRecordKey: `${phase}-${domain}-record`,
                providerVersion: "provider-v1",
                url: `https://example.test/${phase.toLowerCase()}/${domain}`,
                sourcePublishedAt: "2026-08-03T07:55:00.000Z",
                upstreamAsOf: null,
                fetchedAt: "2026-08-03T08:00:00.000Z",
                selectionReason: "生产 Provider 选择的权威来源",
                fallbackReason: null,
              },
            ],
          },
        ],
      })),
      charts: {
        breadth: [],
        flows: [],
        events: [],
      },
    })),
  });
}

describe("正式首页专业市场基线工作台", () => {
  it("按阶段和信息域渲染权威观测、独立截止点与证据入口", () => {
    const html = renderToStaticMarkup(
      createElement(MarketBaselineWorkspace, {
        baseline: baseline(),
        initialPhase: "PRE_MARKET",
        initialDomain: "market",
      }),
    );

    expect(html).toContain('role="tablist"');
    expect(html).toMatch(/aria-selected="true"[^>]*>盘前/);
    expect(html).toMatch(/aria-selected="true"[^>]*>市场结构/);
    expect(html).toContain("PRE_MARKET-market-权威观测");
    expect(html).not.toContain("PRE_MARKET-news-权威观测");
    expect(html).toContain("2026-08-03 08:00");
    expect(html).toContain("修订 #2");
    expect(html).toContain(
      'href="https://example.test/pre_market/market"',
    );
    expect(html).toContain("生产 Provider 选择的权威来源");
  });

  it("受限信息域显示质量与限制，切换后的内容集合不混入其他域", () => {
    const html = renderToStaticMarkup(
      createElement(MarketBaselineWorkspace, {
        baseline: baseline(),
        initialPhase: "POST_MARKET",
        initialDomain: "flow",
      }),
    );

    expect(html).toMatch(/aria-selected="true"[^>]*>盘后/);
    expect(html).toMatch(/aria-selected="true"[^>]*>资金与交易行为/);
    expect(html).toContain("POST_MARKET-flow-权威观测");
    expect(html).not.toContain("POST_MARKET-market-权威观测");
    expect(html).toContain("DEGRADED");
    expect(html).toContain("部分资金分类缺失");
  });
});
