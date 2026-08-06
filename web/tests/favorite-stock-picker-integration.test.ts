import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

function source(path: string) {
  return readFileSync(new URL(path, import.meta.url), "utf8");
}

describe("收藏股票选择入口", () => {
  it.each([
    ["筛选", "../app/screening/screening-studio-client.tsx"],
    ["择时研究", "../app/timing/timing-run-console.tsx"],
    ["定时任务", "../app/scheduled-tasks/builder/scoring-task-builder.tsx"],
    ["公司研究", "../app/company-research/company-research-client.tsx"],
  ])("%s 接入收藏股票选择器", (_name, path) => {
    expect(source(path)).toContain("<FavoriteStockPicker");
  });

  it("公司研究限制为单只股票", () => {
    expect(source("../app/company-research/company-research-client.tsx")).toMatch(
      /<FavoriteStockPicker[\s\S]*?maxSelection=\{1\}/,
    );
  });
});
