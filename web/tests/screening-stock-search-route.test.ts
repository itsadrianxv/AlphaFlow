import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

const routerPath = path.resolve(process.cwd(), "server/api/routers/screening.ts");

describe("筛选股票搜索路由", () => {
  it("通过 Python 筛选服务查询股票池", async () => {
    const source = await readFile(routerPath, "utf8");

    expect(source).toContain("PythonScreeningWorkbenchClient");
    expect(source).toContain(".searchStocks(");
    expect(source).not.toContain("LocalStockSearchService");
  });
});
