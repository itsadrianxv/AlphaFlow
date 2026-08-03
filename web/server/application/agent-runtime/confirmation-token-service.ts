import {
  createHash,
  randomBytes,
  randomUUID,
  timingSafeEqual,
} from "node:crypto";
import { Prisma, type PrismaClient } from "@prisma/client";

export type ConfirmationBinding = {
  userId: string;
  intentId: string;
  intentType: string;
  objectIdentities: Array<{ type: string; id: string }>;
  payload: unknown;
  channel: string;
  sideEffectKind: string;
};

export type ConfirmationConsumeResult = {
  tokenId: string;
  consumedAt: string;
  resultHash: string;
  replayed: boolean;
};

export class AgentConfirmationTokenService {
  constructor(
    private readonly db: PrismaClient,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  async issue(binding: ConfirmationBinding, options: { ttlMs?: number } = {}) {
    validateBinding(binding);
    const nonce = randomBytes(32).toString("base64url");
    const secret = randomBytes(32).toString("base64url");
    const token = `${nonce}.${secret}`;
    const now = this.clock();
    const expiresAt = new Date(now.getTime() + (options.ttlMs ?? 10 * 60_000));
    const created = await this.db.agentConfirmationToken.create({
      data: {
        id: randomUUID(),
        tokenHash: hashText(token),
        userId: binding.userId,
        intentId: binding.intentId,
        intentType: binding.intentType,
        objectIdentityHash: hashJson(
          normalizeObjects(binding.objectIdentities),
        ),
        canonicalPayloadHash: hashJson(binding.payload),
        channel: binding.channel,
        sideEffectKind: binding.sideEffectKind,
        nonceHash: hashText(nonce),
        expiresAt,
        createdAt: now,
      },
    });
    return { token, tokenId: created.id, expiresAt: expiresAt.toISOString() };
  }

  async executeConfirmed<T>(input: {
    token: string;
    binding: ConfirmationBinding;
    execute: () => Promise<T>;
  }): Promise<{ confirmation: ConfirmationConsumeResult; result: T }> {
    validateBinding(input.binding);
    const [nonce] = input.token.split(".");
    if (!nonce) throw new Error("确认 token 格式无效");
    const tokenHash = hashText(input.token);
    const nonceHash = hashText(nonce);
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        return await this.db.$transaction(
          async (tx) => {
            const rows = await tx.$queryRaw<
              Array<{
                id: string;
                tokenHash: string;
                userId: string;
                intentId: string;
                intentType: string;
                objectIdentityHash: string;
                canonicalPayloadHash: string;
                channel: string;
                sideEffectKind: string;
                nonceHash: string;
                expiresAt: Date;
                consumedAt: Date | null;
                consumedResultHash: string | null;
              }>
            >(Prisma.sql`
          SELECT "id", "tokenHash", "userId", "intentId", "intentType",
                 "objectIdentityHash", "canonicalPayloadHash", "channel",
                 "sideEffectKind", "nonceHash", "expiresAt", "consumedAt",
                 "consumedResultHash"
            FROM "AgentConfirmationToken"
           WHERE "tokenHash" = ${tokenHash}
           FOR UPDATE
        `);
            const row = rows[0];
            if (
              !row ||
              !secureEqual(row.tokenHash, tokenHash) ||
              !secureEqual(row.nonceHash, nonceHash)
            ) {
              throw new Error("确认 token 不存在或校验失败");
            }
            assertBinding(row, input.binding);
            if (row.expiresAt <= this.clock())
              throw new Error("确认 token 已过期");
            if (row.consumedAt) {
              throw new Error("确认 token 已被消费，必须重新确认");
            }
            const result = await input.execute();
            const resultHash = hashJson(result);
            const consumedAt = this.clock();
            await tx.agentConfirmationToken.update({
              where: { id: row.id },
              data: {
                consumedAt,
                consumedResultHash: resultHash,
              },
            });
            return {
              confirmation: {
                tokenId: row.id,
                consumedAt: consumedAt.toISOString(),
                resultHash,
                replayed: false,
              },
              result,
            };
          },
          { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
        );
      } catch (error) {
        if (!isSerializationFailure(error) || attempt === 2) throw error;
      }
    }
    throw new Error("确认 token 并发消费重试耗尽");
  }
}

function assertBinding(
  row: {
    userId: string;
    intentId: string;
    intentType: string;
    objectIdentityHash: string;
    canonicalPayloadHash: string;
    channel: string;
    sideEffectKind: string;
  },
  binding: ConfirmationBinding,
) {
  const expected = {
    userId: binding.userId,
    intentId: binding.intentId,
    intentType: binding.intentType,
    objectIdentityHash: hashJson(normalizeObjects(binding.objectIdentities)),
    canonicalPayloadHash: hashJson(binding.payload),
    channel: binding.channel,
    sideEffectKind: binding.sideEffectKind,
  };
  for (const [field, value] of Object.entries(expected)) {
    if (row[field as keyof typeof row] !== value) {
      throw new Error(`确认 token 绑定字段已变化: ${field}`);
    }
  }
}

function validateBinding(binding: ConfirmationBinding) {
  if (
    !binding.userId.trim() ||
    !binding.intentId.trim() ||
    !binding.intentType.trim()
  ) {
    throw new Error("确认 token 缺少用户或意图身份");
  }
  if (!binding.channel.trim() || !binding.sideEffectKind.trim()) {
    throw new Error("确认 token 缺少渠道或副作用类型");
  }
  if (binding.objectIdentities.length === 0) {
    throw new Error("确认 token 至少绑定一个对象");
  }
}

function normalizeObjects(objects: ConfirmationBinding["objectIdentities"]) {
  return [...objects]
    .map((item) => ({ type: item.type.trim(), id: item.id.trim() }))
    .sort((left, right) =>
      `${left.type}:${left.id}`.localeCompare(`${right.type}:${right.id}`),
    );
}

function hashText(value: string) {
  return `sha256:${createHash("sha256").update(value, "utf8").digest("hex")}`;
}

function hashJson(value: unknown) {
  return hashText(canonicalJson(value));
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => `${JSON.stringify(key)}:${canonicalJson(child)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function secureEqual(left: string, right: string) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return (
    leftBuffer.length === rightBuffer.length &&
    timingSafeEqual(leftBuffer, rightBuffer)
  );
}

function isSerializationFailure(error: unknown) {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    (error.code === "P2034" ||
      (error.code === "P2010" && error.meta?.code === "40001"))
  );
}
