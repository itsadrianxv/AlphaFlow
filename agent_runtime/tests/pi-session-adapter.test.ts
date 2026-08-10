import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { PiSessionAdapter } from "../src/pi-session-adapter";

const tempRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempRoots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })),
  );
});

describe("PiSessionAdapter", () => {
  it("创建带 seed 的持久化会话并通过稳定 SessionSpec 恢复", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "alphaflow-pi-session-"));
    tempRoots.push(root);
    const adapter = new PiSessionAdapter(root);
    const spec = {
      mode: "persistent" as const,
      id: "conversation-1",
      seed: [{ role: "user" as const, content: "先分析公司公告" }],
    };

    const created = await adapter.resolve(spec);
    const createdContext = await created.buildContext();
    const restored = await adapter.resolve({ ...spec, seed: [] });
    const restoredContext = await restored.buildContext();

    expect(createdContext.messages).toHaveLength(1);
    expect(restoredContext.messages).toHaveLength(1);
    expect(restoredContext.messages[0]).toMatchObject({
      role: "user",
      content: [{ type: "text", text: "先分析公司公告" }],
    });
  });
});
