import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { LocalStockSearchService } from "../local-stock-search-service";

describe("LocalStockSearchService", () => {
  let tempDir: string;
  let csvPath: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(path.join(tmpdir(), "local-stock-search-"));
    csvPath = path.join(tempDir, "stock_codes.csv");
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("parses CSV rows, skips invalid lines, and filters to A-share companies", async () => {
    await writeFile(
      csvPath,
      [
        "name,code",
        "贵州茅台,600519",
        "平安银行,000001",
        "北交样本,920001",
        "财通精选,501001",
        "R003,201000",
        "坏行",
      ].join("\n"),
      "utf8",
    );

    const service = new LocalStockSearchService(csvPath);

    await expect(service.search("样", 20)).resolves.toEqual([
      {
        stockCode: "920001",
        stockName: "北交样本",
        market: "BJ",
        matchField: "NAME",
      },
    ]);

    await expect(service.search("财通", 20)).resolves.toEqual([]);
    await expect(service.search("R003", 20)).resolves.toEqual([]);
  });

  it("returns code matches before name matches and respects limit", async () => {
    await writeFile(
      csvPath,
      ["name,code", "贵州茅台,600519", "519科技,300001", "519制造,301002"].join(
        "\n",
      ),
      "utf8",
    );

    const service = new LocalStockSearchService(csvPath);

    await expect(service.search("519", 2)).resolves.toEqual([
      {
        stockCode: "600519",
        stockName: "贵州茅台",
        market: "SH",
        matchField: "CODE",
      },
      {
        stockCode: "300001",
        stockName: "519科技",
        market: "SZ",
        matchField: "NAME",
      },
    ]);
  });

  it("deduplicates repeated stock codes by keeping the first row", async () => {
    await writeFile(
      csvPath,
      ["name,code", "旧名字,600519", "新名字,600519", "招商银行,600036"].join(
        "\n",
      ),
      "utf8",
    );

    const service = new LocalStockSearchService(csvPath);

    await expect(service.search("6005", 20)).resolves.toEqual([
      {
        stockCode: "600519",
        stockName: "旧名字",
        market: "SH",
        matchField: "CODE",
      },
    ]);
  });

  it("reloads the CSV after the file mtime changes", async () => {
    await writeFile(
      csvPath,
      ["name,code", "平安银行,000001"].join("\n"),
      "utf8",
    );

    const service = new LocalStockSearchService(csvPath);

    await expect(service.search("平安", 20)).resolves.toEqual([
      {
        stockCode: "000001",
        stockName: "平安银行",
        market: "SZ",
        matchField: "NAME",
      },
    ]);

    await new Promise((resolve) => setTimeout(resolve, 20));
    await writeFile(
      csvPath,
      ["name,code", "招商银行,600036"].join("\n"),
      "utf8",
    );

    await expect(service.search("招商", 20)).resolves.toEqual([
      {
        stockCode: "600036",
        stockName: "招商银行",
        market: "SH",
        matchField: "NAME",
      },
    ]);
    await expect(service.search("平安", 20)).resolves.toEqual([]);
  });
});
