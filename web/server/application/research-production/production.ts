import { createHash } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import { researchProductionInputSchema } from "~/contracts/research-production";
import type { ResearchAssessmentLlmAdapter } from "~/server/application/research-assessment/research-assessment-service";
import { ResearchAssessmentService } from "~/server/application/research-assessment/research-assessment-service";
import {
  type FeishuDeliveryPort,
  ResearchDistributionService,
} from "~/server/application/research-distribution/research-distribution-service";
import { ResearchInboxService } from "~/server/application/research-inbox/research-inbox-service";
import { ResearchPreferenceService } from "~/server/application/research-preference/research-preference-service";
import { ProductionRuntimeObserver } from "~/server/application/runtime-observability/production-runtime-observer";
import { DeepSeekResearchAssessmentAdapter } from "~/server/infrastructure/research-assessment/deepseek-research-assessment-adapter";
import { PrismaResearchAssessmentRepository } from "~/server/infrastructure/research-assessment/prisma-research-assessment-repository";
import { PrismaResearchDistributionStore } from "~/server/infrastructure/research-distribution/prisma-research-distribution-store";
import { PrismaResearchInboxRepository } from "~/server/infrastructure/research-inbox/prisma-research-inbox-repository";
import { PrismaResearchPreferenceRepository } from "~/server/infrastructure/research-preference/prisma-research-preference-repository";
import { PrismaResearchProductionRepository } from "~/server/infrastructure/research-production/prisma-research-production-repository";
import {
  ResearchEventCorrectionService,
  researchEventRevisionCommandSchema,
} from "./research-event-correction";
import { ResearchProductionOrchestrator } from "./research-production-orchestrator";

export type ResearchProductionDependencies = {
  assessmentLlm?: ResearchAssessmentLlmAdapter;
  clock?: () => Date;
  feishu?: FeishuDeliveryPort;
};

export function createProductionResearchInboxService(db: PrismaClient) {
  return new ResearchInboxService(new PrismaResearchInboxRepository(db));
}

export function createResearchProductionOrchestrator(
  db: PrismaClient,
  dependencies: ResearchProductionDependencies = {},
) {
  const clock = dependencies.clock ?? (() => new Date());
  const inbox = new ResearchInboxService(
    new PrismaResearchInboxRepository(db),
    { clock },
  );
  const runtimeObserver = new ProductionRuntimeObserver(db);
  return new ResearchProductionOrchestrator(
    new PrismaResearchProductionRepository(db),
    new ResearchAssessmentService(
      dependencies.assessmentLlm ?? new DeepSeekResearchAssessmentAdapter(),
      new PrismaResearchAssessmentRepository(db),
    ),
    new ResearchPreferenceService(new PrismaResearchPreferenceRepository(db), {
      clock,
    }),
    new ResearchDistributionService(
      inbox,
      new PrismaResearchDistributionStore(db),
      {
        clock,
        inboxLink: (entryId) => `/research-inbox?entry=${entryId}`,
      },
    ),
    {
      async record(input) {
        const observedAt = clock();
        await runtimeObserver.record({
          idempotencyKey: `research-production:${input.idempotencyKey}:${input.phase.toLowerCase()}`,
          stage: input.stage,
          resourcePool: "research-production",
          startedAt: observedAt,
          readyAt: observedAt,
          success: input.phase !== "FAILED",
          errorClass: input.errorClass,
          context: {
            inputContractVersion: input.inputContractVersion,
            inputHash: input.inputHash,
            resultContractVersion: `${input.stage}.v1`,
            authoritativeObjectIds: input.authoritativeObjectIds,
            phase: input.phase,
          },
        });
      },
    },
  );
}

export async function runResearchProduction(
  db: PrismaClient,
  input: unknown,
  dependencies: ResearchProductionDependencies = {},
) {
  const parsed = researchProductionInputSchema.parse(input);
  return createResearchProductionOrchestrator(db, dependencies).process(parsed);
}

export async function runResearchEventRevisionCommand(
  db: PrismaClient,
  raw: unknown,
  dependencies: ResearchProductionDependencies = {},
) {
  const input = researchEventRevisionCommandSchema.parse(raw);
  const revisionRow = await new ResearchEventCorrectionService(db).execute(
    input,
  );
  const repository = new PrismaResearchProductionRepository(db);
  const revision = await repository.loadRevision(revisionRow.id);
  return createResearchProductionOrchestrator(db, dependencies).publishRevision(
    {
      idempotencyKey: `research-event-revision:${input.commandId}`,
      contractVersion: "research-event-revision-command.v1",
      inputHash: `sha256:${createHash("sha256")
        .update(JSON.stringify(input), "utf8")
        .digest("hex")}`,
      revision,
    },
  );
}
