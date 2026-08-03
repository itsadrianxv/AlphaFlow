import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = path.resolve(import.meta.dirname, "..");

describe("定时任务页面", () => {
  it("在侧边导航中提供定时任务入口", async () => {
    const source = await readFile(path.join(root, "app/_components/workspace-shell.tsx"), "utf8");
    expect(source).toContain('href: "/scheduled-tasks"');
    expect(source).toContain('label: "定时任务"');
  });

  it("提供筛选、暂停、恢复和取消操作", async () => {
    const source = await readFile(path.join(root, "app/scheduled-tasks/scheduled-tasks-client.tsx"), "utf8");
    expect(source).toContain("scheduledTask.pause");
    expect(source).toContain("scheduledTask.resume");
    expect(source).toContain("scheduledTask.cancel");
    expect(source).toContain("任务状态筛选");
  });

  it("从页面直接进入结构化评分规则构建器", async () => {
    const listSource = await readFile(path.join(root, "app/scheduled-tasks/scheduled-tasks-client.tsx"), "utf8");
    const builderSource = await readFile(path.join(root, "app/scheduled-tasks/builder/scoring-task-builder.tsx"), "utf8");

    expect(listSource).toContain('href="/scheduled-tasks/builder"');
    expect(builderSource).toContain("scheduledTask.saveScoringDraft");
    expect(builderSource).toContain("screening.searchStocks");
    expect(builderSource).toContain("800");
    expect(builderSource).not.toContain("userPrompt");
    expect(builderSource).not.toContain("Provider");
    expect(builderSource).not.toContain("Capability");
  });
});
