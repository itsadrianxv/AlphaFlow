import "server-only";

import { createHash } from "node:crypto";
import Redis from "ioredis";

import { env } from "~/env";

const LOGIN_FAILURE_LIMIT = 10;
const LOGIN_WINDOW_SECONDS = 15 * 60;
const REGISTRATION_LIMIT = 5;
const REGISTRATION_WINDOW_SECONDS = 60 * 60;

type RedisCounter = Pick<Redis, "del" | "eval" | "get">;

let redis: Redis | null = null;
let connecting: Promise<void> | null = null;

function hashKeyPart(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function getRedis(): Redis {
  redis ??= new Redis(env.REDIS_URL, {
    enableOfflineQueue: false,
    lazyConnect: true,
    maxRetriesPerRequest: 1,
  });
  return redis;
}

async function ensureConnected(client: Redis): Promise<void> {
  if (client.status === "ready") return;

  if (!connecting) {
    connecting = client
      .connect()
      .then(() => undefined)
      .finally(() => {
        connecting = null;
      });
  }

  await connecting;
}

async function withRedis<T>(operation: (client: RedisCounter) => Promise<T>) {
  const client = getRedis();
  await ensureConnected(client);
  return operation(client);
}

async function incrementWithExpiry(
  client: RedisCounter,
  key: string,
  windowSeconds: number,
): Promise<number> {
  const value = await client.eval(
    "local count = redis.call('INCR', KEYS[1]); if count == 1 then redis.call('EXPIRE', KEYS[1], ARGV[1]); end; return count",
    1,
    key,
    windowSeconds,
  );
  return Number(value);
}

function loginIdentifierKey(identifier: string) {
  return `auth:login:identifier:${hashKeyPart(identifier)}`;
}

function loginIpKey(ip: string) {
  return `auth:login:ip:${hashKeyPart(ip)}`;
}

export async function assertLoginAllowed(
  identifier: string,
  ip: string,
): Promise<void> {
  await withRedis(async (client) => {
    const [identifierFailures, ipFailures] = await Promise.all([
      client.get(loginIdentifierKey(identifier)),
      client.get(loginIpKey(ip)),
    ]);

    if (
      Number(identifierFailures ?? 0) >= LOGIN_FAILURE_LIMIT ||
      Number(ipFailures ?? 0) >= LOGIN_FAILURE_LIMIT
    ) {
      throw new AuthRateLimitError();
    }
  });
}

export async function recordLoginFailure(
  identifier: string,
  ip: string,
): Promise<void> {
  await withRedis(async (client) => {
    await Promise.all([
      incrementWithExpiry(
        client,
        loginIdentifierKey(identifier),
        LOGIN_WINDOW_SECONDS,
      ),
      incrementWithExpiry(client, loginIpKey(ip), LOGIN_WINDOW_SECONDS),
    ]);
  });
}

export async function clearLoginFailures(identifier: string): Promise<void> {
  await withRedis((client) =>
    client.del(loginIdentifierKey(identifier)).then(() => undefined),
  );
}

export async function consumeRegistrationAttempt(ip: string): Promise<void> {
  await withRedis(async (client) => {
    const key = `auth:register:ip:${hashKeyPart(ip)}`;
    const count = await incrementWithExpiry(
      client,
      key,
      REGISTRATION_WINDOW_SECONDS,
    );
    if (count > REGISTRATION_LIMIT) throw new AuthRateLimitError();
  });
}

export class AuthRateLimitError extends Error {
  constructor() {
    super("AUTH_RATE_LIMITED");
    this.name = "AuthRateLimitError";
  }
}
