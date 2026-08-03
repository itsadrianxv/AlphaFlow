import { randomUUID } from "node:crypto";
import { Prisma, type PrismaClient } from "@prisma/client";
import type {
  FeishuCircuit,
  FeishuCopy,
  FeishuCopyStatus,
  FeishuDeliveryPayload,
  ResearchDistributionStore,
} from "~/server/application/research-distribution/research-distribution-service";
import { DELIVERY_RETRY_BUDGET_MS } from "~/server/domain/scheduling/policies";
import { LeaseLostError } from "~/server/domain/scheduling/types";

type CopyRow = {
  id: string;
  entryId: string;
  idempotencyKey: string;
  payloadJson: unknown;
  status: string;
  attempts: number;
  firstAttemptAt: Date | null;
  retryDeadline: Date;
  nextAttemptAt: Date | null;
  sentAt: Date | null;
  lastErrorCode: string | null;
  claimToken: string | null;
  claimExpiresAt: Date | null;
  fencingToken: bigint;
};

type CircuitRow = {
  state: string;
  consecutiveFailures: number;
  openCount: number;
  retryAfter: Date | null;
};

const copyColumns = Prisma.sql`
  "id", "entryId", "idempotencyKey", "payloadJson", "status", "attempts",
  "firstAttemptAt", "retryDeadline", "nextAttemptAt", "sentAt", "lastErrorCode"
  , "claimToken", "claimExpiresAt", "fencingToken"
`;

export class PrismaResearchDistributionStore
  implements ResearchDistributionStore
{
  constructor(private readonly db: PrismaClient) {}

  async createCopy(input: {
    entryId: string;
    payload: FeishuDeliveryPayload;
    now: Date;
  }) {
    const affected = await this.db.$executeRaw(Prisma.sql`
      INSERT INTO "ResearchExternalCopy" (
        "id", "entryId", "idempotencyKey", "payloadJson", "retryDeadline",
        "createdAt", "updatedAt"
      ) VALUES (
        ${randomUUID()}, ${input.entryId}, ${input.payload.idempotencyKey},
        CAST(${JSON.stringify(input.payload)} AS JSONB),
        ${new Date(input.now.getTime() + DELIVERY_RETRY_BUDGET_MS)},
        ${input.now}, ${input.now}
      )
      ON CONFLICT ("idempotencyKey") DO NOTHING
    `);
    const copy = await this.getCopyByKey(input.payload.idempotencyKey);
    if (!copy) throw new Error("Feishu 副本持久化失败");
    return { copy, created: affected === 1 };
  }

  async getCopy(id: string) {
    const rows = await this.db.$queryRaw<CopyRow[]>(Prisma.sql`
      SELECT ${copyColumns} FROM "ResearchExternalCopy" WHERE "id" = ${id}
    `);
    return rows[0] ? mapCopy(rows[0]) : null;
  }

  async getCopyByKey(idempotencyKey: string) {
    const rows = await this.db.$queryRaw<CopyRow[]>(Prisma.sql`
      SELECT ${copyColumns} FROM "ResearchExternalCopy"
       WHERE "idempotencyKey" = ${idempotencyKey}
    `);
    return rows[0] ? mapCopy(rows[0]) : null;
  }

  async saveCopy(copy: FeishuCopy) {
    const rows = await this.db.$queryRaw<CopyRow[]>(Prisma.sql`
      UPDATE "ResearchExternalCopy"
         SET "status" = ${copy.status}, "attempts" = ${copy.attempts},
             "firstAttemptAt" = ${asDate(copy.firstAttemptAt)},
             "retryDeadline" = ${new Date(copy.retryDeadline)},
             "nextAttemptAt" = ${asDate(copy.nextAttemptAt)},
             "sentAt" = ${asDate(copy.sentAt)},
             "lastErrorCode" = ${copy.lastErrorCode}, "updatedAt" = CURRENT_TIMESTAMP
       WHERE "id" = ${copy.id}
      RETURNING ${copyColumns}
    `);
    if (!rows[0]) throw new Error("Feishu 副本不存在");
    return mapCopy(rows[0]);
  }

  async claimCopy(id: string, now: Date, leaseMs: number) {
    const claimToken = randomUUID();
    const rows = await this.db.$queryRaw<CopyRow[]>(Prisma.sql`
      UPDATE "ResearchExternalCopy"
         SET "status" = 'SENDING',
             "attempts" = "attempts" + 1,
             "firstAttemptAt" = COALESCE("firstAttemptAt", ${now}),
             "nextAttemptAt" = NULL,
             "claimToken" = ${claimToken},
             "claimExpiresAt" = ${new Date(now.getTime() + leaseMs)},
             "fencingToken" = "fencingToken" + 1,
             "updatedAt" = CURRENT_TIMESTAMP
       WHERE "id" = ${id}
         AND (
           (
             "status" IN ('PENDING', 'RETRY_WAIT', 'DEFERRED_CIRCUIT', 'CONFIG_BLOCKED')
             AND ("nextAttemptAt" IS NULL OR "nextAttemptAt" <= ${now})
           ) OR (
             "status" = 'SENDING'
             AND ("claimExpiresAt" IS NULL OR "claimExpiresAt" <= ${now})
           )
         )
      RETURNING ${copyColumns}
    `);
    return rows[0] ? mapCopy(rows[0]) : null;
  }

  async settleCopy(copy: FeishuCopy) {
    if (!copy.claimToken) throw new LeaseLostError();
    const rows = await this.db.$queryRaw<CopyRow[]>(Prisma.sql`
      UPDATE "ResearchExternalCopy"
         SET "status" = ${copy.status},
             "attempts" = ${copy.attempts},
             "firstAttemptAt" = ${asDate(copy.firstAttemptAt)},
             "retryDeadline" = ${new Date(copy.retryDeadline)},
             "nextAttemptAt" = ${asDate(copy.nextAttemptAt)},
             "sentAt" = ${asDate(copy.sentAt)},
             "lastErrorCode" = ${copy.lastErrorCode},
             "claimToken" = NULL,
             "claimExpiresAt" = NULL,
             "updatedAt" = CURRENT_TIMESTAMP
       WHERE "id" = ${copy.id}
         AND "status" = 'SENDING'
         AND "claimToken" = ${copy.claimToken}
         AND "fencingToken" = ${BigInt(copy.fencingToken)}
      RETURNING ${copyColumns}
    `);
    if (!rows[0]) throw new LeaseLostError();
    return mapCopy(rows[0]);
  }

  async getCircuit() {
    await this.ensureCircuit();
    const rows = await this.db.$queryRaw<CircuitRow[]>(Prisma.sql`
      SELECT "state", "consecutiveFailures", "openCount", "retryAfter"
        FROM "ResearchDeliveryCircuit" WHERE "channel" = 'FEISHU'
    `);
    if (!rows[0]) throw new Error("Feishu 熔断状态不存在");
    return mapCircuit(rows[0]);
  }

  async saveCircuit(circuit: FeishuCircuit) {
    await this.ensureCircuit();
    const rows = await this.db.$queryRaw<CircuitRow[]>(Prisma.sql`
      UPDATE "ResearchDeliveryCircuit"
         SET "state" = ${circuit.state},
             "consecutiveFailures" = ${circuit.consecutiveFailures},
             "openCount" = ${circuit.openCount},
             "retryAfter" = ${asDate(circuit.retryAfter)},
             "updatedAt" = CURRENT_TIMESTAMP
       WHERE "channel" = 'FEISHU'
      RETURNING "state", "consecutiveFailures", "openCount", "retryAfter"
    `);
    if (!rows[0]) throw new Error("Feishu 熔断状态不存在");
    return mapCircuit(rows[0]);
  }

  private async ensureCircuit() {
    await this.db.$executeRaw(Prisma.sql`
      INSERT INTO "ResearchDeliveryCircuit" (
        "id", "channel", "state", "consecutiveFailures", "openCount", "updatedAt"
      ) VALUES ('research-delivery-circuit-feishu', 'FEISHU', 'CLOSED', 0, 0, CURRENT_TIMESTAMP)
      ON CONFLICT ("channel") DO NOTHING
    `);
  }
}

function mapCopy(row: CopyRow): FeishuCopy {
  return {
    id: row.id,
    entryId: row.entryId,
    idempotencyKey: row.idempotencyKey,
    payload: row.payloadJson as FeishuDeliveryPayload,
    status: row.status as FeishuCopyStatus,
    attempts: row.attempts,
    firstAttemptAt: row.firstAttemptAt?.toISOString() ?? null,
    retryDeadline: row.retryDeadline.toISOString(),
    nextAttemptAt: row.nextAttemptAt?.toISOString() ?? null,
    sentAt: row.sentAt?.toISOString() ?? null,
    lastErrorCode: row.lastErrorCode,
    claimToken: row.claimToken,
    claimExpiresAt: row.claimExpiresAt?.toISOString() ?? null,
    fencingToken: row.fencingToken.toString(),
  };
}

function mapCircuit(row: CircuitRow): FeishuCircuit {
  return {
    state: row.state as FeishuCircuit["state"],
    consecutiveFailures: row.consecutiveFailures,
    openCount: row.openCount,
    retryAfter: row.retryAfter?.toISOString() ?? null,
  };
}

function asDate(value: string | null) {
  return value ? new Date(value) : null;
}
