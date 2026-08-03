import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import {
  CANDIDATE_POOL_KEY,
  CandidateProductionWorker,
} from "../../server/application/research-production/candidate-production";
import { PostgresResearchScheduler } from "../../server/application/scheduling/postgres-research-scheduler";
import { DeepSeekCandidateAdjudicationAdapter } from "../../server/infrastructure/research-production/deepseek-candidate-adjudication-adapter";

const db = new PrismaClient();
const workerId =
  process.env.RESEARCH_CANDIDATE_WORKER_ID ??
  `research-candidate-${process.pid}-${randomUUID()}`;
const pollMs = Number(process.env.RESEARCH_CANDIDATE_WORKER_POLL_MS ?? 5_000);

async function main() {
  const pool = await db.researchResourcePool.findUnique({
    where: { poolKey: CANDIDATE_POOL_KEY },
  });
  if (!pool) throw new Error(`候选生产资源池未迁移：${CANDIDATE_POOL_KEY}`);
  const scheduler = new PostgresResearchScheduler(db);
  const worker = new CandidateProductionWorker(
    db,
    scheduler,
    new DeepSeekCandidateAdjudicationAdapter(),
  );
  console.info(`[research-candidate-worker] worker=${workerId} pool=${pool.id}`);
  while (true) {
    try {
      const result = await worker.runOnce(pool.id, workerId);
      if (!result) {
        await new Promise((resolve) => setTimeout(resolve, pollMs));
      }
    } catch (error) {
      console.error("[research-candidate-worker] task failed", error);
    }
  }
}

void main().catch((error) => {
  console.error("[research-candidate-worker] fatal", error);
  process.exitCode = 1;
});
