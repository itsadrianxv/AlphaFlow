import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import {
  FEISHU_POOL_KEY,
  FeishuDueCopyWorker,
} from "../../server/application/research-distribution/feishu-due-copy-worker";
import { PostgresResearchScheduler } from "../../server/application/scheduling/postgres-research-scheduler";
import { FeishuWebhookDeliveryAdapter } from "../../server/infrastructure/research-distribution/feishu-webhook-delivery-adapter";
import { resolveFeishuWebhook } from "../../server/domain/scheduled-task/delivery-targets";

const db = new PrismaClient();
const workerId =
  process.env.RESEARCH_FEISHU_WORKER_ID ??
  `research-feishu-${process.pid}-${randomUUID()}`;
const pollMs = Number(process.env.RESEARCH_FEISHU_WORKER_POLL_MS ?? 5_000);
const targetRef = process.env.RESEARCH_FEISHU_TARGET_REF ?? "RESEARCH_DEFAULT";

async function main() {
  resolveFeishuWebhook(targetRef);
  const pool = await db.researchResourcePool.findUnique({
    where: { poolKey: FEISHU_POOL_KEY },
  });
  if (!pool) throw new Error(`Feishu 资源池未迁移：${FEISHU_POOL_KEY}`);
  const scheduler = new PostgresResearchScheduler(db);
  const worker = new FeishuDueCopyWorker(db, scheduler, {
    feishu: new FeishuWebhookDeliveryAdapter(targetRef),
  });
  console.info(`[research-feishu-worker] worker=${workerId} pool=${pool.id}`);
  while (true) {
    try {
      const result = await worker.runOnce(pool.id, workerId);
      if (!result) await new Promise((resolve) => setTimeout(resolve, pollMs));
    } catch (error) {
      console.error("[research-feishu-worker] task failed", error);
    }
  }
}

void main().catch((error) => {
  console.error("[research-feishu-worker] fatal", error);
  process.exitCode = 1;
});
