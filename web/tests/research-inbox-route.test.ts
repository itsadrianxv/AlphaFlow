import { describe, expect, it, vi } from "vitest";
import { researchInboxRouter } from "~/server/api/routers/research-inbox";
import { createCallerFactory } from "~/server/api/trpc";

vi.mock("~/server/auth", () => ({ auth: vi.fn() }));
vi.mock("~/server/db", () => ({ db: {} }));

const createCaller = createCallerFactory(researchInboxRouter);

describe("研究收件箱 API 用户边界", () => {
  it("拒绝未登录用户读取研究记录", async () => {
    const caller = createCaller({
      db: {},
      session: null,
      headers: new Headers(),
    } as never);

    await expect(caller.list({ filter: "PENDING" })).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
  });

  it("列表查询只使用当前会话用户", async () => {
    const findMany = vi.fn(async () => []);
    const caller = createCaller({
      db: {
        user: {
          findUnique: vi.fn(async () => ({
            id: "user-1",
            sessionVersion: 2,
            status: "ACTIVE",
          })),
        },
        researchInboxEntry: { findMany },
      },
      session: {
        user: { id: "user-1", sessionVersion: 2 },
        expires: "2099-01-01T00:00:00.000Z",
      },
      headers: new Headers(),
    } as never);

    await expect(caller.list({ filter: "ARCHIVED" })).resolves.toEqual({
      filter: "ARCHIVED",
      items: [],
    });
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId: "user-1", state: "ARCHIVED" },
      }),
    );
  });
});
