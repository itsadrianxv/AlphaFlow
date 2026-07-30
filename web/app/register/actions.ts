"use server";

import { Prisma } from "@prisma/client";
import { headers } from "next/headers";
import { AuthError } from "next-auth";
import { signIn } from "~/server/auth";
import {
  isPasswordValid,
  normalizeLoginIdentifier,
} from "~/server/auth/credential-policy";
import { hashPassword } from "~/server/auth/password";
import {
  AuthRateLimitError,
  consumeRegistrationAttempt,
} from "~/server/auth/rate-limit";
import { resolveAuthRedirect } from "~/server/auth/redirect-utils";
import { resolveClientIp } from "~/server/auth/request-ip";
import { db } from "~/server/db";

export type RegisterActionState = { error: string | null };

function isUniqueConstraintError(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError ||
    (typeof error === "object" && error !== null && "code" in error)
    ? (error as { code?: string }).code === "P2002"
    : false;
}

export async function registerWithCredentials(
  _previousState: RegisterActionState,
  formData: FormData,
): Promise<RegisterActionState> {
  const identifierInput = formData.get("identifier");
  const password = formData.get("password");
  const confirmPassword = formData.get("confirmPassword");
  const redirectTo = resolveAuthRedirect(formData.get("redirectTo"));

  if (typeof identifierInput !== "string") {
    return { error: "请输入有效的中国大陆手机号或邮箱。" };
  }
  const identifier = normalizeLoginIdentifier(identifierInput);
  if (!identifier) {
    return { error: "请输入有效的中国大陆手机号或邮箱。" };
  }
  if (typeof password !== "string" || !isPasswordValid(password)) {
    return { error: "密码不符合安全要求。" };
  }
  if (password !== confirmPassword) {
    return { error: "两次输入的密码不一致。" };
  }

  try {
    const requestHeaders = await headers();
    await consumeRegistrationAttempt(resolveClientIp(requestHeaders));
    const passwordHash = await hashPassword(password);

    await db.user.create({
      data: {
        loginIdentifier: identifier.value,
        loginIdentifierType: identifier.type,
        passwordHash,
        passwordChangedAt: new Date(),
        name: identifier.value,
      },
    });

    await signIn("local-credentials", {
      identifier: identifier.value,
      password,
      redirectTo,
    });
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      return { error: "该账号已存在。" };
    }
    if (error instanceof AuthRateLimitError) {
      return { error: "请求过于频繁，请稍后重试。" };
    }
    if (error instanceof AuthError) {
      return { error: "注册暂时不可用，请稍后重试。" };
    }
    throw error;
  }

  return { error: null };
}
