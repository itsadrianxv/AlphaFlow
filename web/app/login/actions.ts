"use server";

import { AuthError } from "next-auth";

import { signIn } from "~/server/auth";
import { resolveAuthRedirect } from "~/server/auth/redirect-utils";

export type LoginActionState = {
  error: string | null;
};

export async function signInWithCredentials(
  _previousState: LoginActionState,
  formData: FormData,
): Promise<LoginActionState> {
  const redirectTo = resolveAuthRedirect(formData.get("redirectTo"));
  const username = formData.get("username");
  const password = formData.get("password");

  if (
    typeof username !== "string" ||
    typeof password !== "string" ||
    username.trim().length === 0 ||
    password.length === 0
  ) {
    return {
      error: "请输入用户名和密码后再登录。",
    };
  }

  try {
    await signIn("local-credentials", {
      redirectTo,
      username: username.trim(),
      password,
    });
  } catch (error) {
    if (error instanceof AuthError) {
      if (error.type === "CredentialsSignin") {
        return {
          error: "账号或密码不正确，请重新输入。",
        };
      }

      return {
        error: "登录暂时不可用，请稍后重试。",
      };
    }

    throw error;
  }

  return { error: null };
}

export async function signInWithOAuth(formData: FormData): Promise<void> {
  const provider = formData.get("provider");
  const redirectTo = resolveAuthRedirect(formData.get("redirectTo"));

  if (typeof provider !== "string" || provider.trim().length === 0) {
    throw new Error("Missing provider id.");
  }

  await signIn(provider, { redirectTo });
}
