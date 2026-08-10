import { promises as fs } from "node:fs";
import path from "node:path";
import {
  toResearchCandidateSeedPayload,
  type ResearchCandidateSeedPayload,
} from "./research-only-policy";

export async function recoverCandidateSeedOutboxFiles(params: {
  root: string;
  enqueue: (payload: ResearchCandidateSeedPayload) => Promise<unknown>;
  onError?: (file: string, error: unknown) => void;
}) {
  const files = await fs
    .readdir(params.root)
    .catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return [];
      throw error;
    });

  for (const file of files.filter((item) => item.endsWith(".json")).sort()) {
    const filePath = path.join(params.root, file);
    try {
      const seed = JSON.parse(
        await fs.readFile(filePath, { encoding: "utf8" }),
      ) as Record<string, unknown>;
      await params.enqueue(toResearchCandidateSeedPayload(seed));
      await fs.unlink(filePath);
    } catch (error) {
      params.onError?.(file, error);
    }
  }
}

export class CandidateSeedOutbox {
  constructor(
    private readonly root: string,
    private readonly deliver: (
      payload: ResearchCandidateSeedPayload,
    ) => Promise<unknown>,
  ) {}

  async enqueue(seed: Record<string, unknown>) {
    const seedKey = String(seed.seedKey ?? "");
    if (!seedKey) {
      return { accepted: false, pendingRecovery: false };
    }

    const filePath = path.join(
      this.root,
      `${Buffer.from(seedKey, "utf8").toString("base64url")}.json`,
    );
    try {
      await fs.mkdir(this.root, { recursive: true });
      await fs.writeFile(filePath, JSON.stringify(seed), { encoding: "utf8" });
      void this.deliverFile(filePath, seed);
      return { accepted: true, pendingRecovery: true };
    } catch {
      return { accepted: false, pendingRecovery: false };
    }
  }

  private async deliverFile(filePath: string, seed: Record<string, unknown>) {
    try {
      await this.deliver(toResearchCandidateSeedPayload(seed));
      await fs.unlink(filePath).catch((error: NodeJS.ErrnoException) => {
        if (error.code !== "ENOENT") throw error;
      });
    } catch {
      // 文件保留在 outbox 中，下一次恢复流程会重试。
    }
  }

  async recover(onError?: (file: string, error: unknown) => void) {
    await recoverCandidateSeedOutboxFiles({
      root: this.root,
      enqueue: this.deliver,
      onError,
    });
  }
}
