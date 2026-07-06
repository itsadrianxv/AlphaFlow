import type { EvidenceReference } from "~/server/domain/intelligence/entities/evidence-reference";
import type {
  InsightConceptMatch,
  InsightQualityFlag,
  ScreeningFactsBundle,
} from "~/server/domain/intelligence/types";
import type { InvestmentThesis } from "~/server/domain/intelligence/value-objects/investment-thesis";
import type { RiskPoint } from "~/server/domain/intelligence/value-objects/risk-point";

function daysBetween(later: Date, earlier: Date): number {
  return Math.floor((later.getTime() - earlier.getTime()) / 86_400_000);
}

export class InsightQualityService {
  evaluate(params: {
    factsBundle: ScreeningFactsBundle;
    evidenceRefs: EvidenceReference[];
    thesis: InvestmentThesis;
    risks: RiskPoint[];
    conceptMatches: InsightConceptMatch[];
  }): InsightQualityFlag[] {
    const flags = new Set<InsightQualityFlag>();

    if (params.evidenceRefs.length < 2) {
      flags.add("INSUFFICIENT_EVIDENCE");
    }

    if (params.risks.length === 0) {
      flags.add("MISSING_RISK_DISCLOSURE");
    }

    if (params.thesis.confidence === "low") {
      flags.add("LOW_CONFIDENCE");
    }

    if (
      !params.thesis.summary.trim() ||
      !params.thesis.whyNow.trim() ||
      params.thesis.drivers.length === 0 ||
      !params.thesis.monetizationPath.trim()
    ) {
      flags.add("MISSING_KEY_FIELDS");
    }

    if (
      params.conceptMatches.length > 0 &&
      params.conceptMatches.every((item) => item.confidence === "low")
    ) {
      flags.add("LOW_CONCEPT_CONFIDENCE");
    }

    const asOf = new Date(params.factsBundle.asOf);
    const staleEvidence = params.evidenceRefs.some((item) => {
      if (!item.publishedAt) {
        return false;
      }

      return daysBetween(asOf, new Date(item.publishedAt)) > 30;
    });

    if (staleEvidence) {
      flags.add("STALE_EVIDENCE");
    }

    return [...flags];
  }

  requiresManualReview(flags: InsightQualityFlag[]): boolean {
    return flags.length > 0;
  }
}
