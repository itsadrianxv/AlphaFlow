import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { recoverCandidateSeedOutboxFiles } from "../src/pi-adapter";

const tempRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempRoots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })),
  );
});

async function createOutbox() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "alphaflow-candidate-outbox-"));
  tempRoots.push(root);
  return root;
}

const validInternalSeed = {
  kind: "immediate_research_candidate_seed",
  contractVersion: "research-candidate-seed.v1",
  seedKey: "candidate-seed:test",
  source: "post_response_async",
  idempotencyKey: "candidate-seed:idempotency",
  triggerSource: "IMMEDIATE_RESEARCH",
  runId: "run-1",
  scope: "IMMEDIATE_RESEARCH",
  subject: { type: "RESEARCH_RUN", key: "run-1" },
  question: "研究公开材料",
  outputMode: "research_only",
  sourceReferences: [
    {
      sourceType: "PUBLIC_WEB",
      sourceKey: { preview: "https://example.com/a" },
      summary: { preview: "公开材料摘要" },
    },
  ],
  writesSynchronously: false,
  targetStores: ["candidate_seed_queue"],
};

describe("candidate seed outbox", () => {
  it("隔离单个坏文件并继续恢复其他文件", async () => {
    const root = await createOutbox();
    await fs.writeFile(path.join(root, "01-bad.json"), "{bad", "utf8");
    await fs.writeFile(
      path.join(root, "02-good.json"),
      JSON.stringify(validInternalSeed),
      "utf8",
    );
    const delivered: unknown[] = [];
    const errors: string[] = [];

    await expect(
      recoverCandidateSeedOutboxFiles({
        root,
        enqueue: async (payload) => {
          delivered.push(payload);
        },
        onError: (file) => errors.push(file),
      }),
    ).resolves.toBeUndefined();

    expect(delivered).toHaveLength(1);
    expect((delivered[0] as { sourceReferences: Array<{ sourceKey: string }> })
      .sourceReferences[0]?.sourceKey).toBe("https://example.com/a");
    expect(errors).toEqual(["01-bad.json"]);
    await expect(fs.access(path.join(root, "01-bad.json"))).resolves.toBeUndefined();
    await expect(fs.access(path.join(root, "02-good.json"))).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it("网络暂时失败时保留文件但不向调用方抛出", async () => {
    const root = await createOutbox();
    const filePath = path.join(root, "01-pending.json");
    await fs.writeFile(filePath, JSON.stringify(validInternalSeed), "utf8");

    await expect(
      recoverCandidateSeedOutboxFiles({
        root,
        enqueue: async () => {
          throw new Error("web unavailable");
        },
      }),
    ).resolves.toBeUndefined();

    await expect(fs.access(filePath)).resolves.toBeUndefined();
  });
});
