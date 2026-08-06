import type { PrismaClient } from "@prisma/client";
import {
  type HomepageMarketBaseline,
  type HomepageMarketDomainId,
  type HomepageMarketPhaseId,
  homepageMarketBaselineSchema,
  homepageMarketDomainIds,
  homepageMarketPhaseIds,
} from "~/contracts/homepage-market-baseline";

const phaseLabels: Record<HomepageMarketPhaseId, string> = {
  PRE_MARKET: "盘前",
  INTRADAY: "盘中",
  POST_MARKET: "盘后",
  FORWARD: "前瞻",
};

const domainLabels: Record<HomepageMarketDomainId, string> = {
  market: "市场结构",
  flow: "资金与交易行为",
  company: "公司信息",
  news: "新闻与政策",
  expectation: "预期变化",
  calendar: "事件日历",
};

type JsonRecord = Record<string, unknown>;

function record(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonRecord)
    : {};
}

function text(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function firstText(source: JsonRecord, keys: readonly string[]) {
  for (const key of keys) {
    const value = text(source[key]);
    if (value) return value;
  }
  return null;
}

function iso(value: Date | null) {
  return value?.toISOString() ?? null;
}

function phaseFromTargetContext(value: unknown): HomepageMarketPhaseId {
  const phase = record(value).phase;
  if (
    typeof phase !== "string" ||
    !homepageMarketPhaseIds.includes(phase as HomepageMarketPhaseId)
  ) {
    throw new Error("首页基线清单缺少明确的交易阶段");
  }
  return phase as HomepageMarketPhaseId;
}

function domainFromFactScope(value: unknown): HomepageMarketDomainId {
  const domain = record(value).baselineDomain;
  if (
    typeof domain !== "string" ||
    !homepageMarketDomainIds.includes(domain as HomepageMarketDomainId)
  ) {
    throw new Error("首页基线清单项缺少明确的信息域");
  }
  return domain as HomepageMarketDomainId;
}

function cutoff(value: unknown, fallbackKey: string) {
  const source = record(value);
  const key = text(source.key) ?? fallbackKey;
  const cutoffValue = text(source.value) ?? fallbackKey;
  return { ...source, key, value: cutoffValue };
}

function sourceUrl(raw: JsonRecord) {
  const candidate = firstText(raw, [
    "url",
    "sourceUrl",
    "source_url",
    "link",
    "webUrl",
    "web_url",
  ]);
  if (!candidate) return null;
  try {
    const parsed = new URL(candidate);
    return parsed.protocol === "http:" || parsed.protocol === "https:"
      ? parsed.toString()
      : null;
  } catch {
    return null;
  }
}

function displayValue(value: unknown, unit: string | null) {
  if (value === null || value === undefined) return "无有效值";
  if (typeof value === "string" || typeof value === "number") {
    return `${value}${unit ? ` ${unit}` : ""}`;
  }
  if (typeof value === "boolean") return value ? "是" : "否";
  const source = record(value);
  const scalar = ["value", "amount", "close", "pct_chg", "changePercent"]
    .map((key) => source[key])
    .find((candidate) =>
      ["string", "number", "boolean"].includes(typeof candidate),
    );
  if (scalar !== undefined) return displayValue(scalar, unit);
  return "结构化记录";
}

export function homepageBaselineNumericValue(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  if (!value || typeof value !== "object") return null;
  const source = record(value);
  for (const key of [
    "value",
    "amount",
    "close",
    "pct_chg",
    "changePercent",
    "net_amount",
  ]) {
    if (source[key] === value) continue;
    const parsed = homepageBaselineNumericValue(source[key]);
    if (parsed !== null) return parsed;
  }
  return null;
}

function observationCopy(input: {
  value: unknown;
  raw: JsonRecord;
  subjectKey: string;
  metricCatalogId: string;
}) {
  const normalized = record(input.value);
  const title =
    firstText(normalized, ["title", "headline", "name", "companyName"]) ??
    firstText(input.raw, [
      "title",
      "headline",
      "name",
      "companyName",
      "stock_name",
      "ts_code",
    ]) ??
    `${input.subjectKey} · ${input.metricCatalogId}`;
  const summary =
    firstText(normalized, ["summary", "content", "description", "abstract"]) ??
    firstText(input.raw, ["summary", "content", "description", "abstract"]) ??
    "该规范化观测未提供额外摘要。";
  return { title, summary };
}

export async function readHomepageMarketBaseline(
  db: PrismaClient,
): Promise<HomepageMarketBaseline> {
  const snapshots = await db.homepageSnapshot.findMany({
    where: {
      scope: "BASELINE",
      manifest: {
        definitionVersion: {
          in: [
            "homepage-baseline-manifest.v1",
            "homepage-baseline-manifest.v2",
            "homepage-baseline-manifest.v3",
            "homepage-baseline-manifest.v4",
          ],
        },
      },
    },
    orderBy: { activationSequence: "desc" },
    take: 100,
    include: {
      manifest: {
        include: {
          items: {
            orderBy: { itemKey: "asc" },
            include: {
              settlement: {
                include: {
                  revisions: {
                    orderBy: { ordinal: "asc" },
                    include: {
                      observationRevision: {
                        include: {
                          observation: true,
                          revisionSources: {
                            orderBy: [
                              { role: "desc" },
                              { sourceAssertionId: "asc" },
                            ],
                            include: { sourceAssertion: true },
                          },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
  });

  const latestByPhase = new Map<
    HomepageMarketPhaseId,
    (typeof snapshots)[number]
  >();
  for (const snapshot of snapshots) {
    const phase = phaseFromTargetContext(snapshot.manifest.targetContextJson);
    if (!latestByPhase.has(phase)) latestByPhase.set(phase, snapshot);
  }
  const missing = homepageMarketPhaseIds.filter(
    (phase) => !latestByPhase.has(phase),
  );
  if (missing.length > 0) {
    throw new Error(`专业市场基线阶段快照尚未就绪: ${missing.join(",")}`);
  }

  const phases = homepageMarketPhaseIds.map((phaseId) => {
    const snapshot = latestByPhase.get(phaseId);
    if (!snapshot) throw new Error(`专业市场基线阶段快照缺失: ${phaseId}`);
    const items = new Map<
      HomepageMarketDomainId,
      (typeof snapshot.manifest.items)[number]
    >();
    for (const item of snapshot.manifest.items) {
      if (item.datasetKey === "market_heatmap") continue;
      const domain = domainFromFactScope(item.factScopeJson);
      if (items.has(domain))
        throw new Error(`首页阶段存在重复信息域: ${phaseId}:${domain}`);
      items.set(domain, item);
    }
    const missingDomains = homepageMarketDomainIds.filter(
      (domain) => !items.has(domain),
    );
    if (missingDomains.length > 0) {
      throw new Error(
        `首页阶段缺少信息域: ${phaseId}:${missingDomains.join(",")}`,
      );
    }

    const domains = homepageMarketDomainIds.map((domainId) => {
      const item = items.get(domainId);
      if (!item?.settlement) {
        throw new Error(`首页阶段信息域缺少终态结算: ${phaseId}:${domainId}`);
      }
      const settlement = item.settlement;
      const observations = settlement.revisions.map(
        ({ observationRevision }) => {
          const selectedSource =
            observationRevision.revisionSources.find(
              (source) => source.role === "SELECTED",
            ) ?? observationRevision.revisionSources[0];
          const raw = record(selectedSource?.sourceAssertion.rawRecordJson);
          const value =
            observationRevision.valueJson ??
            observationRevision.valueText ??
            null;
          const copy = observationCopy({
            value,
            raw,
            subjectKey: observationRevision.observation.subjectKey,
            metricCatalogId: observationRevision.observation.metricCatalogId,
          });
          return {
            observationId: observationRevision.observationId,
            revisionId: observationRevision.id,
            revisionNo: observationRevision.revisionNo,
            subjectType: observationRevision.observation.subjectType,
            subjectKey: observationRevision.observation.subjectKey,
            metricCatalogId: observationRevision.observation.metricCatalogId,
            ...copy,
            value,
            displayValue: displayValue(value, observationRevision.unit),
            unit: observationRevision.unit,
            qualityStatus: observationRevision.qualityStatus,
            qualityFlags: [...observationRevision.qualityFlags].sort(),
            upstreamAsOf: iso(observationRevision.upstreamAsOf),
            sourcePublishedAt: iso(observationRevision.sourcePublishedAt),
            normalizedAt: observationRevision.normalizedAt.toISOString(),
            sources: observationRevision.revisionSources.map((source) => ({
              assertionId: source.sourceAssertion.id,
              role: source.role,
              sourceKey: source.sourceAssertion.sourceKey,
              datasetKey: source.sourceAssertion.datasetKey,
              sourceRecordKey: source.sourceAssertion.sourceRecordKey,
              providerVersion: source.sourceAssertion.providerVersion,
              url: sourceUrl(record(source.sourceAssertion.rawRecordJson)),
              sourcePublishedAt: iso(source.sourceAssertion.sourcePublishedAt),
              upstreamAsOf: iso(source.sourceAssertion.upstreamAsOf),
              fetchedAt: source.sourceAssertion.fetchedAt.toISOString(),
              selectionReason: source.selectionReason,
              fallbackReason: source.fallbackReason,
            })),
          };
        },
      );
      return {
        id: domainId,
        label: domainLabels[domainId],
        datasetKey: item.datasetKey,
        required: item.required,
        coverage: {
          targetDataCutoff: cutoff(
            settlement.targetDataCutoffJson,
            settlement.targetDataCutoffKey,
          ),
          actualDataCutoff: cutoff(
            settlement.actualDataCutoffJson,
            settlement.actualDataCutoffKey,
          ),
          settlementStatus: settlement.settlementStatus,
          providerResultStatus: settlement.providerResultStatus,
          qualityStatus: settlement.qualityStatus,
          qualityFlags: [...settlement.qualityFlags].sort(),
          limitations: [...settlement.limitations].sort(),
          requestedScope: settlement.requestedScopeJson,
          coveredScope: settlement.coveredScopeJson,
          missingScope: settlement.missingScopeJson,
        },
        observations,
      };
    });

    const chartPoints = (domainId: HomepageMarketDomainId) =>
      (domains.find((domain) => domain.id === domainId)?.observations ?? [])
        .map((observation) => {
          const value = homepageBaselineNumericValue(observation.value);
          return value === null
            ? null
            : {
                label: observation.title,
                value,
                displayValue: observation.displayValue,
                revisionId: observation.revisionId,
              };
        })
        .filter((point): point is NonNullable<typeof point> => point !== null)
        .slice(0, 12);
    const eventObservations = domains.find(
      (domain) => domain.id === "calendar",
    )?.observations;
    return {
      id: phaseId,
      label: phaseLabels[phaseId],
      snapshotId: snapshot.id,
      manifestId: snapshot.manifestId,
      activationSequence: snapshot.activationSequence.toString(),
      generatedAt: snapshot.generatedAt.toISOString(),
      targetTradeDate:
        text(record(snapshot.manifest.targetContextJson).targetTradeDate) ??
        snapshot.manifest.targetContextKey,
      state:
        snapshot.manifest.gateStatus === "READY_WITH_LIMITATION"
          ? ("READY_WITH_LIMITATION" as const)
          : ("READY" as const),
      domains,
      charts: {
        breadth: chartPoints("market"),
        flows: chartPoints("flow"),
        events: (eventObservations ?? []).slice(0, 12).map((observation) => ({
          label: observation.title,
          time:
            observation.sourcePublishedAt ??
            observation.upstreamAsOf ??
            observation.normalizedAt,
          revisionId: observation.revisionId,
        })),
      },
    };
  });

  const defaultPhase = [...phases].sort((left, right) =>
    BigInt(left.activationSequence) > BigInt(right.activationSequence) ? -1 : 1,
  )[0]?.id;
  if (!defaultPhase) throw new Error("专业市场基线没有可读阶段");
  return homepageMarketBaselineSchema.parse({
    contractVersion: "professional-market-baseline.v1",
    defaultPhase,
    phases,
  });
}
