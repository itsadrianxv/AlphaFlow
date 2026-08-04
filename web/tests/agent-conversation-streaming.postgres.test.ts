import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { afterAll, afterEach, describe, expect, it } from "vitest";
import { PrismaAgentConversationRepository } from "~/server/infrastructure/agent-runtime/prisma-agent-conversation-repository";

const databaseUrl = process.env.RESEARCH_POSTGRES_CONTRACT_URL;
const describePostgres = databaseUrl ? describe : describe.skip;

describePostgres("Agent 对话流式持久化 PostgreSQL 回归", () => {
  const db = new PrismaClient({
    datasources: {
      db: {
        url: databaseUrl ?? "postgresql://unused:unused@127.0.0.1:1/unused",
      },
    },
  });
  const repository = new PrismaAgentConversationRepository(db);
  const userIds: string[] = [];

  afterEach(async () => {
    await db.user.deleteMany({ where: { id: { in: userIds.splice(0) } } });
  });

  afterAll(async () => {
    await db.$disconnect();
  });

  it("并发批次追加不会互相覆盖", async () => {
    const userId = `agent-stream-${randomUUID()}`;
    await db.user.create({ data: { id: userId } });
    userIds.push(userId);
    const conversation = await db.agentConversation.create({
      data: {
        userId,
        title: "并发流式追加",
        piSessionId: `pi-${randomUUID()}`,
      },
    });
    const message = await db.agentConversationMessage.create({
      data: {
        conversationId: conversation.id,
        role: "ASSISTANT",
        content: "",
        status: "PENDING",
        sequence: 1,
      },
    });
    const chunks = Array.from(
      { length: 20 },
      (_, index) => `[chunk-${index.toString().padStart(2, "0")}]`,
    );

    await Promise.all(
      chunks.map((chunk) =>
        repository.appendAssistantDeltas(message.id, [chunk]),
      ),
    );

    const persisted = await db.agentConversationMessage.findUniqueOrThrow({
      where: { id: message.id },
    });
    expect(persisted.status).toBe("STREAMING");
    expect(persisted.content).toHaveLength(chunks.join("").length);
    for (const chunk of chunks) {
      expect(persisted.content.split(chunk)).toHaveLength(2);
    }
  });
});
