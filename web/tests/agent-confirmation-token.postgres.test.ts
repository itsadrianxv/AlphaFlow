import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { afterAll, describe, expect, it } from "vitest";
import { AgentConfirmationTokenService } from "~/server/application/agent-runtime/confirmation-token-service";

const databaseUrl = process.env.RESEARCH_POSTGRES_CONTRACT_URL;
const describePostgres = databaseUrl ? describe : describe.skip;

function key(prefix: string) {
  return `${prefix}-${randomUUID()}`;
}

describePostgres("Controller confirmation token PostgreSQL 契约", () => {
  const db = new PrismaClient({
    datasources: {
      db: {
        url: databaseUrl ?? "postgresql://unused:unused@127.0.0.1:1/unused",
      },
    },
  });

  afterAll(async () => db.$disconnect());

  it("绑定规范化 payload、对象、渠道和副作用，并发消费只结算一次", async () => {
    const userId = key("confirmation-user");
    await db.user.create({ data: { id: userId } });
    const now = new Date("2026-08-03T04:00:00.000Z");
    const service = new AgentConfirmationTokenService(db, () => now);
    const binding = {
      userId,
      intentId: key("intent"),
      intentType: "UPDATE_RESEARCH_FOCUS",
      objectIdentities: [{ type: "COMPANY", id: "300750.SZ" }],
      payload: { level: "FOCUS", enabled: true },
      channel: "IN_APP",
      sideEffectKind: "PREFERENCE_CHANGE",
    };
    const issued = await service.issue(binding);

    let executions = 0;
    const results = await Promise.allSettled([
      service.executeConfirmed({
        token: issued.token,
        binding,
        execute: async () => {
          executions += 1;
          return { commandId: "command-1" };
        },
      }),
      service.executeConfirmed({
        token: issued.token,
        binding,
        execute: async () => {
          executions += 1;
          return { commandId: "command-1" };
        },
      }),
    ]);

    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
    expect(executions).toBe(1);
    const fulfilled = results.find((result) => result.status === "fulfilled");
    if (!fulfilled || fulfilled.status !== "fulfilled") {
      throw new Error("确认执行未成功");
    }
    const first = fulfilled.value;
    const persisted = await db.agentConfirmationToken.findUniqueOrThrow({
      where: { id: issued.tokenId },
    });
    expect(persisted.consumedResultHash).toBe(first.confirmation.resultHash);
    await expect(
      service.executeConfirmed({
        token: issued.token,
        binding: { ...binding, payload: { level: "REGULAR", enabled: true } },
        execute: async () => ({ commandId: "command-1" }),
      }),
    ).rejects.toThrow(/canonicalPayloadHash/);
    await expect(
      service.executeConfirmed({
        token: issued.token,
        binding: { ...binding, userId: key("other-user") },
        execute: async () => ({ commandId: "command-1" }),
      }),
    ).rejects.toThrow(/userId/);
  });

  it("拒绝过期 token", async () => {
    const userId = key("expired-user");
    await db.user.create({ data: { id: userId } });
    let now = new Date("2026-08-03T04:00:00.000Z");
    const service = new AgentConfirmationTokenService(db, () => now);
    const binding = {
      userId,
      intentId: key("intent"),
      intentType: "ARCHIVE_INBOX_ITEM",
      objectIdentities: [{ type: "INBOX_ENTRY", id: key("entry") }],
      payload: { state: "ARCHIVED" },
      channel: "IN_APP",
      sideEffectKind: "AUTHORITATIVE_WRITE",
    };
    const issued = await service.issue(binding, { ttlMs: 1_000 });
    now = new Date("2026-08-03T04:00:02.000Z");
    await expect(
      service.executeConfirmed({
        token: issued.token,
        binding,
        execute: async () => ({ ok: true }),
      }),
    ).rejects.toThrow("已过期");
  });
});
