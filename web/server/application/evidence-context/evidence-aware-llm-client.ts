import { randomUUID } from "node:crypto";
import type { DeepSeekRequestOptions } from "~/server/infrastructure/intelligence/deepseek-client";
import { DeepSeekClient } from "~/server/infrastructure/intelligence/deepseek-client";
import type { PrismaEvidenceContextRepository } from "~/server/infrastructure/evidence-context/prisma-evidence-context-repository";
import { ResearchContextBuilder, type PromptMessage } from "./research-context-builder";

export type EvidenceAwareRequest = {
  userId: string;
  workflowRunId?: string;
  purpose: string;
  policy: "evidence_required" | "transformation";
  messages: PromptMessage[];
  evidenceItemIds: string[];
  fallbackText: string;
  options?: DeepSeekRequestOptions;
};

export class EvidenceAwareLlmClient {
  private readonly builder: ResearchContextBuilder;

  constructor(
    private readonly client: DeepSeekClient,
    private readonly repository: PrismaEvidenceContextRepository,
  ) {
    this.builder = new ResearchContextBuilder(repository);
  }

  async complete(request: EvidenceAwareRequest) {
    const built = await this.builder.build(request);
    const snapshot = await this.repository.createSnapshot({
      userId: request.userId,
      workflowRunId: request.workflowRunId,
      requestGroupId: built.requestGroupId || randomUUID(),
      requestSequence: 1,
      attempt: 1,
      purpose: request.purpose,
      policy: request.policy,
      model: request.options?.model,
      requestOptions: request.options as Record<string, unknown> | undefined,
      messages: built.messages,
      quality: built.quality,
      items: built.items,
    });
    await this.repository.markSnapshot({ snapshotId: snapshot.id, status: "sent" });
    try {
      const output = await this.client.complete(
        built.messages,
        request.fallbackText,
        request.options,
      );
      await this.repository.markSnapshot({ snapshotId: snapshot.id, status: "succeeded" });
      const claims = request.policy === "evidence_required"
        ? await this.repository.createClaims({
            snapshotId: snapshot.id,
            claims: [
              {
                artifactKey: request.purpose,
                ordinal: 0,
                text: output,
                citations: built.items.map((item) => ({
                  evidenceItemId: item.evidenceItemId,
                  relation: "support",
                })),
              },
            ],
          })
        : [];
      return { output, snapshotId: snapshot.id, quality: built.quality, claims };
    } catch (error) {
      await this.repository.markSnapshot({
        snapshotId: snapshot.id,
        status: "failed",
        errorMessage: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }
}
