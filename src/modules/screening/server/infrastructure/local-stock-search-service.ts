import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import type { SearchStockResult } from "~/modules/screening/contracts/screening";

const DEFAULT_STOCK_CODES_CSV_PATH = path.resolve(
  process.cwd(),
  "data",
  "stock_codes.csv",
);

type CsvStockRecord = {
  stockCode: string;
  stockName: string;
  market: SearchStockResult["market"];
};

type FileAccess = {
  readFile: typeof readFile;
  stat: typeof stat;
};

function inferMarket(code: string): SearchStockResult["market"] {
  if (/^(?:60|68|69)\d{4}$/.test(code)) {
    return "SH";
  }

  if (/^(?:000|001|002|003|300|301)\d{3}$/.test(code)) {
    return "SZ";
  }

  return "BJ";
}

function isSearchableAshareCompanyCode(code: string): boolean {
  return (
    /^(?:60|68|69)\d{4}$/.test(code) ||
    /^(?:000|001|002|003|300|301)\d{3}$/.test(code) ||
    /^(?:4\d{5}|8\d{5}|920\d{3})$/.test(code)
  );
}

function parseCsvLine(line: string) {
  const separatorIndex = line.indexOf(",");
  if (separatorIndex <= 0 || separatorIndex === line.length - 1) {
    return null;
  }

  const stockName = line.slice(0, separatorIndex).trim();
  const stockCode = line.slice(separatorIndex + 1).trim();

  if (!stockName || !/^\d{6}$/.test(stockCode)) {
    return null;
  }

  if (!isSearchableAshareCompanyCode(stockCode)) {
    return null;
  }

  return {
    stockCode,
    stockName,
    market: inferMarket(stockCode),
  } satisfies CsvStockRecord;
}

function parseStockCodeCsv(rawCsv: string): CsvStockRecord[] {
  const rows = rawCsv.replace(/^\uFEFF/, "").split(/\r?\n/);
  const seenCodes = new Set<string>();
  const records: CsvStockRecord[] = [];

  for (const [index, rawLine] of rows.entries()) {
    const line = rawLine.trim();
    if (!line) {
      continue;
    }

    if (index === 0 && line.toLowerCase() === "name,code") {
      continue;
    }

    const parsed = parseCsvLine(line);
    if (!parsed || seenCodes.has(parsed.stockCode)) {
      continue;
    }

    seenCodes.add(parsed.stockCode);
    records.push(parsed);
  }

  return records;
}

export class LocalStockSearchService {
  private readonly fileAccess: FileAccess;
  private cache: {
    mtimeMs: number;
    records: CsvStockRecord[];
  } | null = null;

  constructor(
    private readonly csvPath = DEFAULT_STOCK_CODES_CSV_PATH,
    fileAccess?: Partial<FileAccess>,
  ) {
    this.fileAccess = {
      readFile,
      stat,
      ...fileAccess,
    };
  }

  async search(keyword: string, limit: number): Promise<SearchStockResult[]> {
    const normalizedKeyword = keyword.trim().toLowerCase();
    if (!normalizedKeyword) {
      return [];
    }

    const records = await this.loadRecords();
    const codeMatches: SearchStockResult[] = [];
    const nameMatches: SearchStockResult[] = [];

    for (const record of records) {
      if (record.stockCode.toLowerCase().includes(normalizedKeyword)) {
        codeMatches.push({
          stockCode: record.stockCode,
          stockName: record.stockName,
          market: record.market,
          matchField: "CODE",
        });
        continue;
      }

      if (record.stockName.toLowerCase().includes(normalizedKeyword)) {
        nameMatches.push({
          stockCode: record.stockCode,
          stockName: record.stockName,
          market: record.market,
          matchField: "NAME",
        });
      }
    }

    return [...codeMatches, ...nameMatches].slice(0, limit);
  }

  private async loadRecords(): Promise<CsvStockRecord[]> {
    const fileStats = await this.fileAccess.stat(this.csvPath);
    if (this.cache && this.cache.mtimeMs === fileStats.mtimeMs) {
      return this.cache.records;
    }

    const rawCsv = await this.fileAccess.readFile(this.csvPath, "utf8");
    const records = parseStockCodeCsv(rawCsv);
    this.cache = {
      mtimeMs: fileStats.mtimeMs,
      records,
    };

    return records;
  }
}
