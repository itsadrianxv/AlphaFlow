import "server-only";

import { timingSafeEqual } from "node:crypto";

import { env } from "~/env";
import { normalizeLoginIdentifier } from "~/server/auth/credential-policy";
import { verifyDummyPassword, verifyPassword } from "~/server/auth/password";
import {
  assertLoginAllowed,
  clearLoginFailures,
  recordLoginFailure,
} from "~/server/auth/rate-limit";
import { resolveClientIp } from "~/server/auth/request-ip";
import { db } from "~/server/db";

const localCredentialsUsername = env.AUTH_CREDENTIALS_USERNAME ?? "admin";
const localCredentialsPassword = env.AUTH_CREDENTIALS_PASSWORD ?? "admin123456";
const localCredentialsEmail = "local-user@alphaflow.local";

function constantTimeEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);

  if (leftBuffer.length !== rightBuffer.length) return false;
  return timingSafeEqual(leftBuffer, rightBuffer);
}

export async function authenticateCredentials(
  credentials: Partial<Record<"identifier" | "password", unknown>> | undefined,
  requestHeaders: Headers,
) {
  const identifierInput = credentials?.identifier;
  const passwordInput = credentials?.password;

  if (
    typeof identifierInput !== "string" ||
    typeof passwordInput !== "string" ||
    identifierInput.trim().length === 0 ||
    passwordInput.length === 0
  ) {
    return null;
  }

  const normalized = normalizeLoginIdentifier(identifierInput);
  const rateLimitIdentifier =
    normalized?.value ?? identifierInput.trim().toLowerCase();
  const ip = resolveClientIp(requestHeaders);

  await assertLoginAllowed(rateLimitIdentifier, ip);

  if (
    constantTimeEqual(identifierInput.trim(), localCredentialsUsername) &&
    constantTimeEqual(passwordInput, localCredentialsPassword)
  ) {
    const user = await db.user.upsert({
      where: { email: localCredentialsEmail },
      create: {
        email: localCredentialsEmail,
        name: localCredentialsUsername,
      },
      update: {
        name: localCredentialsUsername,
        status: "ACTIVE",
      },
    });
    await clearLoginFailures(rateLimitIdentifier);

    return {
      id: user.id,
      name: user.name,
      email: user.email,
      sessionVersion: user.sessionVersion,
    };
  }

  if (!normalized) {
    await verifyDummyPassword(passwordInput);
    await recordLoginFailure(rateLimitIdentifier, ip);
    return null;
  }

  const user = await db.user.findUnique({
    where: { loginIdentifier: normalized.value },
    select: {
      id: true,
      name: true,
      email: true,
      passwordHash: true,
      sessionVersion: true,
      status: true,
    },
  });

  const passwordMatches = user?.passwordHash
    ? await verifyPassword(user.passwordHash, passwordInput)
    : await verifyDummyPassword(passwordInput);

  if (!user || !passwordMatches || user.status !== "ACTIVE") {
    await recordLoginFailure(rateLimitIdentifier, ip);
    return null;
  }

  await clearLoginFailures(rateLimitIdentifier);
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    sessionVersion: user.sessionVersion,
  };
}
