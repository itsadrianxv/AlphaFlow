import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  signOut: vi.fn(),
  findUnique: vi.fn(),
  updateMany: vi.fn(),
  hashPassword: vi.fn(),
  verifyPassword: vi.fn(),
}));

vi.mock("~/server/auth", () => ({ auth: mocks.auth, signOut: mocks.signOut }));
vi.mock("~/server/db", () => ({
  db: {
    user: { findUnique: mocks.findUnique, updateMany: mocks.updateMany },
  },
}));
vi.mock("~/server/auth/password", () => ({
  hashPassword: mocks.hashPassword,
  verifyPassword: mocks.verifyPassword,
}));

import { changePassword } from "~/app/account/security/actions";

function passwordForm(current = "OldStrong#1", next = "NewStrong#2") {
  const form = new FormData();
  form.set("currentPassword", current);
  form.set("newPassword", next);
  form.set("confirmPassword", next);
  return form;
}

describe("修改密码 Server Action", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.auth.mockResolvedValue({ user: { id: "user-1" } });
    mocks.findUnique.mockResolvedValue({
      id: "user-1",
      passwordHash: "old-hash",
      status: "ACTIVE",
    });
    mocks.verifyPassword.mockResolvedValue(true);
    mocks.hashPassword.mockResolvedValue("new-hash");
    mocks.updateMany.mockResolvedValue({ count: 1 });
    mocks.signOut.mockResolvedValue(undefined);
  });

  it("验证旧密码后更新哈希、递增会话版本并退出", async () => {
    await expect(
      changePassword({ error: null }, passwordForm()),
    ).resolves.toEqual({ error: null });
    expect(mocks.updateMany).toHaveBeenCalledWith({
      where: {
        id: "user-1",
        passwordHash: "old-hash",
        status: "ACTIVE",
      },
      data: {
        passwordHash: "new-hash",
        passwordChangedAt: expect.any(Date),
        sessionVersion: { increment: 1 },
      },
    });
    expect(mocks.signOut).toHaveBeenCalledWith({ redirectTo: "/login" });
  });

  it("旧密码错误时不更新", async () => {
    mocks.verifyPassword.mockResolvedValue(false);
    await expect(
      changePassword({ error: null }, passwordForm()),
    ).resolves.toEqual({ error: "当前密码不正确。" });
    expect(mocks.updateMany).not.toHaveBeenCalled();
  });

  it("固定管理员没有数据库密码哈希时拒绝网页改密", async () => {
    mocks.findUnique.mockResolvedValue({
      id: "admin-user",
      passwordHash: null,
      status: "ACTIVE",
    });
    await expect(
      changePassword({ error: null }, passwordForm()),
    ).resolves.toEqual({ error: "当前账号不支持在此修改密码。" });
  });
});
