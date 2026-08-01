import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("首页快照查询隔离", () => {
  it("查询模块不导入 Python、LLM 或工作流生成能力", async () => {
    const sources = await Promise.all(
      [
        "server/api/routers/homepage.ts",
        "server/application/homepage/home-page-snapshot-service.ts",
      ].map((path) => readFile(path, "utf8")),
    );
    const source = sources.join("\n");

    expect(source).not.toMatch(/Python|DeepSeek|Llm|WorkflowCommandService/);
    expect(source).not.toContain("HomePagePayloadGenerator");
  });
});
