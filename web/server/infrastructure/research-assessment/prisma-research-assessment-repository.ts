import { Prisma, type PrismaClient } from "@prisma/client";
import type {
  ResearchAssessmentRepository,
  SavedGlobalAssessment,
  SavedRelevanceAssessment,
} from "~/server/application/research-assessment/research-assessment-service";

export class PrismaResearchAssessmentRepository
  implements ResearchAssessmentRepository
{
  constructor(private readonly db: PrismaClient) {}

  async saveGlobal(input: Omit<SavedGlobalAssessment, "id" | "createdAt">) {
    const existing = await this.db.researchEventGlobalAssessment.findUnique({
      where: { inputHash: input.inputHash },
    });
    if (existing) return mapGlobal(existing);
    try {
      return mapGlobal(
        await this.db.researchEventGlobalAssessment.create({
          data: {
            eventRevisionId: input.eventRevisionId,
            inputHash: input.inputHash,
            contractVersion: "research-assessment.v1",
            model: "deepseek-v4-flash",
            promptVersion: "research-assessment.prompt.v1",
            schemaVersion: "research-assessment.schema.v1",
            importance: input.output.importance.score,
            confidence: input.output.confidence.score,
            informationNovelty: input.output.informationNovelty.score,
            dimensionsJson: toJson(input.output),
            inputSnapshotJson: toJson({
              eventRevisionId: input.eventRevisionId,
            }),
            usageJson: toJson(input.usage),
          },
        }),
      );
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
      const raced = await this.db.researchEventGlobalAssessment.findFirst({
        where: {
          OR: [
            { inputHash: input.inputHash },
            { eventRevisionId: input.eventRevisionId },
          ],
        },
      });
      if (!raced) throw error;
      return mapGlobal(raced);
    }
  }

  async getGlobalByHash(inputHash: string) {
    const row = await this.db.researchEventGlobalAssessment.findUnique({
      where: { inputHash },
    });
    return row ? mapGlobal(row) : undefined;
  }

  async getLatestGlobal(eventRevisionId: string) {
    const row = await this.db.researchEventGlobalAssessment.findUnique({
      where: { eventRevisionId },
    });
    return row ? mapGlobal(row) : undefined;
  }

  async saveRelevance(
    input: Omit<SavedRelevanceAssessment, "id" | "createdAt">,
  ) {
    const existing = await this.db.researchEventRelevanceAssessment.findUnique({
      where: { inputHash: input.inputHash },
    });
    if (existing) return mapRelevance(existing);
    try {
      return mapRelevance(
        await this.db.researchEventRelevanceAssessment.create({
          data: {
            eventRevisionId: input.eventRevisionId,
            userId: input.userId,
            preferenceSnapshotId: input.preferenceSnapshotId,
            inputHash: input.inputHash,
            contractVersion: "research-assessment.v1",
            model: "deepseek-v4-flash",
            promptVersion: "research-assessment.prompt.v1",
            schemaVersion: "research-assessment.schema.v1",
            relevance: input.output.relevance.score,
            directFocusMatch: input.directFocusMatch,
            matchedPreferencesJson: toJson(input.matchedPreferences),
            dimensionJson: toJson(input.output.relevance),
            inputSnapshotJson: toJson({
              eventRevisionId: input.eventRevisionId,
              preferenceSnapshotId: input.preferenceSnapshotId,
            }),
            usageJson: toJson(input.usage),
          },
        }),
      );
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
      const raced = await this.db.researchEventRelevanceAssessment.findFirst({
        where: {
          OR: [
            { inputHash: input.inputHash },
            { eventRevisionId: input.eventRevisionId, userId: input.userId },
          ],
        },
      });
      if (!raced) throw error;
      return mapRelevance(raced);
    }
  }

  async getRelevanceByHash(inputHash: string) {
    const row = await this.db.researchEventRelevanceAssessment.findUnique({
      where: { inputHash },
    });
    return row ? mapRelevance(row) : undefined;
  }

  async getLatestRelevance(eventRevisionId: string, userId: string) {
    const row = await this.db.researchEventRelevanceAssessment.findFirst({
      where: { eventRevisionId, userId },
    });
    return row ? mapRelevance(row) : undefined;
  }
}

function mapGlobal(row: {
  id: string;
  eventRevisionId: string;
  inputHash: string;
  dimensionsJson: unknown;
  usageJson: unknown;
  createdAt: Date;
}): SavedGlobalAssessment {
  return {
    id: row.id,
    eventRevisionId: row.eventRevisionId,
    inputHash: row.inputHash,
    output: row.dimensionsJson as SavedGlobalAssessment["output"],
    usage: row.usageJson as SavedGlobalAssessment["usage"],
    createdAt: row.createdAt.toISOString(),
  };
}

function mapRelevance(row: {
  id: string;
  eventRevisionId: string;
  userId: string | null;
  preferenceSnapshotId: string;
  inputHash: string;
  dimensionJson: unknown;
  matchedPreferencesJson: unknown;
  directFocusMatch: boolean;
  usageJson: unknown;
  createdAt: Date;
}): SavedRelevanceAssessment {
  const matchedPreferences = Array.isArray(row.matchedPreferencesJson)
    ? (row.matchedPreferencesJson as SavedRelevanceAssessment["matchedPreferences"])
    : [];
  return {
    id: row.id,
    eventRevisionId: row.eventRevisionId,
    userId: row.userId ?? "",
    preferenceSnapshotId: row.preferenceSnapshotId,
    inputHash: row.inputHash,
    output: {
      relevance:
        row.dimensionJson as SavedRelevanceAssessment["output"]["relevance"],
      matchedPreferences,
    },
    matchedPreferences,
    directFocusMatch: row.directFocusMatch,
    usage: row.usageJson as SavedRelevanceAssessment["usage"],
    createdAt: row.createdAt.toISOString(),
  };
}

function toJson(value: unknown) {
  return value as Prisma.InputJsonValue;
}

function isUniqueViolation(error: unknown) {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === "P2002"
  );
}
