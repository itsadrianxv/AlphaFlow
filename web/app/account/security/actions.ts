"use server";

import { auth, signOut } from "~/server/auth";
import { isPasswordValid } from "~/server/auth/credential-policy";
import { hashPassword, verifyPassword } from "~/server/auth/password";
import { db } from "~/server/db";

export type ChangePasswordActionState = { error: string | null };

export async function changePassword(
  _previousState: ChangePasswordActionState,
  formData: FormData,
): Promise<ChangePasswordActionState> {
  const session = await auth();
  if (!session?.user?.id) return { error: "登录状态已失效，请重新登录。" };

  const currentPassword = formData.get("currentPassword");
  const newPassword = formData.get("newPassword");
  const confirmPassword = formData.get("confirmPassword");

  if (typeof currentPassword !== "string" || currentPassword.length === 0) {
    return { error: "请输入当前密码。" };
  }
  if (typeof newPassword !== "string" || !isPasswordValid(newPassword)) {
    return { error: "新密码不符合安全要求。" };
  }
  if (newPassword !== confirmPassword) {
    return { error: "两次输入的新密码不一致。" };
  }

  const user = await db.user.findUnique({
    where: { id: session.user.id },
    select: { id: true, passwordHash: true, status: true },
  });
  if (!user || user.status !== "ACTIVE") {
    return { error: "登录状态已失效，请重新登录。" };
  }
  if (!user.passwordHash) {
    return { error: "当前账号不支持在此修改密码。" };
  }
  if (!(await verifyPassword(user.passwordHash, currentPassword))) {
    return { error: "当前密码不正确。" };
  }

  const passwordHash = await hashPassword(newPassword);
  const result = await db.user.updateMany({
    where: { id: user.id, passwordHash: user.passwordHash, status: "ACTIVE" },
    data: {
      passwordHash,
      passwordChangedAt: new Date(),
      sessionVersion: { increment: 1 },
    },
  });
  if (result.count !== 1) {
    return { error: "密码已发生变化，请刷新页面后重试。" };
  }

  await signOut({ redirectTo: "/login" });
  return { error: null };
}
