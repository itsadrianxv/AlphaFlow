import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { BRIEFING_POOL_KEY, BriefingProductionWorker } from "../../server/application/research-distribution/briefing-production-worker";
import { PostgresResearchScheduler } from "../../server/application/scheduling/postgres-research-scheduler";

const db = new PrismaClient();
const workerId = process.env.RESEARCH_BRIEFING_WORKER_ID ?? `research-briefing-${process.pid}-${randomUUID()}`;
const pollMs = Number(process.env.RESEARCH_BRIEFING_WORKER_POLL_MS ?? 5_000);

async function main() {
  const pool = await db.researchResourcePool.findUnique({ where: { poolKey: BRIEFING_POOL_KEY } });
  if (!pool) throw new Error(`简报资源池未迁移：${BRIEFING_POOL_KEY}`);
  const worker = new BriefingProductionWorker(db, new PostgresResearchScheduler(db));
  console.info(`[research-briefing-worker] worker=${workerId} pool=${pool.id}`);
  while (true) {
    try {
      const result = await worker.runOnce(pool.id, workerId);
      if (!result) await new Promise((resolve) => setTimeout(resolve, pollMs));
    } catch (error) {
      console.error("[research-briefing-worker] task failed", error);
    }
  }
}
void main().catch((error) => { console.error("[research-briefing-worker] fatal", error); process.exitCode = 1; });
